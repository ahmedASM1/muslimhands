import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

const HEADER = 'x-request-id';
const MAX_LEN = 64;
const SAFE = /^[A-Za-z0-9_-]+$/;

export type RequestWithId = Request & { requestId?: string };

/** Accept a short safe client id or generate one; always echo X-Request-Id. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header(HEADER)?.trim();
  const requestId =
    incoming && incoming.length >= 8 && incoming.length <= MAX_LEN && SAFE.test(incoming)
      ? incoming
      : randomUUID();
  (req as RequestWithId).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
