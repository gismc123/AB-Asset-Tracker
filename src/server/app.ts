import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { SourceUnavailable } from './actual.js';
import type { LoanSummary } from '../engine/index.js';
import type { TokenValidator } from './auth.js';
import { HttpError, type MortgageService } from './service.js';

export interface AppDeps {
  service: MortgageService;
  validateToken: TokenValidator;
  /** Folder with the built inject.js. */
  uiDir: string;
  /** Token for the read-only summary endpoint. Undefined = endpoint disabled. */
  summaryToken: string | undefined;
}

/** Mount points shared with the proxy config. */
export const API_PREFIX = '/mortgage-api';
export const ADDON_PREFIX = '/mortgage-addon';

function sameToken(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const paymentParam = (req: Request) => {
  const n = Number(req.params.payment);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Payment number must be a positive whole number');
  return n;
};

const idParam = (req: Request) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'id must be a positive whole number');
  return n;
};

export function createApp(deps: AppDeps) {
  const { service } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  // --- static add-on files (no data in them, so no auth) -----------------
  app.get(`${ADDON_PREFIX}/inject.js`, (_req, res) => {
    const file = path.join(deps.uiDir, 'inject.js');
    if (!fs.existsSync(file)) {
      // Serve a harmless no-op so Actual keeps working even if the build is missing.
      res.type('application/javascript').send('console.warn("[mortgage] add-on UI is not built");');
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

  // --- read-only summary for dashboards (e.g. a future MagicMirror module) --
  // Opt-in with its own token, because a dashboard can't log in to Actual.
  api.get('/v1/summary', (req, res) => {
    if (!deps.summaryToken) {
      throw new HttpError(404, 'The summary endpoint is disabled. Set SUMMARY_TOKEN in .env to enable it.');
    }
    const header = req.get('authorization')?.replace(/^Bearer\s+/i, '');
    const given = typeof req.query.token === 'string' ? req.query.token : header;
    if (!sameToken(given, deps.summaryToken)) throw new HttpError(401, 'Missing or wrong summary token');
    const summary = service.summary();
    if (!summary) throw new HttpError(409, 'The loan has not been set up yet');
    res.set('Cache-Control', 'no-store');
    res.json(summaryForDisplay(summary));
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

  api.get('/state', (_req, res) => {
    res.json(service.state());
  });
  api.put('/loan', (req, res) => {
    res.json(service.saveSetup(req.body));
  });
  api.put('/settings', (req, res) => {
    res.json(service.saveSettings(req.body));
  });
  api.get('/categories', async (_req, res) => {
    res.json(await service.categories());
  });
  api.get('/months/:payment/candidates', async (req, res) => {
    res.json(await service.candidates(paymentParam(req), req.query.categoryId, req.query.wide === '1'));
  });
  api.post('/months/:payment/match', async (req, res) => {
    res.json(await service.match(paymentParam(req), req.body));
  });
  api.post('/months/:payment/resolve', (req, res) => {
    res.json(service.resolve(paymentParam(req), req.body));
  });
  api.post('/months/:payment/unmatch', (req, res) => {
    res.json(service.unmatch(paymentParam(req)));
  });
  api.put('/months/:payment/offset', (req, res) => {
    res.json(service.setOffset(paymentParam(req), req.body));
  });
  api.post('/months/:payment/skip', (req, res) => {
    res.json(service.skip(paymentParam(req), req.body));
  });
  api.post('/months/:payment/unskip', (req, res) => {
    res.json(service.unskip(paymentParam(req)));
  });
  api.post('/home-values', (req, res) => {
    res.json(service.addHomeValue(req.body));
  });
  api.delete('/home-values/:id', (req, res) => {
    res.json(service.deleteHomeValue(idParam(req)));
  });
  api.post('/escrow/entries', (req, res) => {
    res.json(service.addEscrowEntry(req.body));
  });
  api.delete('/escrow/entries/:id', (req, res) => {
    res.json(service.deleteEscrowEntry(idParam(req)));
  });
  api.put('/details', (req, res) => {
    res.json(service.saveDetails(req.body));
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
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'Request body is not valid JSON' });
      return;
    }
    console.error('[mortgage] unexpected error', err);
    res.status(500).json({ error: 'Something went wrong in the mortgage tracker. Check its logs.' });
  });

  return app;
}

/**
 * The public summary shape, version 1. Flat and dashboard-friendly: money is
 * in dollars (numbers), dates are YYYY-MM-DD. Add fields freely; never rename
 * or remove one without bumping `version`.
 */
export function summaryForDisplay(s: LoanSummary) {
  const dollars = (c: number) => c / 100;
  return {
    version: 1,
    asOf: s.asOf,
    paymentNumber: s.lastPaidPayment ?? 0,
    totalPayments: s.totalPayments,
    nextPayment: s.nextPayment
      ? { number: s.nextPayment.payment, dueDate: s.nextPayment.dueDate, amount: dollars(s.nextPayment.total), daysUntil: s.nextPayment.daysUntil }
      : null,
    balance: dollars(s.balance),
    deferredBalance: dollars(s.deferredBalance),
    scheduledBalance: dollars(s.scheduledBalance),
    percentPaid: s.percentPaid,
    equity: dollars(s.equity),
    equityPercent: s.equityPercent,
    homeValue: s.homeValue ? { value: dollars(s.homeValue.value), asOf: s.homeValue.date } : null,
    marketEquity: s.marketEquity === null ? null : dollars(s.marketEquity),
    marketEquityPercent: s.marketEquityPercent,
    payoffDate: s.payoffDate,
    pmi: {
      active: s.pmi.active,
      monthly: dollars(s.pmi.monthly),
      dropDate: s.pmi.dropDate,
      paymentsUntilDrop: s.pmi.paymentsUntilDrop,
      daysUntilDrop: s.pmi.daysUntilDrop,
      requestRemovalDate: s.pmi.request80Date,
      automaticRemovalDate: s.pmi.auto78Date,
    },
  };
}
