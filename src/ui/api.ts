import type { Cents, EscrowKind, ISODate, LoanSetup, SkipMode } from '../engine/index.js';
import type { CategoryGroup } from '../server/actual.js';
import type { AssetInput, AssetRecord, LoanDetails, LoanRecord, LoanType } from '../server/db.js';
import type { Candidate, LoanListItem, MatchResult, StateView } from '../server/service.js';
import type { Resolution } from '../engine/index.js';

export type { StateView, Candidate, MatchResult, CategoryGroup, LoanDetails, LoanListItem, LoanRecord, LoanType, AssetRecord };

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

/** One loan. Every call that changes something returns the loan's fresh state. */
export interface LoanClient {
  readonly loanId: number;
  state(): Promise<StateView>;
  saveSetup(setup: LoanSetup): Promise<StateView>;
  saveSettings(categoryId: string | null): Promise<{ categoryId: string | null }>;
  categories(): Promise<CategoryGroup[]>;
  candidates(payment: number, categoryId: string, wide?: boolean): Promise<Candidate[]>;
  match(payment: number, transactionId: string, categoryId: string): Promise<MatchResult>;
  resolve(payment: number, resolution: Resolution, standing: boolean): Promise<StateView>;
  unmatch(payment: number): Promise<StateView>;
  setOffset(payment: number, amount: number): Promise<StateView>;
  skip(payment: number, mode: SkipMode): Promise<StateView>;
  unskip(payment: number): Promise<StateView>;
  setCatchUpPlan(payment: number, fromPayment: number, months: number): Promise<StateView>;
  clearCatchUpPlan(payment: number): Promise<StateView>;
  /** Create the loan's asset, or update the one it has. */
  saveAsset(asset: AssetFields): Promise<StateView>;
  addAssetValue(assetId: number, value: { date: ISODate; value: Cents; source: string }): Promise<StateView>;
  deleteAssetValue(assetId: number, valueId: number): Promise<StateView>;
  addEscrowEntry(entry: { date: ISODate; kind: EscrowKind; amount: Cents; note: string }): Promise<StateView>;
  deleteEscrowEntry(id: number): Promise<StateView>;
  saveDetails(details: LoanDetails): Promise<StateView>;
}

export type AssetFields = Omit<AssetInput, 'loanId'>;

export interface NewLoan {
  nickname: string;
  type: LoanType;
  setup: LoanSetup;
  asset: AssetFields | null;
}

/** The whole tracker: the list of loans, plus a client per loan. */
export interface TrackerClient {
  loans(): Promise<LoanListItem[]>;
  createLoan(loan: NewLoan): Promise<{ loan: LoanRecord; state: StateView }>;
  updateLoan(loanId: number, patch: { nickname?: string; archived?: boolean }): Promise<LoanRecord>;
  deleteLoan(loanId: number, nickname: string): Promise<void>;
  loan(loanId: number): LoanClient;
}

export function createClient(base = '/mortgage-api', getToken: () => Promise<string | null> = readActualToken): TrackerClient {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await getToken();
    if (!token) throw new ApiError(401, 'Log in to Actual to see your loans.');
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: { 'x-actual-token': token, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'The tracker service is not reachable. Is its backend container running?');
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string; details?: { problems?: string[] } };
    if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.details?.problems ?? []);
    return data as T;
  }

  const q = encodeURIComponent;
  const loan = (loanId: number): LoanClient => {
    const at = `/loans/${loanId}`;
    const state = () => call<StateView>('GET', `${at}/state`);
    return {
      loanId,
      state,
      saveSetup: (setup) => call('PUT', `${at}/setup`, setup),
      saveSettings: (categoryId) => call('PUT', `${at}/settings`, { categoryId }),
      categories: () => call('GET', '/categories'),
      candidates: (n, cat, wide) => call('GET', `${at}/months/${n}/candidates?categoryId=${q(cat)}${wide ? '&wide=1' : ''}`),
      match: (n, transactionId, categoryId) => call('POST', `${at}/months/${n}/match`, { transactionId, categoryId }),
      resolve: (n, resolution, standing) => call('POST', `${at}/months/${n}/resolve`, { resolution, standing }),
      unmatch: (n) => call('POST', `${at}/months/${n}/unmatch`),
      setOffset: (n, amount) => call('PUT', `${at}/months/${n}/offset`, { amount }),
      skip: (n, mode) => call('POST', `${at}/months/${n}/skip`, { mode }),
      unskip: (n) => call('POST', `${at}/months/${n}/unskip`),
      setCatchUpPlan: (n, fromPayment, months) => call('PUT', `${at}/months/${n}/catch-up`, { fromPayment, months }),
      clearCatchUpPlan: (n) => call('DELETE', `${at}/months/${n}/catch-up`),
      async saveAsset(asset) {
        const current = (await state()).asset;
        if (current) await call('PATCH', `/assets/${current.id}`, asset);
        else await call('POST', '/assets', { ...asset, loanId });
        return state();
      },
      async addAssetValue(assetId, v) {
        await call('POST', `/assets/${assetId}/values`, v);
        return state();
      },
      async deleteAssetValue(assetId, id) {
        await call('DELETE', `/assets/${assetId}/values/${id}`);
        return state();
      },
      addEscrowEntry: (e) => call('POST', `${at}/escrow/entries`, e),
      deleteEscrowEntry: (id) => call('DELETE', `${at}/escrow/entries/${id}`),
      saveDetails: (d) => call('PUT', `${at}/details`, d),
    };
  };

  return {
    loans: () => call('GET', '/loans'),
    createLoan: (l) => call('POST', '/loans', l),
    updateLoan: (id, patch) => call('PATCH', `/loans/${id}`, patch),
    async deleteLoan(id, nickname) {
      await call('DELETE', `/loans/${id}?confirm=${q(nickname)}`);
    },
    loan,
  };
}
