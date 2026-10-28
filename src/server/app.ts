import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { SourceUnavailable } from './actual.js';
import { backupFileName } from './backup.js';
import type { LoanSummary } from '../engine/index.js';
import type { LoanRecord } from './db.js';
import type { TokenValidator } from './auth.js';
import { HttpError, type TrackerService } from './service.js';

export interface AppDeps {
  service: TrackerService;
  validateToken: TokenValidator;
  /** Folder with the built inject.js. */
  uiDir: string;
  /** Token for the read-only summary endpoint. Undefined = endpoint disabled. */
  summaryToken: string | undefined;
}

/** Mount points shared with the proxy config. */
export const API_PREFIX = '/asset-tracker-api';
export const ADDON_PREFIX = '/asset-tracker-addon';

function sameToken(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const intParam = (req: Request, name: string, label = name) => {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `${label} must be a positive whole number`);
  return n;
};
const paymentParam = (req: Request) => intParam(req, 'payment', 'Payment number');
const idParam = (req: Request) => intParam(req, 'id');

let warnedQueryToken = false;

export function createApp(deps: AppDeps) {
  const { service } = deps;
  const app = express();
  app.disable('x-powered-by');
  // A restore carries the whole tracker, so it gets a bigger limit of its
  // own, applied only after the login check.
  const smallJson = express.json({ limit: '100kb' });
  app.use((req, res, next) => (req.path === `${API_PREFIX}/restore` ? next() : smallJson(req, res, next)));

  // --- static add-on files (no data in them, so no auth) -----------------
  app.get(`${ADDON_PREFIX}/inject.js`, (_req, res) => {
    const file = path.join(deps.uiDir, 'inject.js');
    if (!fs.existsSync(file)) {
      // Serve a harmless no-op so Actual keeps working even if the build is missing.
      res.type('application/javascript').send('console.warn("[asset-tracker] add-on UI is not built");');
      return;
    }
    // COEP require-corp on Actual's page: same-origin is fine, but be explicit.
    res.set('Cross-Origin-Resource-Policy', 'same-origin');
    res.set('Cache-Control', 'no-cache');
    res.sendFile(file);
  });

  const api = express.Router();

  api.get('/health', (_req, res) => {
    res.json({ ok: true, actual: service.sourceStatus() });
  });

  // --- read-only summary for dashboards --------------------------------------
  // Opt-in with its own token, because a dashboard can't log in to Actual.
  // Send it as "Authorization: Bearer <token>". The ?token= query form still
  // works but is deprecated: query strings end up in logs and browser history.
  api.get('/v1/summary', (req, res) => {
    if (!deps.summaryToken) {
      throw new HttpError(404, 'The summary endpoint is disabled. Set SUMMARY_TOKEN in .env to enable it.');
    }
    const bearer = /^Bearer\s+(.+)$/i.exec(req.get('authorization') ?? '')?.[1];
    const query = typeof req.query.token === 'string' ? req.query.token : undefined;
    if (!sameToken(bearer ?? query, deps.summaryToken)) throw new HttpError(401, 'Missing or wrong summary token');
    if (!bearer && query) {
      res.set('Deprecation', 'true');
      res.set('Warning', '299 - "The token query parameter is deprecated; send Authorization: Bearer <token>"');
      if (!warnedQueryToken) {
        warnedQueryToken = true;
        console.warn('[asset-tracker] a dashboard passed the summary token as ?token=. Switch it to the Authorization: Bearer header.');
      }
    }
    res.set('Cache-Control', 'no-store');
    if (req.query.loan !== undefined) {
      const id = Number(req.query.loan);
      if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'loan must be a loan id');
      const { loan, summary } = service.summaryFor(id);
      res.json({ version: SUMMARY_VERSION, ...summaryForDisplay(loan, summary) });
      return;
    }
    const loans = service.summaries().map(({ loan, summary }) => summaryForDisplay(loan, summary));
    res.json({ version: SUMMARY_VERSION, asOf: service.asOf(), loans });
  });

  // --- everything below needs a valid Actual session ------------------------
  api.use(async (req: Request, _res: Response, next: NextFunction) => {
    const token = req.get('x-actual-token');
    if (!token || !(await deps.validateToken(token))) {
      next(new HttpError(401, 'Not logged in to Actual'));
      return;
    }
    next();
  });

  api.get('/categories', async (_req, res) => {
    res.json(await service.categories());
  });

  // --- loans ------------------------------------------------------------------
  api.get('/loans', (_req, res) => {
    res.json(service.loans());
  });
  api.post('/loans', (req, res) => {
    res.status(201).json(service.createLoan(req.body));
  });
  api.patch('/loans/:loanId', (req, res) => {
    res.json(service.updateLoan(intParam(req, 'loanId'), req.body));
  });
  api.post('/loans/:loanId/archive', (req, res) => {
    res.json(service.setArchived(intParam(req, 'loanId'), true));
  });
  api.post('/loans/:loanId/unarchive', (req, res) => {
    res.json(service.setArchived(intParam(req, 'loanId'), false));
  });
  api.delete('/loans/:loanId', (req, res) => {
    res.json(service.deleteLoan(intParam(req, 'loanId'), req.query.confirm, req.query.keepAsset === '1'));
  });

  // --- one loan -------------------------------------------------------------------
  const loan = express.Router({ mergeParams: true });
  const one = (req: Request) => service.loan(intParam(req, 'loanId'));

  loan.get('/state', (req, res) => {
    res.json(one(req).state());
  });
  loan.put('/setup', (req, res) => {
    res.json(one(req).saveSetup(req.body));
  });
  loan.put('/settings', (req, res) => {
    res.json(one(req).saveSettings(req.body));
  });
  loan.get('/months/:payment/candidates', async (req, res) => {
    res.json(await one(req).candidates(paymentParam(req), req.query.categoryId, req.query.wide === '1'));
  });
  loan.post('/months/:payment/match', async (req, res) => {
    res.json(await one(req).match(paymentParam(req), req.body));
  });
  loan.post('/months/:payment/resolve', (req, res) => {
    res.json(one(req).resolve(paymentParam(req), req.body));
  });
  loan.post('/months/:payment/unmatch', (req, res) => {
    res.json(one(req).unmatch(paymentParam(req)));
  });
  loan.put('/months/:payment/offset', (req, res) => {
    res.json(one(req).setOffset(paymentParam(req), req.body));
  });
  loan.post('/months/:payment/skip', (req, res) => {
    res.json(one(req).skip(paymentParam(req), req.body));
  });
  loan.post('/months/:payment/unskip', (req, res) => {
    res.json(one(req).unskip(paymentParam(req)));
  });
  loan.put('/months/:payment/catch-up', (req, res) => {
    res.json(one(req).setCatchUpPlan(paymentParam(req), req.body));
  });
  loan.delete('/months/:payment/catch-up', (req, res) => {
    res.json(one(req).clearCatchUpPlan(paymentParam(req)));
  });
  loan.post('/escrow/entries', (req, res) => {
    res.json(one(req).addEscrowEntry(req.body));
  });
  loan.delete('/escrow/entries/:id', (req, res) => {
    res.json(one(req).deleteEscrowEntry(idParam(req)));
  });
  loan.put('/details', (req, res) => {
    res.json(one(req).saveDetails(req.body));
  });
  api.use('/loans/:loanId', loan);

  // --- assets and their values -------------------------------------------------------
  api.get('/assets', (_req, res) => {
    res.json(service.assets());
  });
  api.post('/assets', (req, res) => {
    res.status(201).json(service.createAsset(req.body));
  });
  api.patch('/assets/:assetId', (req, res) => {
    res.json(service.updateAsset(intParam(req, 'assetId'), req.body));
  });
  api.delete('/assets/:assetId', (req, res) => {
    res.json(service.deleteAsset(intParam(req, 'assetId')));
  });
  api.post('/assets/:assetId/values', (req, res) => {
    res.status(201).json(service.addAssetValue(intParam(req, 'assetId'), req.body));
  });
  api.delete('/assets/:assetId/values/:valueId', (req, res) => {
    res.json(service.deleteAssetValue(intParam(req, 'assetId'), intParam(req, 'valueId')));
  });

  // --- backup and restore --------------------------------------------------------------
  api.get('/backup', (_req, res) => {
    const backup = service.backup();
    res.set('Cache-Control', 'no-store');
    res.attachment(backupFileName(backup));
    res.json(backup);
  });
  api.post('/restore', express.json({ limit: '50mb' }), (req, res) => {
    res.json(service.restore(req.body, req.query.confirm));
  });

  app.use(API_PREFIX, api);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    if (err instanceof SourceUnavailable) {
      res.status(503).json({ error: err.message });
      return;
    }
    if (err instanceof Error && 'type' in err && err.type === 'entity.too.large') {
      res.status(413).json({ error: 'That request is too large' });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'Request body is not valid JSON' });
      return;
    }
    console.error('[asset-tracker] unexpected error', err);
    res.status(500).json({ error: 'Something went wrong in the tracker. Check its logs.' });
  });

  return app;
}

/**
 * Version 2 of the public summary: one object per loan. Money is in dollars
 * (numbers), dates are YYYY-MM-DD. Add fields freely; never rename or remove
 * one without bumping the version. Loan details (servicer, account numbers,
 * notes) are never part of it.
 */
export const SUMMARY_VERSION = 2;

export function summaryForDisplay(loan: LoanRecord, s: LoanSummary) {
  const dollars = (c: number) => c / 100;
  const orNull = (c: number | null) => (c === null ? null : dollars(c));
  return {
    id: loan.id,
    nickname: loan.nickname,
    type: loan.type,
    asOf: s.asOf,
    paymentNumber: s.lastPaidPayment ?? 0,
    totalPayments: s.totalPayments,
    nextPayment: s.nextPayment
      ? { number: s.nextPayment.payment, dueDate: s.nextPayment.dueDate, amount: dollars(s.nextPayment.total), daysUntil: s.nextPayment.daysUntil }
      : null,
    balance: dollars(s.balance),
    deferredBalance: dollars(s.deferredBalance),
    pastDue: dollars(s.pastDue),
    owed: dollars(s.owed),
    scheduledBalance: dollars(s.scheduledBalance),
    percentPaid: s.percentPaid,
    asset: s.asset
      ? {
          name: s.asset.name,
          kind: s.asset.kind,
          value: dollars(s.asset.value),
          valueAsOf: s.asset.valueDate,
          valueSource: s.asset.valueSource,
          valueEntered: s.asset.valueEntered,
          projectedValue: orNull(s.asset.projectedValue),
        }
      : null,
    equity: s.asset ? dollars(s.asset.equity) : null,
    equityPercent: s.asset ? s.asset.equityPercent : null,
    payoff: s.payoff ? { amount: dollars(s.payoff.amount), source: s.payoff.source, asOf: s.payoff.asOf } : null,
    payoffDate: s.payoffDate,
    pmi: s.pmi.hasPmi
      ? {
          active: s.pmi.active,
          monthly: dollars(s.pmi.monthly),
          dropDate: s.pmi.dropDate,
          paymentsUntilDrop: s.pmi.paymentsUntilDrop,
          daysUntilDrop: s.pmi.daysUntilDrop,
          requestRemovalDate: s.pmi.request80Date,
          automaticRemovalDate: s.pmi.auto78Date,
        }
      : null,
  };
}
