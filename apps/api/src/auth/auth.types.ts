import type { Request } from 'express';
import type { UserStatus } from '@prisma/client';

export interface SessionUser {
  sessionId: string;
  userId: string;
  email: string;
  status: UserStatus;
}

export interface AuthenticatedRequest extends Request {
  authUser?: SessionUser;
}
