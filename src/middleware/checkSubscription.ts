import type { RequestHandler } from 'express';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { db } from '../db/connection';
import { subscriptions } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';

// Runs after requireAuth. Answers 403 unless the account's subscription is active and hasn't
// run out. A subscription with no expiry date has no end, so it counts as active.
export const checkSubscription: RequestHandler = asyncHandler(async (req, res, next) => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const rows = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.status, 'active'),
        or(isNull(subscriptions.expiresAt), gt(subscriptions.expiresAt, new Date())),
      ),
    );

  if (rows.length === 0) {
    res.status(403).json({ error: 'Subscription required' });
    return;
  }

  next();
});
