import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorResponse } from '@mh/shared';
import type { RequestWithId } from '../middleware/request-id.middleware';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithId>();
    const requestId = request.requestId;

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : null;
    const message =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : typeof exceptionResponse === 'object' &&
            exceptionResponse !== null &&
            'message' in exceptionResponse
          ? Array.isArray(exceptionResponse.message)
            ? exceptionResponse.message.join(', ')
            : String(exceptionResponse.message)
          : 'Internal server error';

    const code =
      exception instanceof HttpException
        ? exception.name.replace(/Exception$/, '')
        : 'InternalError';

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} ${status} requestId=${requestId ?? 'n/a'}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const safeMessage =
      isProduction && status >= 500 ? 'Internal server error' : message;

    const body: ApiErrorResponse & { requestId?: string } = {
      success: false,
      error: {
        code,
        message: safeMessage,
        details:
          isProduction
            ? undefined
            : typeof exceptionResponse === 'object' && exceptionResponse !== null
              ? exceptionResponse
              : undefined,
      },
      ...(requestId ? { requestId } : {}),
    };

    if (requestId) {
      response.setHeader('X-Request-Id', requestId);
    }
    response.status(status).json(body);
  }
}
