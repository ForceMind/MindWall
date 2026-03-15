import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestWithContext extends Request {
  requestId?: string;
  requestStartedAt?: number;
}

export function requestContextMiddleware(
  req: RequestWithContext,
  res: Response,
  next: NextFunction,
) {
  const incoming = String(req.headers['x-request-id'] || '').trim();
  const requestId = incoming || randomUUID();
  req.requestId = requestId;
  req.requestStartedAt = Date.now();
  res.setHeader('x-request-id', requestId);
  next();
}
