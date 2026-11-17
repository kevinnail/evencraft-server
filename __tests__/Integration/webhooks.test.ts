import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { db } from '../../src/db/connection';
import { subscriptions, user } from '../../src/db/schema';
import { resetDb } from '../helpers/db';

const WEBHOOK_SECRET = process.env.REVENUECAT_WEBHOOK_AUTH_HEADER ?? '';

const USER_ID = 'user_maker_001';
const PRODUCT_ID = 'evencraft_backup_yearly';
const EXPIRES_AT_MS = Date.UTC(2099, 0, 1);

function buildBody(eventFields: Record<string, unknown> = {}) {
  return {
    api_version: '1.0',
    event: {
      type: 'INITIAL_PURCHASE',
      app_user_id: USER_ID,
      product_id: PRODUCT_ID,
      expiration_at_ms: EXPIRES_AT_MS,
      ...eventFields,
    },
  };
}

function postWebhook(body: object) {
  return request(app).post('/webhooks/revenuecat').set('Authorization', WEBHOOK_SECRET).send(body);
}

beforeEach(async () => {
  await resetDb();
  await db.insert(user).values({ id: USER_ID, name: 'maker', email: 'maker@example.com' });
});

describe('POST /webhooks/revenuecat', () => {
  // Otherwise a maker who pays is never marked subscribed and every backup is refused.
  it('makes the account subscribed on a purchase', async () => {
    const res = await postWebhook(buildBody());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const rows = await db.select().from(subscriptions);
    expect(rows).toEqual([
      {
        userId: USER_ID,
        status: 'active',
        productId: PRODUCT_ID,
        expiresAt: new Date(EXPIRES_AT_MS),
        updatedAt: expect.any(Date) as Date,
      },
    ]);
  });

  // Otherwise a purchase RevenueCat sends without an expiry date is dropped or saved with a wrong one.
  it('saves a purchase with no expiry date as active with no end', async () => {
    const res = await postWebhook(buildBody({ expiration_at_ms: null }));

    expect(res.status).toBe(200);
    const rows = await db.select().from(subscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('active');
    expect(rows[0]?.expiresAt).toBeNull();
  });

  // Otherwise a subscription that ran out keeps backing up for free.
  it('ends the subscription on an expiry', async () => {
    await postWebhook(buildBody());

    const res = await postWebhook(buildBody({ type: 'EXPIRATION' }));

    expect(res.status).toBe(200);
    const rows = await db.select().from(subscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('expired');
  });

  // Otherwise each renewal adds a row, or the account keeps last year's expiry and is refused.
  it('moves the expiry forward on a renewal without adding a row', async () => {
    await postWebhook(buildBody({ expiration_at_ms: Date.UTC(2050, 0, 1) }));

    const renewedExpiry = Date.UTC(2051, 0, 1);
    const res = await postWebhook(buildBody({ type: 'RENEWAL', expiration_at_ms: renewedExpiry }));

    expect(res.status).toBe(200);
    const rows = await db.select().from(subscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('active');
    expect(rows[0]?.expiresAt?.getTime()).toBe(renewedExpiry);
  });

  // Otherwise a renewal that arrives while the app is signed out never reaches the account, and a paying maker is refused.
  it("finds the account in aliases when app_user_id is the app's anonymous id", async () => {
    const anonymousId = '$RCAnonymousID:d0f81ecd1586424db65f5a6c3459475d';

    const res = await postWebhook(
      buildBody({ type: 'RENEWAL', app_user_id: anonymousId, aliases: [anonymousId, USER_ID] }),
    );

    expect(res.status).toBe(200);
    const rows = await db.select().from(subscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(USER_ID);
    expect(rows[0]?.status).toBe('active');
  });

  // Otherwise a purchase made before signing in answers with an error, and RevenueCat retries it for over an hour.
  it('answers 200 and saves nothing when no id matches an account', async () => {
    const anonymousId = '$RCAnonymousID:8ce852924d8e4adaa1d22fa9ab00441d';

    const res = await postWebhook(buildBody({ app_user_id: anonymousId, aliases: [anonymousId] }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ignored: 'no matching user' });
    const rows = await db.select().from(subscriptions);
    expect(rows).toHaveLength(0);
  });

  // Otherwise anyone who finds the address can mark any account subscribed.
  it('refuses a missing secret and saves nothing', async () => {
    const res = await request(app).post('/webhooks/revenuecat').send(buildBody());

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    const rows = await db.select().from(subscriptions);
    expect(rows).toHaveLength(0);
  });

  // Otherwise a guessed secret of the right length gets through the constant time check.
  it('refuses a wrong secret of the same length and saves nothing', async () => {
    const res = await request(app)
      .post('/webhooks/revenuecat')
      .set('Authorization', 'X'.repeat(WEBHOOK_SECRET.length))
      .send(buildBody());

    expect(res.status).toBe(401);
    const rows = await db.select().from(subscriptions);
    expect(rows).toHaveLength(0);
  });

  // Otherwise an event type this server doesn't handle fails, and RevenueCat keeps retrying it.
  it('answers 200 and changes nothing for an event type it does not handle', async () => {
    await postWebhook(buildBody());

    const res = await postWebhook(buildBody({ type: 'BILLING_ISSUE' }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ignored: 'BILLING_ISSUE' });
    const rows = await db.select().from(subscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('active');
  });

  // Otherwise a transfer event moves or ends a subscription that is meant to stay with the account that bought it.
  it('answers 200 to a transfer and leaves the subscription with its account', async () => {
    await postWebhook(buildBody());

    const res = await postWebhook({
      api_version: '1.0',
      event: { type: 'TRANSFER', transferred_from: [USER_ID], transferred_to: ['user_other'] },
    });

    expect(res.status).toBe(200);
    const rows = await db.select().from(subscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(USER_ID);
    expect(rows[0]?.status).toBe('active');
  });

  // Otherwise a body with no event crashes the handler into a 500.
  it('refuses a body with no event type', async () => {
    const res = await postWebhook({ api_version: '1.0', event: { app_user_id: USER_ID } });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'malformed event' });
    const rows = await db.select().from(subscriptions);
    expect(rows).toHaveLength(0);
  });
});
