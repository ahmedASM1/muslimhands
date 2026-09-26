import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '../types/authenticated-request';

export const RequestMeta = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const forwarded = request.headers['x-forwarded-for'];
    const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];

    return {
      ipAddress: forwardedIp?.trim() ?? request.ip,
      userAgent: request.headers['user-agent'],
    };
  },
);
