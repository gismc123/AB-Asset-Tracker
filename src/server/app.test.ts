import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { actualTokenValidator } from './auth.js';
import { Store } from './db.js';
import { TrackerService } from './service.js';
import { AUTO_SETUP, FakeSource, MORTGAGE_CATEGORY, SAMPLE_SETUP } from './testing.js';

const GOOD = 'good-token';
const API = '/asset-tracker-api';
let app: ReturnType<typeof createApp>;
let source: FakeSource;

beforeEach(() => {
  source = new FakeSource();
  const service = new TrackerService(new Store(':memory:'), source, () => '2025-06-15');
  app = createApp({ service, validateToken: async (t) => t === GOOD, uiDir: '/nonexistent', summaryToken: undefined });
});

const authed = (r: request.Test) => r.set('x-actual-token', GOOD);

async function newLoan(body: Record<string, unknown> = { nickname: 'Mortgage', type: 'mortgage', setup: SAMPLE_SETUP }) {
  const res = await authed(request(app).post(`${API}/loans`).send(body));
  expect(res.status).toBe(201);
  return res.body.loan.id as number;
}

describe('HTTP API', () => {
  it('health needs no login', async () => {
    const res = await request(app).get(`${API}/health`);
    expect(res.status).toBe(200);
    // Only whether Actual is connected: its errors and sync times need a login.
    expect(res.body).toEqual({ ok: true, actual: { connected: true } });
  });

  it('records and undoes a PMI removal', async () => {
    const id = await newLoan({ nickname: 'Mortgage', type: 'mortgage', setup: { ...SAMPLE_SETUP, pmiRemovalRule: 'untilRemoved' } });
    const set = await authed(request(app).put(`${API}/loans/${id}/pmi/removal`).send({ fromPayment: 100 }));
    expect(set.status).toBe(200);
    expect(set.body.schedule.pmi.dropPayment).toBe(100);
    const cleared = await authed(request(app).delete(`${API}/loans/${id}/pmi/removal`));
    expect(cleared.status).toBe(200);
    expect(cleared.body.summary.pmi).toMatchObject({ dropPayment: null, removalRule: 'untilRemoved' });
    expect((await request(app).put(`${API}/loans/${id}/pmi/removal`).send({ fromPayment: 100 })).status).toBe(401);
  });

  it('rejects requests without a valid Actual session', async () => {
    expect((await request(app).get(`${API}/loans`)).status).toBe(401);
    expect((await request(app).get(`${API}/loans/1/state`).set('x-actual-token', 'nope')).status).toBe(401);
    expect((await request(app).post(`${API}/loans`).send({ nickname: 'x', type: 'auto' })).status).toBe(401);
    expect((await request(app).post(`${API}/assets`).send({})).status).toBe(401);
  });

  it('serves a harmless inject.js even before the UI is built', async () => {
    const res = await request(app).get('/asset-tracker-addon/inject.js');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/javascript/);
  });

  it('runs the create → match → flag → resolve loop end to end', async () => {
    const id = await newLoan();
    const state = await authed(request(app).get(`${API}/loans/${id}/state`));
    const first = state.body.schedule.rows[0];

    await authed(request(app).put(`${API}/loans/${id}/settings`).send({ categoryId: MORTGAGE_CATEGORY }));
    source.add('t1', '2025-04-01', -(first.total + 2));

    const cands = await authed(request(app).get(`${API}/loans/${id}/months/1/candidates`));
    expect(cands.body.map((c: { id: string }) => c.id)).toEqual(['t1']);

    const matched = await authed(request(app).post(`${API}/loans/${id}/months/1/match`).send({ transactionId: 't1' }));
    expect(matched.body).toMatchObject({ status: 'flagged', difference: 2 });

    const resolved = await authed(request(app).post(`${API}/loans/${id}/months/1/resolve`).send({ resolution: 'rounding' }));
    expect(resolved.status).toBe(200);
    expect(resolved.body.schedule.rows[0]).toMatchObject({ status: 'paid', pennyOffset: 2 });
  });

  it('skips a payment, records escrow and asset values, and saves details', async () => {
    const id = await newLoan();
    const skipped = await authed(request(app).post(`${API}/loans/${id}/months/2/skip`).send({ mode: 'defer' }));
    expect(skipped.body.schedule.rows[1].status).toBe('skipped');
    expect((await authed(request(app).post(`${API}/loans/${id}/months/2/unskip`))).body.schedule.rows[1].status).toBe('scheduled');

    const esc = await authed(request(app).post(`${API}/loans/${id}/escrow/entries`).send({ date: '2025-05-01', kind: 'propertyTax', amount: 90_000 }));
    const entryId = esc.body.analysis.escrow.lines[0].entryId;
    expect((await authed(request(app).delete(`${API}/loans/${id}/escrow/entries/${entryId}`))).status).toBe(200);

    const assetId = esc.body.asset.id;
    const hv = await authed(request(app).post(`${API}/assets/${assetId}/values`).send({ date: '2025-05-01', value: 36_000_000 }));
    expect(hv.status).toBe(201);
    const state = await authed(request(app).get(`${API}/loans/${id}/state`));
    expect(state.body.analysis.equity.homeValue).toBe(36_000_000);
    expect((await authed(request(app).delete(`${API}/assets/${assetId}/values/${hv.body.values[0].id}`))).status).toBe(200);

    const det = await authed(request(app).put(`${API}/loans/${id}/details`).send({ fields: { servicerName: 'Sample Servicing Co' } }));
    expect(det.body.details.fields.servicerName).toBe('Sample Servicing Co');
    expect((await request(app).put(`${API}/loans/${id}/details`).send({ fields: {} })).status).toBe(401);
    expect((await authed(request(app).delete(`${API}/assets/${assetId}/values/abc`))).status).toBe(400);
  });

  it('returns readable 400s and 404s for bad input', async () => {
    const res = await authed(request(app).post(`${API}/loans`).send({ nickname: 'Bad', type: 'mortgage', setup: { originalAmount: 'lots' } }));
    expect(res.status).toBe(400);
    expect(res.body.details.problems.length).toBeGreaterThan(0);
    // Nothing was created by the failed request.
    expect((await authed(request(app).get(`${API}/loans`))).body).toEqual([]);
    expect((await authed(request(app).post(`${API}/loans`).send({ nickname: '', type: 'auto' }))).status).toBe(400);
    expect((await authed(request(app).post(`${API}/loans`).send({ nickname: 'Boat', type: 'boat' }))).status).toBe(400);
    const id = await newLoan();
    expect((await authed(request(app).post(`${API}/loans/${id}/months/abc/match`).send({}))).status).toBe(400);
    expect((await authed(request(app).get(`${API}/loans/999/state`))).status).toBe(404);
    expect((await authed(request(app).get(`${API}/loans/abc/state`))).status).toBe(400);
  });
});

describe('loans', () => {
  it('lists, renames, archives and deletes loans', async () => {
    const home = await newLoan();
    const car = await newLoan({
      nickname: 'Hatchback',
      type: 'auto',
      setup: AUTO_SETUP,
      asset: { name: 'Sample hatchback', kind: 'vehicle', originalValue: 3_600_000, valueTrend: 'depreciating', trendRatePercent: 15, acquiredDate: '2025-03-10' },
    });
    const personal = await newLoan({ nickname: 'Personal', type: 'personal' });

    const list = (await authed(request(app).get(`${API}/loans`))).body;
    expect(list.map((l: { loan: { nickname: string } }) => l.loan.nickname)).toEqual(['Mortgage', 'Hatchback', 'Personal']);
    expect(list[0]).toMatchObject({ configured: true, asset: { kind: 'home' } });
    expect(list[0].equity).toBe(list[0].assetValue - list[0].owed);
    expect(list[1]).toMatchObject({ configured: true, asset: { kind: 'vehicle', name: 'Sample hatchback' }, assetValue: 3_600_000 });
    expect(list[2]).toMatchObject({ configured: false, asset: null, owed: null, equity: null });

    const renamed = await authed(request(app).patch(`${API}/loans/${car}`).send({ nickname: 'Family car' }));
    expect(renamed.body).toMatchObject({ id: car, nickname: 'Family car', type: 'auto' });

    expect((await authed(request(app).post(`${API}/loans/${home}/archive`))).body.archived).toBe(true);
    const afterArchive = (await authed(request(app).get(`${API}/loans`))).body;
    // Archived loans sort last.
    expect(afterArchive.at(-1).loan).toMatchObject({ id: home, archived: true });
    expect((await authed(request(app).post(`${API}/loans/${home}/unarchive`))).body.archived).toBe(false);

    expect((await authed(request(app).delete(`${API}/loans/${personal}`))).status).toBe(400);
    expect((await authed(request(app).delete(`${API}/loans/${personal}?confirm=Personal`))).status).toBe(200);
    expect((await authed(request(app).get(`${API}/loans/${personal}/state`))).status).toBe(404);
  });

  it('keeps every loan\'s data separate', async () => {
    const a = await newLoan();
    const b = await newLoan({ nickname: 'Second', type: 'mortgage', setup: { ...SAMPLE_SETUP, originalAmount: 20_000_000 } });
    await authed(request(app).put(`${API}/loans/${a}/settings`).send({ categoryId: MORTGAGE_CATEGORY }));
    await authed(request(app).put(`${API}/loans/${b}/settings`).send({ categoryId: 'cat-utilities' }));
    await authed(request(app).post(`${API}/loans/${a}/months/3/skip`).send({ mode: 'capitalize' }));
    await authed(request(app).post(`${API}/loans/${a}/escrow/entries`).send({ date: '2025-05-01', kind: 'hoa', amount: 5_000 }));

    const sa = (await authed(request(app).get(`${API}/loans/${a}/state`))).body;
    const sb = (await authed(request(app).get(`${API}/loans/${b}/state`))).body;
    expect(sa.settings.categoryId).toBe(MORTGAGE_CATEGORY);
    expect(sb.settings.categoryId).toBe('cat-utilities');
    expect(sa.schedule.rows[2].status).toBe('skipped');
    expect(sb.schedule.rows[2].status).toBe('scheduled');
    expect(sb.adjustments).toEqual([]);
    expect(sb.analysis.escrow.lines).toEqual([]);
    expect(sa.asset.id).not.toBe(sb.asset.id);
    // An escrow entry can't be deleted through another loan.
    const entryId = sa.analysis.escrow.lines.find((l: { entryId: number | null }) => l.entryId).entryId;
    expect((await authed(request(app).delete(`${API}/loans/${b}/escrow/entries/${entryId}`))).status).toBe(404);
  });

  it('manages assets and links at most one to a loan', async () => {
    const id = await newLoan({ nickname: 'Personal', type: 'personal' });
    const created = await authed(request(app).post(`${API}/assets`).send({ name: 'Boat', kind: 'other', originalValue: 1_500_000, loanId: id }));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ loanId: id, valueTrend: 'manual', trendRatePercent: null, values: [] });
    const clash = await authed(request(app).post(`${API}/assets`).send({ name: 'Trailer', kind: 'other', originalValue: 1, loanId: id }));
    expect(clash.status).toBe(409);
    const patched = await authed(request(app).patch(`${API}/assets/${created.body.id}`).send({ valueTrend: 'depreciating', trendRatePercent: 8 }));
    expect(patched.body).toMatchObject({ name: 'Boat', valueTrend: 'depreciating', trendRatePercent: 8 });
    expect((await authed(request(app).get(`${API}/assets`))).body).toHaveLength(1);
    expect((await authed(request(app).patch(`${API}/assets/${created.body.id}`).send({ kind: 'spaceship' }))).status).toBe(400);
    expect((await authed(request(app).delete(`${API}/assets/${created.body.id}`))).status).toBe(200);
    expect((await authed(request(app).get(`${API}/assets`))).body).toEqual([]);
  });

  it('deletes a loan\'s asset with it, unless asked to keep it', async () => {
    const a = await newLoan();
    const b = await newLoan({ nickname: 'Second', type: 'mortgage', setup: SAMPLE_SETUP });
    await authed(request(app).delete(`${API}/loans/${a}?confirm=Mortgage`));
    expect((await authed(request(app).get(`${API}/assets`))).body.map((x: { loanId: number }) => x.loanId)).toEqual([b]);
    await authed(request(app).delete(`${API}/loans/${b}?confirm=Second&keepAsset=1`));
    expect((await authed(request(app).get(`${API}/assets`))).body).toMatchObject([{ loanId: null, kind: 'home' }]);
  });
});

describe('read-only summary endpoint', () => {
  const SUMMARY = 'mirror-token-example-0123456789';
  let svc: TrackerService;
  const withToken = () => createApp({ service: svc, validateToken: async () => false, uiDir: '/nonexistent', summaryToken: SUMMARY });
  const bearer = (r: request.Test) => r.set('authorization', `Bearer ${SUMMARY}`);

  beforeEach(() => {
    svc = new TrackerService(new Store(':memory:'), new FakeSource(), () => '2025-06-15');
  });

  it('is disabled unless SUMMARY_TOKEN is set', async () => {
    expect((await request(app).get(`${API}/v1/summary`).set('authorization', 'Bearer anything')).status).toBe(404);
  });

  it('takes the token as a bearer header, and still accepts the deprecated query form', async () => {
    svc.createLoan({ nickname: 'Mortgage', type: 'mortgage', setup: SAMPLE_SETUP });
    const a = withToken();
    expect((await request(a).get(`${API}/v1/summary`)).status).toBe(401);
    expect((await request(a).get(`${API}/v1/summary`).set('authorization', 'Bearer wrong')).status).toBe(401);
    const viaHeader = await bearer(request(a).get(`${API}/v1/summary`));
    expect(viaHeader.status).toBe(200);
    expect(viaHeader.headers.deprecation).toBeUndefined();
    const viaQuery = await request(a).get(`${API}/v1/summary?token=${SUMMARY}`);
    expect(viaQuery.status).toBe(200);
    expect(viaQuery.headers.deprecation).toBe('true');
    expect((await request(a).get(`${API}/v1/summary?token=wrong`)).status).toBe(401);
  });

  it('returns every active loan, or one with ?loan=', async () => {
    const { loan: home } = svc.createLoan({ nickname: 'Mortgage', type: 'mortgage', setup: SAMPLE_SETUP });
    const { loan: car } = svc.createLoan({
      nickname: 'Hatchback', type: 'auto', setup: AUTO_SETUP,
      asset: { name: 'Sample hatchback', kind: 'vehicle', originalValue: 3_600_000, valueTrend: 'depreciating', trendRatePercent: 15 },
    });
    svc.createLoan({ nickname: 'Not set up yet', type: 'personal' });
    const { loan: old } = svc.createLoan({ nickname: 'Old', type: 'personal', setup: { ...AUTO_SETUP, termMonths: 12 } });
    svc.setArchived(old.id, true);

    const all = await bearer(request(withToken()).get(`${API}/v1/summary`));
    expect(all.headers['cache-control']).toBe('no-store');
    expect(all.body).toMatchObject({ version: 2, asOf: '2025-06-15' });
    expect(all.body.loans.map((l: { nickname: string }) => l.nickname)).toEqual(['Mortgage', 'Hatchback']);

    const one = await bearer(request(withToken()).get(`${API}/v1/summary?loan=${home.id}`));
    expect(one.body).toMatchObject({
      version: 2,
      id: home.id,
      nickname: 'Mortgage',
      type: 'mortgage',
      asOf: '2025-06-15',
      paymentNumber: 0,
      totalPayments: 360,
      balance: 320_000,
      owed: 320_000,
      percentPaid: 0,
      asset: { kind: 'home', value: 355_000, valueEntered: false },
      equity: 35_000,
      nextPayment: { number: 1, dueDate: '2025-04-01' },
      pmi: { active: true, monthly: 148 },
    });
    expect(one.body.pmi.requestRemovalDate < one.body.pmi.automaticRemovalDate).toBe(true);

    const auto = await bearer(request(withToken()).get(`${API}/v1/summary?loan=${car.id}`));
    expect(auto.body).toMatchObject({ type: 'auto', pmi: null, asset: { kind: 'vehicle', value: 36_000 }, equity: 36_000 - 30_000 });
    expect(auto.body.asset.projectedValue).toBeLessThan(36_000);
    expect(auto.body.payoff).toMatchObject({ source: 'estimate', asOf: '2025-06-15' });

    expect((await bearer(request(withToken()).get(`${API}/v1/summary?loan=999`))).status).toBe(404);
    expect((await bearer(request(withToken()).get(`${API}/v1/summary?loan=3`))).status).toBe(409);
  });

  it('never includes loan details such as the account number', async () => {
    const { loan } = svc.createLoan({ nickname: 'Mortgage', type: 'mortgage', setup: SAMPLE_SETUP });
    svc.loan(loan.id).saveDetails({ fields: { loanNumber: 'SAMPLE-0000-9999', servicerName: 'Sample Servicing Co', notes: 'Made-up note' } });
    for (const url of [`${API}/v1/summary`, `${API}/v1/summary?loan=${loan.id}`]) {
      const res = await bearer(request(withToken()).get(url));
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/SAMPLE-0000-9999|Sample Servicing|Made-up note|details/);
    }
  });

  it('never accepts the summary token for the full API', async () => {
    const res = await request(withToken()).get(`${API}/loans`).set('x-actual-token', SUMMARY);
    expect(res.status).toBe(401);
    expect((await bearer(request(withToken()).get(`${API}/loans`))).status).toBe(401);
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
