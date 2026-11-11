import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../src/app';

describe('GET /health', () => {
  // Otherwise Railway's health check fails and the deploy never goes live.
  it('returns 200 with status ok and an ISO timestamp', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', timestamp: expect.any(String) as string });
    const { timestamp } = res.body as { timestamp: string };
    expect(new Date(timestamp).toISOString()).toBe(timestamp);
  });
});

describe('unknown route', () => {
  // Otherwise the app gets an HTML page it can't parse instead of a JSON error it can report.
  it('returns 404 with a JSON error', async () => {
    const res = await request(app).get('/not-a-route');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });
});
