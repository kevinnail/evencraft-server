import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import request from 'supertest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('resend', () => ({
  Resend: vi.fn(function () {
    return { emails: { send: sendMock } };
  }),
}));

import app from '../../src/app';
import { db } from '../../src/db/connection';
import { user, session, account, verification } from '../../src/db/schema';
import { resetDb } from '../helpers/db';

const NEW_ACCOUNT = {
  name: 'maker',
  email: 'maker@example.com',
  password: 'glass2026',
};

const NEW_PASSWORD = 'kiln2027';

beforeEach(async () => {
  await resetDb();
  sendMock.mockReset();
  sendMock.mockResolvedValue({ data: { id: 'msg_test' }, error: null });
});

// Creates the account, asks for a reset, and reads the token out of the emailed link.
async function requestResetToken(): Promise<string> {
  await request(app).post('/api/auth/sign-up/email').send(NEW_ACCOUNT);
  await request(app).post('/api/auth/request-password-reset').send({ email: NEW_ACCOUNT.email });

  const [sent] = sendMock.mock.calls[0] as [{ text: string }];
  const match = /\/reset-password\/([^?\s]+)/.exec(sent.text);
  if (!match?.[1]) throw new Error(`No reset token in the email: ${sent.text}`);
  return match[1];
}

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

describe('POST /api/auth/sign-in/email', () => {
  // Otherwise a maker on a new phone can't get into the account that holds their backup.
  it('signs in with the right password and starts a second session', async () => {
    await request(app).post('/api/auth/sign-up/email').send(NEW_ACCOUNT);

    const res = await request(app)
      .post('/api/auth/sign-in/email')
      .send({ email: NEW_ACCOUNT.email, password: NEW_ACCOUNT.password });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      redirect: false,
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
    const { token, user: signedInUser } = res.body as { token: string; user: { id: string } };

    const sessions = await db.select().from(session).where(eq(session.userId, signedInUser.id));
    expect(sessions).toHaveLength(2);
    expect(sessions.map((row) => row.token)).toContain(token);
  });

  // Otherwise anyone who knows a maker's email gets into their backup.
  it('refuses a wrong password and starts no session', async () => {
    await request(app).post('/api/auth/sign-up/email').send(NEW_ACCOUNT);

    const res = await request(app)
      .post('/api/auth/sign-in/email')
      .send({ email: NEW_ACCOUNT.email, password: 'wrong2026' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      code: 'INVALID_EMAIL_OR_PASSWORD',
      message: 'Invalid email or password',
    });
    expect(res.headers['set-cookie']).toBeUndefined();
    const sessions = await db.select().from(session);
    expect(sessions).toHaveLength(1);
  });
});

describe('POST /api/auth/sign-out', () => {
  // Otherwise a signed out phone's saved session still reaches the account's backup.
  it('ends the session on the server', async () => {
    const signUp = await request(app).post('/api/auth/sign-up/email').send(NEW_ACCOUNT);
    const cookies = signUp.headers['set-cookie'] as unknown as string[];

    const res = await request(app)
      .post('/api/auth/sign-out')
      .set('Cookie', cookies)
      .set('Origin', 'evencraft://');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    const sessions = await db.select().from(session);
    expect(sessions).toHaveLength(0);
  });

  // Otherwise a sign out request with no session could end someone else's.
  it('ends no session when the request has none', async () => {
    await request(app).post('/api/auth/sign-up/email').send(NEW_ACCOUNT);

    const res = await request(app).post('/api/auth/sign-out');

    expect(res.status).toBe(200);
    const sessions = await db.select().from(session);
    expect(sessions).toHaveLength(1);
  });
});

describe('POST /api/auth/request-password-reset', () => {
  // Otherwise a maker who forgot their password never gets a link, or gets one that doesn't open the app.
  it('sends one email with a link that opens the app', async () => {
    await request(app).post('/api/auth/sign-up/email').send(NEW_ACCOUNT);

    const res = await request(app)
      .post('/api/auth/request-password-reset')
      .send({ email: NEW_ACCOUNT.email });

    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      from: `EvenCraft <${process.env.EMAIL_FROM ?? ''}>`,
      to: NEW_ACCOUNT.email,
      subject: 'Reset your EvenCraft password',
      text: expect.stringMatching(
        /^Reset link: http:\/\/localhost:7890\/api\/auth\/reset-password\/[A-Za-z0-9_-]+\?callbackURL=evencraft%3A%2F%2Freset-password$/,
      ) as string,
    });
  });

  // Otherwise the answer tells a stranger which emails have accounts.
  it('answers the same for an email with no account and sends nothing', async () => {
    const res = await request(app)
      .post('/api/auth/request-password-reset')
      .send({ email: 'nobody@example.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: true,
      message: 'If this email exists in our system, check your email for the reset link',
    });
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/auth/reset-password/:token', () => {
  // Otherwise tapping the emailed link never reaches the app's new password screen.
  it('sends the phone on to the app with the token', async () => {
    const token = await requestResetToken();

    const res = await request(app)
      .get(`/api/auth/reset-password/${token}`)
      .query({ callbackURL: 'evencraft://reset-password' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`evencraft://reset-password?token=${token}`);
  });
});

describe('POST /api/auth/reset-password', () => {
  // Otherwise the maker stays locked out, or the forgotten password still opens the account.
  it('sets the new password, which signs in while the old one is refused', async () => {
    const token = await requestResetToken();

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: true });

    const oldPassword = await request(app)
      .post('/api/auth/sign-in/email')
      .send({ email: NEW_ACCOUNT.email, password: NEW_ACCOUNT.password });
    expect(oldPassword.status).toBe(401);

    const newPassword = await request(app)
      .post('/api/auth/sign-in/email')
      .send({ email: NEW_ACCOUNT.email, password: NEW_PASSWORD });
    expect(newPassword.status).toBe(200);
  });

  // Otherwise anyone who later finds the email can change the password again.
  it('refuses a token that was already used and keeps the password', async () => {
    const token = await requestResetToken();
    await request(app).post('/api/auth/reset-password').send({ token, newPassword: NEW_PASSWORD });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'another2028' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: 'INVALID_TOKEN', message: 'Invalid token' });
    const signIn = await request(app)
      .post('/api/auth/sign-in/email')
      .send({ email: NEW_ACCOUNT.email, password: NEW_PASSWORD });
    expect(signIn.status).toBe(200);
  });

  // Otherwise a link left in an old email works forever.
  it('refuses an expired token and keeps the password', async () => {
    const token = await requestResetToken();
    await db
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verification.identifier, `reset-password:${token}`));

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: 'INVALID_TOKEN', message: 'Invalid token' });
    const signIn = await request(app)
      .post('/api/auth/sign-in/email')
      .send({ email: NEW_ACCOUNT.email, password: NEW_ACCOUNT.password });
    expect(signIn.status).toBe(200);
  });
});
