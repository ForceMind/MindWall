import type { NextFunction, Request, Response } from 'express';
export interface RequestWithContext extends Request {
    requestId?: string;
    requestStartedAt?: number;
}
export declare function requestContextMiddleware(req: RequestWithContext, res: Response, next: NextFunction): void;
