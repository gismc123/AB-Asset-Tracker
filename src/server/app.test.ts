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
  app = createApp({ service, validateToken: async (t) => t === GOOD, uiDir: '/nonexistent', summaryToken: undefined });
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

  it('skips a payment, records escrow and home values, and saves details', async () => {
    await authed(request(app).put('/mortgage-api/loan').send(SAMPLE_SETUP));
    const skipped = await authed(request(app).post('/mortgage-api/months/2/skip').send({ mode: 'defer' }));
    expect(skipped.body.schedule.rows[1].status).toBe('skipped');
    expect((await authed(request(app).post('/mortgage-api/months/2/unskip'))).body.schedule.rows[1].status).toBe('scheduled');

    const esc = await authed(request(app).post('/mortgage-api/escrow/entries').send({ date: '2025-05-01', kind: 'propertyTax', amount: 90_000 }));
    const entryId = esc.body.analysis.escrow.lines[0].entryId;
    expect((await authed(request(app).delete(`/mortgage-api/escrow/entries/${entryId}`))).status).toBe(200);

    const hv = await authed(request(app).post('/mortgage-api/home-values').send({ date: '2025-05-01', value: 36_000_000 }));
    expect(hv.body.analysis.equity.homeValue).toBe(36_000_000);
    expect((await authed(request(app).delete(`/mortgage-api/home-values/${hv.body.homeValues[0].id}`))).status).toBe(200);

    const det = await authed(request(app).put('/mortgage-api/details').send({ fields: { servicerName: 'Sample Servicing Co' } }));
    expect(det.body.details.fields.servicerName).toBe('Sample Servicing Co');
    expect((await request(app).put('/mortgage-api/details').send({ fields: {} })).status).toBe(401);
    expect((await authed(request(app).delete('/mortgage-api/home-values/abc'))).status).toBe(400);
  });

  it('returns readable 400s for bad input', async () => {
    const res = await authed(request(app).put('/mortgage-api/loan').send({ originalAmount: 'lots' }));
    expect(res.status).toBe(400);
    expect(res.body.details.problems.length).toBeGreaterThan(0);
    const bad = await authed(request(app).post('/mortgage-api/months/abc/match').send({}));
    expect(bad.status).toBe(400);
  });
});

describe('read-only summary endpoint', () => {
  const SUMMARY = 'mirror-token-example';
  let svc: MortgageService;
  const withToken = () => createApp({ service: svc, validateToken: async () => false, uiDir: '/nonexistent', summaryToken: SUMMARY });

  beforeEach(() => {
    svc = new MortgageService(new Store(':memory:'), new FakeSource(), () => '2025-06-15');
  });

  it('is disabled unless SUMMARY_TOKEN is set', async () => {
    expect((await request(app).get('/mortgage-api/v1/summary?token=anything')).status).toBe(404);
  });

  it('requires the summary token, by query or bearer header', async () => {
    svc.saveSetup(SAMPLE_SETUP);
    const a = withToken();
    expect((await request(a).get('/mortgage-api/v1/summary')).status).toBe(401);
    expect((await request(a).get('/mortgage-api/v1/summary?token=wrong')).status).toBe(401);
    expect((await request(a).get(`/mortgage-api/v1/summary?token=${SUMMARY}`)).status).toBe(200);
    expect((await request(a).get('/mortgage-api/v1/summary').set('authorization', `Bearer ${SUMMARY}`)).status).toBe(200);
  });

  it('says so when the loan is not set up', async () => {
    expect((await request(withToken()).get(`/mortgage-api/v1/summary?token=${SUMMARY}`)).status).toBe(409);
  });

  it('returns payment number, balance, percent paid, equity, and PMI countdown', async () => {
    svc.saveSetup(SAMPLE_SETUP);
    const res = await request(withToken()).get(`/mortgage-api/v1/summary?token=${SUMMARY}`);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      version: 1,
      asOf: '2025-06-15',
      paymentNumber: 0,
      totalPayments: 360,
      balance: 320_000,
      percentPaid: 0,
      equity: 35_000,
      nextPayment: { number: 1, dueDate: '2025-04-01' },
      pmi: { active: true, monthly: 148 },
    });
    expect(res.body.pmi.paymentsUntilDrop).toBeGreaterThan(0);
    expect(res.body.pmi.dropDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.pmi.requestRemovalDate < res.body.pmi.automaticRemovalDate).toBe(true);
  });

  it('never includes loan details such as the account number', async () => {
    svc.saveSetup(SAMPLE_SETUP);
    svc.saveDetails({ fields: { loanNumber: 'SAMPLE-0000-9999', servicerName: 'Sample Servicing Co' } });
    const res = await request(withToken()).get(`/mortgage-api/v1/summary?token=${SUMMARY}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/SAMPLE-0000-9999|Sample Servicing/);
  });

  it('never accepts the summary token for the full API', async () => {
    const res = await request(withToken()).get('/mortgage-api/state').set('x-actual-token', SUMMARY);
    expect(res.status).toBe(401);
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
