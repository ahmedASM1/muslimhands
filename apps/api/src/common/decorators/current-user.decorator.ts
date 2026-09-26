import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RequestUser } from '../types/authenticated-request';

interface RequestWithUser {
  user: RequestUser;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return request.user;
  },
);
