import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AppConfig } from '../../../config/configuration';
import { UsersService } from '../../users/users.service';
import type { AccessTokenPayload } from '../auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService<AppConfig, true>,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.accessSecret', { infer: true }),
      algorithms: ['HS256'],
      issuer: configService.get('jwt.issuer', { infer: true }),
      audience: configService.get('jwt.audience', { infer: true }),
    });
  }

  async validate(payload: AccessTokenPayload) {
    if (!payload?.sub || typeof payload.sub !== 'string') {
      throw new UnauthorizedException('User is not authorized');
    }
    const user = await this.usersService.findActiveWithAccess(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User is not authorized');
    }
    return user;
  }
}
