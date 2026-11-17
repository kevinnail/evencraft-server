import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { db } from '../db/connection';
import { subscriptions, user } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';

const expectedAuth = process.env.REVENUECAT_WEBHOOK_AUTH_HEADER;
if (!expectedAuth) throw new Error('REVENUECAT_WEBHOOK_AUTH_HEADER is not set');
const expectedAuthBytes = Buffer.from(expectedAuth);

// Compares the secret in constant time, so it can't be recovered by timing a plain `!==`.
// timingSafeEqual needs equal lengths, so the length check comes first and gives away only
// the secret's length.
function isValidWebhookAuth(header: string | undefined): boolean {
  if (typeof header !== 'string') return false;
  const headerBytes = Buffer.from(header);
  if (headerBytes.length !== expectedAuthBytes.length) return false;
  return timingSafeEqual(headerBytes, expectedAuthBytes);
}

const ACTIVATING = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE']);
const DEACTIVATING = new Set(['EXPIRATION', 'CANCELLATION']);

interface RevenueCatEvent {
  type?: string;
  app_user_id?: string;
  aliases?: string[];
  product_id?: string;
  expiration_at_ms?: number | null;
}

interface RevenueCatBody {
  event?: RevenueCatEvent;
}

const router = Router();

router.post(
  '/revenuecat',
  asyncHandler(async (req, res) => {
    if (!isValidWebhookAuth(req.headers.authorization)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const event = (req.body as RevenueCatBody | undefined)?.event;
    if (!event?.type) {
      res.status(400).json({ error: 'malformed event' });
      return;
    }

    let status: 'active' | 'expired' | null = null;
    if (ACTIVATING.has(event.type)) status = 'active';
    else if (DEACTIVATING.has(event.type)) status = 'expired';

    // Every other event type is acknowledged and changes nothing. That includes TRANSFER:
    // RevenueCat's transfer behavior is "Keep with original App User ID", so a subscription
    // stays with the first account that bought it and never moves between accounts.
    if (status === null) {
      res.status(200).json({ ignored: event.type });
      return;
    }

    if (!event.app_user_id) {
      res.status(400).json({ error: 'malformed event' });
      return;
    }

    // app_user_id is the customer's last seen id, which can be the anonymous id the app starts
    // with ($RCAnonymousID:...) even when the purchase belongs to a signed in account: a renewal
    // that arrives while the app is signed out comes that way. aliases carries every id the
    // customer has had, the account's id from sign in included, so look through all of them.
    const candidateIds = [event.app_user_id, ...(event.aliases ?? [])];
    const matchedUsers = await db
      .select({ id: user.id })
      .from(user)
      .where(inArray(user.id, candidateIds));
    const userId = matchedUsers[0]?.id;

    if (!userId) {
      res.status(200).json({ ignored: 'no matching user' });
      return;
    }

    const subscription = {
      status,
      productId: event.product_id ?? null,
      // No expiry date stays null, which checkSubscription counts as no end.
      expiresAt:
        typeof event.expiration_at_ms === 'number' ? new Date(event.expiration_at_ms) : null,
    };

    await db
      .insert(subscriptions)
      .values({ userId, ...subscription })
      .onConflictDoUpdate({
        target: subscriptions.userId,
        set: { ...subscription, updatedAt: new Date() },
      });

    res.status(200).json({ ok: true });
  }),
);

export default router;
