import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditAction, type AuthSession } from '@mh/shared';
import type { AppConfig } from '../../config/configuration';
import { PasswordService } from '../../common/crypto/password.service';
import type { RequestContext } from '../../common/types/authenticated-request';
import { PrismaService } from '../../prisma/prisma.service';
import { MailerService } from '../../common/mailer/mailer.service';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { isAuthenticatable } from './auth-rules';
import type { AccessTokenPayload } from './auth.types';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly mailer: MailerService,
  ) {}

  async login(
    email: string,
    password: string,
    context: RequestContext,
    pharmacySlug?: string,
  ): Promise<AuthSession> {
    const user = await this.usersService.findByEmail(email);
    const hash =
      user && isAuthenticatable(user) && user.passwordHash
        ? user.passwordHash
        : PasswordService.DUMMY_ARGON2_HASH;
    const valid = await this.passwordService.verify(hash, password);

    if (!user || !isAuthenticatable(user) || !user.passwordHash || !valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const sessionUser = await this.usersService.findActiveWithAccess(user.id);
    if (!sessionUser) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (pharmacySlug) {
      const pharmacy = await this.prisma.pharmacy.findFirst({
        where: { slug: pharmacySlug, deletedAt: null, isActive: true },
        select: { id: true, slug: true, name: true },
      });
      if (!pharmacy) {
        throw new UnauthorizedException('Pharmacy portal is unavailable');
      }
      // Pharmacy portals are invite-only: user must be assigned to this pharmacy.
      if (sessionUser.pharmacyId !== pharmacy.id) {
        throw new UnauthorizedException(
          'This account is not invited to this pharmacy. Use the invitation link or contact your administrator.',
        );
      }
    }

    const tokens = await this.issueTokens(user.id, user.email, context);
    await this.usersService.markLogin(user.id);
    await this.auditService.record({
      userId: user.id,
      action: AuditAction.LOGIN,
      entityType: 'User',
      entityId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      newValues: pharmacySlug ? { pharmacySlug } : undefined,
    });

    return { user: sessionUser, tokens };
  }

  async refresh(refreshToken: string, context: RequestContext): Promise<AuthSession> {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!stored) {
      throw new UnauthorizedException('Refresh token is invalid');
    }

    const expired = stored.expiresAt <= new Date();
    if (stored.revokedAt || expired) {
      if (stored.revokedAt) {
        await this.revokeAllUserRefreshTokens(stored.userId);
        this.logger.warn(`Refresh token reuse detected for userId=${stored.userId}`);
      }
      throw new UnauthorizedException('Refresh token is invalid');
    }

    const sessionUser = await this.usersService.findActiveWithAccess(stored.userId);
    if (!sessionUser) {
      await this.revokeAllUserRefreshTokens(stored.userId);
      throw new UnauthorizedException('Refresh token is invalid');
    }

    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) {
      await this.revokeAllUserRefreshTokens(stored.userId);
      throw new UnauthorizedException('Refresh token is invalid');
    }

    const tokens = await this.issueTokens(sessionUser.id, sessionUser.email, context);
    return { user: sessionUser, tokens };
  }

  async logout(refreshToken: string, userId: string, context: RequestContext): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        tokenHash,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    await this.auditService.record({
      userId,
      action: AuditAction.LOGOUT,
      entityType: 'User',
      entityId: userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }

  async requestPasswordReset(email: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      return { sent: true };
    }
    const token = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const appUrl = this.configService.get('appUrl', { infer: true }).replace(/\/$/, '');
    const resetUrl = `${appUrl}/reset-password/${token}`;
    await this.mailer.sendPasswordResetEmail({
      to: user.email,
      recipientName: `${user.firstName} ${user.lastName}`.trim(),
      resetUrl,
      userId: user.id,
    });
    const nodeEnv = this.configService.get('nodeEnv', { infer: true });
    return {
      sent: true,
      resetUrl: nodeEnv === 'production' ? undefined : resetUrl,
    };
  }

  async resetPassword(token: string, password: string) {
    const stored = await this.prisma.passwordResetToken.findFirst({
      where: {
        tokenHash: this.hashToken(token),
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!stored) {
      throw new UnauthorizedException('Reset link is invalid or expired');
    }
    const passwordHash = await this.passwordService.hash(password);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: stored.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.updateMany({
        where: { userId: stored.userId, usedAt: null },
        data: { usedAt: now },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
    await this.auditService.record({
      userId: stored.userId,
      action: AuditAction.USER_UPDATED,
      entityType: 'User',
      entityId: stored.userId,
      newValues: { passwordReset: true },
    });
    return { reset: true };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    context: RequestContext,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, status: 'ACTIVE' },
    });
    if (!user?.passwordHash) {
      throw new UnauthorizedException('Unable to change password');
    }

    const valid = await this.passwordService.verify(user.passwordHash, currentPassword);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException('New password must be different from the current password');
    }

    if (newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }

    const passwordHash = await this.passwordService.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.auditService.record({
      userId,
      action: AuditAction.CHANGE_PASSWORD,
      entityType: 'User',
      entityId: userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      newValues: { passwordChanged: true, sessionsRevoked: true },
    });

    return { changed: true, requireReLogin: true };
  }

  private async revokeAllUserRefreshTokens(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(userId: string, email: string, context: RequestContext) {
    const refreshToken = randomBytes(48).toString('hex');

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: this.refreshExpiryDate(),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });

    const accessPayload: AccessTokenPayload = { sub: userId, email };
    const accessToken = await this.jwtService.signAsync(accessPayload, {
      secret: this.configService.get('jwt.accessSecret', { infer: true }),
      expiresIn: this.configService.get('jwt.accessExpiresIn', { infer: true }),
      issuer: this.configService.get('jwt.issuer', { infer: true }),
      audience: this.configService.get('jwt.audience', { infer: true }),
      algorithm: 'HS256',
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.parseDurationSeconds(
        this.configService.get('jwt.accessExpiresIn', { infer: true }),
      ),
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private refreshExpiryDate(): Date {
    const duration = this.configService.get('jwt.refreshExpiresIn', { infer: true });
    return new Date(Date.now() + this.parseDurationSeconds(duration) * 1000);
  }

  private parseDurationSeconds(value: string): number {
    const match = /^(\d+)([smhd])$/.exec(value);
    if (!match) {
      return 900;
    }

    const amount = Number(match[1]);
    switch (match[2]) {
      case 's':
        return amount;
      case 'm':
        return amount * 60;
      case 'h':
        return amount * 60 * 60;
      case 'd':
        return amount * 60 * 60 * 24;
      default:
        return 900;
    }
  }
}
