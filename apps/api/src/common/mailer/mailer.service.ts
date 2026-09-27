import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EMAILABLE_NOTIFICATION_TYPES,
  templateForNotificationType,
  type EmailTemplateId,
  type EmailTemplatePayload,
} from './email-templates';
import {
  emailCopy,
  emailLocaleFromPreference,
  localizedNotificationCopy,
} from './email-i18n';
import { EmailQueueService } from './email-queue.service';

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  developmentLink?: string;
  type?: string;
  template?: EmailTemplateId;
  payload?: EmailTemplatePayload;
  userId?: string;
  notificationId?: string;
  locale?: 'en' | 'ar';
}

function redactEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '[redacted]';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!domain) return '[redacted]';
  const safeLocal = local.length <= 2 ? '*' : `${local[0]}***`;
  return `${safeLocal}@${domain}`;
}

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly emailQueue: EmailQueueService,
    private readonly prisma: PrismaService,
  ) {}

  private async resolveUserLocale(userId?: string): Promise<'en' | 'ar'> {
    if (!userId) return 'en';
    const pref = await this.prisma.notificationPreference.findUnique({
      where: { userId },
      select: { preferredLanguage: true },
    });
    return emailLocaleFromPreference(pref?.preferredLanguage);
  }

  async send(email: OutboundEmail): Promise<{ delivered: boolean; logged: boolean; emailLogId?: string }> {
    const nodeEnv = this.config.get('nodeEnv', { infer: true });
    const recipientLog = nodeEnv === 'production' ? redactEmail(email.to) : email.to;
    const template = email.template ?? 'generic-notification';
    const payload: EmailTemplatePayload = email.payload ?? {
      title: email.subject,
      summary: email.text,
      actionUrl: email.developmentLink,
      actionLabel: email.developmentLink ? 'Open link' : undefined,
    };

    try {
      const result = await this.emailQueue.enqueue({
        type: email.type ?? template,
        template,
        to: email.to,
        subject: email.subject,
        payload: { ...payload, locale: email.locale ?? 'en' },
        userId: email.userId,
        notificationId: email.notificationId,
        developmentLink: email.developmentLink,
      });
      this.logger.log(`Email queued for ${recipientLog}: ${email.subject}`);
      return { delivered: true, logged: true, emailLogId: result.emailLogId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Email enqueue failed for ${recipientLog}: ${message}`);
      return { delivered: false, logged: false };
    }
  }

  async sendInvitationEmail(input: {
    to: string;
    recipientName: string;
    roleName: string;
    assignment?: string;
    expiresAt: Date;
    acceptUrl: string;
    portalLoginUrl?: string;
    userId?: string;
    preferredLanguage?: 'EN' | 'AR' | null;
  }) {
    const locale = input.preferredLanguage
      ? emailLocaleFromPreference(input.preferredLanguage)
      : await this.resolveUserLocale(input.userId);
    const copy = emailCopy(locale);
    const meta = [
      { label: copy.invitation.role, value: input.roleName },
      ...(input.assignment ? [{ label: copy.invitation.assignment, value: input.assignment }] : []),
      { label: copy.invitation.expires, value: input.expiresAt.toUTCString() },
    ];
    if (input.portalLoginUrl) {
      meta.push({ label: copy.invitation.pharmacyLogin, value: input.portalLoginUrl });
    }

    return this.send({
      to: input.to,
      userId: input.userId,
      locale,
      type: 'invitation',
      template: 'invitation',
      subject: copy.invitation.subject,
      text: `${copy.invitation.summary}\n${input.acceptUrl}`,
      developmentLink: input.acceptUrl,
      payload: {
        recipientName: input.recipientName,
        title: copy.invitation.title,
        summary: copy.invitation.summary,
        actionUrl: input.acceptUrl,
        actionLabel: copy.invitation.action,
        meta,
        footerNote: copy.invitation.footer,
        locale,
      },
    });
  }

  async sendPasswordResetEmail(input: {
    to: string;
    recipientName?: string;
    resetUrl: string;
    userId?: string;
  }) {
    const locale = await this.resolveUserLocale(input.userId);
    const copy = emailCopy(locale);
    return this.send({
      to: input.to,
      userId: input.userId,
      locale,
      type: 'password-reset',
      template: 'password-reset',
      subject: copy.passwordReset.subject,
      text: `${copy.passwordReset.summary}\n${input.resetUrl}`,
      developmentLink: input.resetUrl,
      payload: {
        recipientName: input.recipientName,
        title: copy.passwordReset.title,
        summary: copy.passwordReset.summary,
        actionUrl: input.resetUrl,
        actionLabel: copy.passwordReset.action,
        footerNote: copy.passwordReset.footer,
        locale,
      },
    });
  }

  async sendNotificationEmail(input: {
    notificationId: string;
    userId: string;
    type: string;
    title: string;
    message: string;
    href?: string | null;
  }) {
    if (!EMAILABLE_NOTIFICATION_TYPES.has(input.type)) {
      return { delivered: false, logged: false };
    }

    const existing = await this.prisma.emailLog.findUnique({
      where: { notificationId: input.notificationId },
    });
    if (existing) {
      return { delivered: false, logged: true, emailLogId: existing.id };
    }

    const user = await this.prisma.user.findFirst({
      where: { id: input.userId, deletedAt: null, status: 'ACTIVE' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        notificationPreference: {
          select: {
            emailEnabled: true,
            preferredLanguage: true,
            emailLowStock: true,
            emailExpiringSoon: true,
            emailExpiredStock: true,
          },
        },
      },
    });
    if (!user?.email) {
      return { delivered: false, logged: false };
    }
    const pref = user.notificationPreference;
    if (pref && !pref.emailEnabled) {
      return { delivered: false, logged: false };
    }
    if (pref) {
      if (input.type === 'LOW_STOCK' && pref.emailLowStock === false) {
        return { delivered: false, logged: false };
      }
      if (input.type === 'EXPIRING_SOON' && pref.emailExpiringSoon === false) {
        return { delivered: false, logged: false };
      }
      if (input.type === 'EXPIRED_STOCK' && pref.emailExpiredStock === false) {
        return { delivered: false, logged: false };
      }
    }

    const locale = emailLocaleFromPreference(pref?.preferredLanguage);
    const localized = localizedNotificationCopy(locale, input.type, input.title, input.message);
    const copy = emailCopy(locale);

    const appUrl = this.config.get('appUrl', { infer: true }).replace(/\/$/, '');
    const actionUrl = input.href
      ? input.href.startsWith('http')
        ? input.href
        : `${appUrl}${input.href.startsWith('/') ? '' : '/'}${input.href}`
      : `${appUrl}/notifications`;

    const template = templateForNotificationType(input.type);
    return this.send({
      to: user.email,
      userId: user.id,
      notificationId: input.notificationId,
      locale,
      type: input.type,
      template,
      subject: localized.title,
      text: localized.summary,
      developmentLink: actionUrl,
      payload: {
        recipientName: `${user.firstName} ${user.lastName}`.trim(),
        title: localized.title,
        summary: localized.summary,
        actionUrl,
        actionLabel: copy.notification.action,
        locale,
      },
    });
  }

  async sendTestEmail(input: { to: string; requestedByName?: string; userId?: string }) {
    const locale = await this.resolveUserLocale(input.userId);
    const copy = emailCopy(locale);
    return this.send({
      to: input.to,
      userId: input.userId,
      locale,
      type: 'TEST_EMAIL',
      template: 'generic-notification',
      subject: copy.test.subject,
      text: copy.test.summary,
      payload: {
        recipientName: input.requestedByName,
        title: copy.test.title,
        summary: copy.test.summary,
        footerNote: copy.test.footer,
        locale,
      },
    });
  }
}
