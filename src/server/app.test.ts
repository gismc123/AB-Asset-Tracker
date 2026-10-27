import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { actualTokenValidator } from './auth.js';
import { Store } from './db.js';
import { MortgageService } from './service.js';
import { FakeSource, MORTGAGE_CATEGORY, SAMPLE_SETUP } from './testing.js';

const GOOD = 'good-token';
let app: ReturnType<typeof createApp>;
let source: FakeSource;

beforeEach(() => {
  source = new FakeSource();
  const service = new MortgageService(new Store(':memory:'), source, () => '2025-06-15');
  app = createApp({ service, validateToken: async (t) => t === GOOD, uiDir: '/nonexistent' });
});

const authed = (r: request.Test) => r.set('x-actual-token', GOOD);

describe('HTTP API', () => {
  it('health needs no login', async () => {
    const res = await request(app).get('/mortgage-api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects requests without a valid Actual session', async () => {
    expect((await request(app).get('/mortgage-api/state')).status).toBe(401);
    expect((await request(app).get('/mortgage-api/state').set('x-actual-token', 'nope')).status).toBe(401);
    expect((await request(app).put('/mortgage-api/loan').send(SAMPLE_SETUP)).status).toBe(401);
  });

  it('serves a harmless inject.js even before the UI is built', async () => {
    const res = await request(app).get('/mortgage-addon/inject.js');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/javascript/);
  });

  it('runs the setup → match → flag → resolve loop end to end', async () => {
    const saved = await authed(request(app).put('/mortgage-api/loan').send(SAMPLE_SETUP));
    expect(saved.status).toBe(200);
    const first = saved.body.schedule.rows[0];

    await authed(request(app).put('/mortgage-api/settings').send({ categoryId: MORTGAGE_CATEGORY }));
    source.add('t1', '2025-04-01', -(first.total + 2));

    const cands = await authed(request(app).get('/mortgage-api/months/1/candidates'));
    expect(cands.body.map((c: { id: string }) => c.id)).toEqual(['t1']);

    const matched = await authed(request(app).post('/mortgage-api/months/1/match').send({ transactionId: 't1' }));
    expect(matched.body).toMatchObject({ status: 'flagged', difference: 2 });

    const resolved = await authed(request(app).post('/mortgage-api/months/1/resolve').send({ resolution: 'rounding' }));
    expect(resolved.status).toBe(200);
    expect(resolved.body.schedule.rows[0]).toMatchObject({ status: 'paid', pennyOffset: 2 });
  });

  it('returns readable 400s for bad input', async () => {
    const res = await authed(request(app).put('/mortgage-api/loan').send({ originalAmount: 'lots' }));
    expect(res.status).toBe(400);
    expect(res.body.details.problems.length).toBeGreaterThan(0);
    const bad = await authed(request(app).post('/mortgage-api/months/abc/match').send({}));
    expect(bad.status).toBe(400);
  });
});

describe('actualTokenValidator', () => {
  it('asks Actual and caches a valid answer', async () => {
    let calls = 0;
    const fake = (async (url: string, init?: RequestInit) => {
      calls++;
      expect(url).toBe('https://actual.test/account/validate');
      const ok = (init?.headers as Record<string, string>)['x-actual-token'] === GOOD;
      return new Response(JSON.stringify(ok ? { status: 'ok', data: { validated: true } } : { status: 'error' }), {
        status: ok ? 200 : 403,
      });
    }) as typeof fetch;
    const validate = actualTokenValidator('https://actual.test', fake);
    expect(await validate(GOOD)).toBe(true);
    expect(await validate(GOOD)).toBe(true);
    expect(calls).toBe(1);
    expect(await validate('bad')).toBe(false);
  });

  it('fails closed when Actual is unreachable', async () => {
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    expect(await actualTokenValidator('https://actual.test', down)(GOOD)).toBe(false);
  });
});
