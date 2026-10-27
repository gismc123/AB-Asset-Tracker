import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { SourceUnavailable } from './actual.js';
import type { TokenValidator } from './auth.js';
import { HttpError, type MortgageService } from './service.js';

export interface AppDeps {
  service: MortgageService;
  validateToken: TokenValidator;
  /** Folder with the built inject.js. */
  uiDir: string;
}

/** Mount points shared with the proxy config. */
export const API_PREFIX = '/mortgage-api';
export const ADDON_PREFIX = '/mortgage-addon';

const paymentParam = (req: Request) => {
  const n = Number(req.params.payment);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Payment number must be a positive whole number');
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
    res.json({ ok: true, actual: service.state().source });
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
