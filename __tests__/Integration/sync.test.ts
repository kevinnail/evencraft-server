import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { db } from '../../src/db/connection';
import { subscriptions, user } from '../../src/db/schema';
import { resetDb } from '../helpers/db';

const NEW_ACCOUNT = {
  name: 'maker',
  email: 'maker@example.com',
  password: 'glass2026',
};

const FUTURE = new Date(Date.UTC(2099, 0, 1));
const PAST = new Date(Date.UTC(2000, 0, 1));

async function signUp(): Promise<{ userId: string; cookies: string[] }> {
  const res = await request(app).post('/api/auth/sign-up/email').send(NEW_ACCOUNT);
  const { user: createdUser } = res.body as { user: { id: string } };
  return { userId: createdUser.id, cookies: res.headers['set-cookie'] as unknown as string[] };
}

beforeEach(async () => {
  await resetDb();
});

// No /sync route exists until slice 8, so a request that gets past the session and subscription
// checks reaches the app's 404.
describe('every /sync route', () => {
  // Otherwise anyone without an account can reach the backup routes.
  it('answers 401 with no session', async () => {
    const res = await request(app).get('/sync/pull');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  // Otherwise a made up session cookie gets in.
  it('answers 401 to a session that does not exist', async () => {
    const res = await request(app)
      .get('/sync/pull')
      .set('Cookie', 'better-auth.session_token=not-a-real-token');

    expect(res.status).toBe(401);
  });

  // Otherwise an account that never paid gets the backup for free.
  it('answers 403 to an account with no subscription', async () => {
    const { cookies } = await signUp();

    const res = await request(app).get('/sync/pull').set('Cookie', cookies);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Subscription required' });
  });

  // Otherwise a subscription RevenueCat ended keeps backing up.
  it('answers 403 when the subscription has ended', async () => {
    const { userId, cookies } = await signUp();
    await db.insert(subscriptions).values({ userId, status: 'expired', expiresAt: FUTURE });

    const res = await request(app).get('/sync/pull').set('Cookie', cookies);

    expect(res.status).toBe(403);
  });

  // Otherwise a missed expiry webhook leaves a subscription that ran out working forever.
  it('answers 403 when an active subscription is past its expiry date', async () => {
    const { userId, cookies } = await signUp();
    await db.insert(subscriptions).values({ userId, status: 'active', expiresAt: PAST });

    const res = await request(app).get('/sync/pull').set('Cookie', cookies);

    expect(res.status).toBe(403);
  });

  // Otherwise one maker's subscription opens the backup for every account.
  it("answers 403 when the only subscription is another account's", async () => {
    const { cookies } = await signUp();
    await db.insert(user).values({ id: 'user_other', name: 'other', email: 'other@example.com' });
    await db
      .insert(subscriptions)
      .values({ userId: 'user_other', status: 'active', expiresAt: FUTURE });

    const res = await request(app).get('/sync/pull').set('Cookie', cookies);

    expect(res.status).toBe(403);
  });

  // Otherwise a paying maker is refused their own backup.
  it('lets an account with an active subscription through', async () => {
    const { userId, cookies } = await signUp();
    await db.insert(subscriptions).values({ userId, status: 'active', expiresAt: FUTURE });

    const res = await request(app).get('/sync/pull').set('Cookie', cookies);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });

  // Otherwise a maker whose purchase arrived with no expiry date pays and is still refused.
  it('lets an active subscription with no expiry date through', async () => {
    const { userId, cookies } = await signUp();
    await db.insert(subscriptions).values({ userId, status: 'active', expiresAt: null });

    const res = await request(app).get('/sync/pull').set('Cookie', cookies);

    expect(res.status).toBe(404);
  });

  // Otherwise the purchase webhook and the subscription check disagree, and a real purchase still gets 403.
  it('lets an account through after its purchase webhook arrives', async () => {
    const { userId, cookies } = await signUp();
    const before = await request(app).get('/sync/pull').set('Cookie', cookies);
    expect(before.status).toBe(403);

    await request(app)
      .post('/webhooks/revenuecat')
      .set('Authorization', process.env.REVENUECAT_WEBHOOK_AUTH_HEADER ?? '')
      .send({ event: { type: 'INITIAL_PURCHASE', app_user_id: userId, expiration_at_ms: null } });

    const after = await request(app).get('/sync/pull').set('Cookie', cookies);
    expect(after.status).toBe(404);
  });
});
