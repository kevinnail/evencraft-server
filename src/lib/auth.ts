import { betterAuth } from 'better-auth';
import { expo } from '@better-auth/expo';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '../db/connection';
import * as schema from '../db/schema';

const baseURL = process.env.BETTER_AUTH_URL;
if (!baseURL) throw new Error('BETTER_AUTH_URL is not set');

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret) throw new Error('BETTER_AUTH_SECRET is not set');

export const auth = betterAuth({
  baseURL,
  secret,
  trustedOrigins: ['evencraft://', ...(process.env.NODE_ENV !== 'production' ? ['exp://*'] : [])],

  // Railway's edge (Envoy) sets x-envoy-external-address to the real external client IP as a
  // single, connection-derived value. Unlike the x-forwarded-for chain, whose left-most entry a
  // client can inject, this can't be spoofed through a request header, so per-IP rate limits
  // below track the real caller.
  advanced: {
    ipAddress: {
      ipAddressHeaders: ['x-envoy-external-address'],
    },
  },

  // On in production only (better-auth's default), so the test suite's rapid sign-ups aren't
  // throttled. These rules tighten the endpoints open to abuse: password guessing on sign-in and
  // mass account creation.
  rateLimit: {
    enabled: process.env.NODE_ENV === 'production',
    storage: 'memory',
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 3600, max: 10 },
    },
  },

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  plugins: [expo()],
});
