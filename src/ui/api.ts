import type { LoanSetup } from '../engine/index.js';
import type { CategoryGroup } from '../server/actual.js';
import type { Candidate, MatchResult, StateView } from '../server/service.js';
import type { Resolution } from '../engine/index.js';

export type { StateView, Candidate, MatchResult, CategoryGroup };

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly problems: string[] = [],
  ) {
    super(message);
  }
}

/**
 * Read the session token Actual's web app keeps in IndexedDB
 * (database "actual", store "asyncStorage", key "user-token").
 * Returns null instead of throwing if any of that ever changes.
 */
export async function readActualToken(): Promise<string | null> {
  try {
    // Never create the database: opening a missing one would make an empty v1 copy.
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      if (!dbs.some((d) => d.name === 'actual')) return null;
    }
    return await new Promise((resolve) => {
      const req = indexedDB.open('actual');
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
      req.onupgradeneeded = () => {
        req.transaction?.abort();
        resolve(null);
      };
      req.onsuccess = () => {
        const db = req.result;
        const done = (v: string | null) => {
          db.close();
          resolve(v);
        };
        try {
          if (!db.objectStoreNames.contains('asyncStorage')) return done(null);
          const get = db.transaction('asyncStorage', 'readonly').objectStore('asyncStorage').get('user-token');
          get.onsuccess = () => {
            const v = get.result as unknown;
            done(typeof v === 'string' ? v : typeof (v as { value?: unknown })?.value === 'string' ? (v as { value: string }).value : null);
          };
          get.onerror = () => done(null);
        } catch {
          done(null);
        }
      };
    });
  } catch {
    return null;
  }
}

export interface MortgageClient {
  state(): Promise<StateView>;
  saveSetup(setup: LoanSetup): Promise<StateView>;
  saveSettings(categoryId: string | null): Promise<{ categoryId: string | null }>;
  categories(): Promise<CategoryGroup[]>;
  candidates(payment: number, categoryId: string, wide?: boolean): Promise<Candidate[]>;
  match(payment: number, transactionId: string, categoryId: string): Promise<MatchResult>;
  resolve(payment: number, resolution: Resolution, standing: boolean): Promise<StateView>;
  unmatch(payment: number): Promise<StateView>;
  setOffset(payment: number, amount: number): Promise<StateView>;
}

export function createClient(base = '/mortgage-api', getToken: () => Promise<string | null> = readActualToken): MortgageClient {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await getToken();
    if (!token) throw new ApiError(401, 'Log in to Actual to use the Mortgage tab.');
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: { 'x-actual-token': token, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'The mortgage service is not reachable. Is the mortgage-backend container running?');
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string; details?: { problems?: string[] } };
    if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.details?.problems ?? []);
    return data as T;
  }

  const q = encodeURIComponent;
  return {
    state: () => call('GET', '/state'),
    saveSetup: (setup) => call('PUT', '/loan', setup),
    saveSettings: (categoryId) => call('PUT', '/settings', { categoryId }),
    categories: () => call('GET', '/categories'),
    candidates: (n, cat, wide) => call('GET', `/months/${n}/candidates?categoryId=${q(cat)}${wide ? '&wide=1' : ''}`),
    match: (n, transactionId, categoryId) => call('POST', `/months/${n}/match`, { transactionId, categoryId }),
    resolve: (n, resolution, standing) => call('POST', `/months/${n}/resolve`, { resolution, standing }),
    unmatch: (n) => call('POST', `/months/${n}/unmatch`),
    setOffset: (n, amount) => call('PUT', `/months/${n}/offset`, { amount }),
  };
}
