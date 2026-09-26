import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { ApiSuccessResponse, PaginationMeta } from '@mh/shared';
import { Observable, map } from 'rxjs';

interface PaginatedPayload<T> {
  items: T[];
  meta: PaginationMeta;
}

function isPaginatedPayload<T>(value: unknown): value is PaginatedPayload<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'items' in value &&
    'meta' in value &&
    Array.isArray((value as PaginatedPayload<T>).items)
  );
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiSuccessResponse<unknown>> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<unknown>> {
    return next.handle().pipe(
      map((data) => {
        if (isPaginatedPayload(data)) {
          return {
            success: true as const,
            data: data.items,
            meta: data.meta,
          };
        }

        return {
          success: true as const,
          data,
        };
      }),
    );
  }
}
