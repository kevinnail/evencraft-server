import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import app from '../../src/app';
import { db } from '../../src/db/connection';
import { user, session, account } from '../../src/db/schema';
import { resetDb } from '../helpers/db';

const NEW_ACCOUNT = {
  name: 'maker',
  email: 'maker@example.com',
  password: 'glass2026',
};

beforeEach(async () => {
  await resetDb();
});

describe('POST /api/auth/sign-up/email', () => {
  // Otherwise a maker who creates an account isn't signed in, or the account isn't saved for the next sign in.
  it('creates the user, a hashed credential, and a session', async () => {
    const res = await request(app).post('/api/auth/sign-up/email').send(NEW_ACCOUNT);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      token: expect.any(String) as string,
      user: {
        id: expect.any(String) as string,
        name: NEW_ACCOUNT.name,
        email: NEW_ACCOUNT.email,
        emailVerified: false,
        image: null,
        createdAt: expect.any(String) as string,
        updatedAt: expect.any(String) as string,
      },
    });
    const { user: createdUser } = res.body as { user: { id: string } };

    const users = await db.select().from(user).where(eq(user.email, NEW_ACCOUNT.email));
    expect(users).toHaveLength(1);

    const accounts = await db.select().from(account).where(eq(account.userId, createdUser.id));
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.providerId).toBe('credential');
    expect(accounts[0]?.password).not.toBe(NEW_ACCOUNT.password);

    const sessions = await db.select().from(session).where(eq(session.userId, createdUser.id));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  // Otherwise a second account on the same email could take over the first one's backup.
  it('refuses the same email twice and keeps only the first account', async () => {
    const first = await request(app).post('/api/auth/sign-up/email').send(NEW_ACCOUNT);
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/auth/sign-up/email')
      .send({ ...NEW_ACCOUNT, password: 'another2026' });

    expect(second.status).toBe(422);
    expect(second.body).toEqual({
      code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
      message: 'User already exists. Use another email.',
    });
    const users = await db.select().from(user).where(eq(user.email, NEW_ACCOUNT.email));
    expect(users).toHaveLength(1);
  });

  // Otherwise the server accepts a password the app's own form would refuse as too short.
  it('refuses a password under 8 characters and saves nothing', async () => {
    const res = await request(app)
      .post('/api/auth/sign-up/email')
      .send({ ...NEW_ACCOUNT, password: 'glass26' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: 'PASSWORD_TOO_SHORT', message: 'Password too short' });
    const users = await db.select().from(user);
    expect(users).toHaveLength(0);
  });
});
