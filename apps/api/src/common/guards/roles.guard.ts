import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleCode } from '@mh/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { RequestUser } from '../types/authenticated-request';

interface RequestWithUser {
  user?: RequestUser;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RoleCode[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('Authentication is required');
    }

    if (user.roles.includes(RoleCode.SUPER_ADMIN)) {
      return true;
    }

    const allowed = required.some((role) => user.roles.includes(role));
    if (!allowed) {
      throw new ForbiddenException('Insufficient role');
    }

    return true;
  }
}
