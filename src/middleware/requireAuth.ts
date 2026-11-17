import type { RequestHandler } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../lib/auth';
import { asyncHandler } from '../lib/asyncHandler';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

// Answers 401 without a session, and otherwise puts the signed in account's id on the request.
export const requireAuth: RequestHandler = asyncHandler(async (req, res, next) => {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  req.userId = session.user.id;
  next();
});
