import fs from 'node:fs';
import path from 'node:path';
import type { Cents, ISODate } from '../engine/index.js';

/**
 * Everything the tracker reads from Actual. This interface is intentionally
 * read-only: there is no method here that could create, change, or delete
 * anything in a budget, and this file is the only place that talks to
 * @actual-app/api.
 */
export interface BudgetSource {
  getCategories(): Promise<CategoryGroup[]>;
  /** Transactions (and split children) in one category between two dates. */
  getTransactionsInCategory(categoryId: string, start: ISODate, end: ISODate): Promise<BudgetTransaction[]>;
  /** Every account in the budget, open and closed. */
  getAccounts(): Promise<BudgetAccount[]>;
  /** An account's balance in cents (Actual's sign: assets positive, debts negative), counting transactions dated up to `asOf`. */
  getAccountBalance(accountId: string, asOf: ISODate): Promise<Cents>;
  status(): SourceStatus;
}

export interface BudgetAccount {
  id: string;
  name: string;
  offBudget: boolean;
  closed: boolean;
}

export interface CategoryGroup {
  id: string;
  name: string;
  categories: { id: string; name: string }[];
}

export interface BudgetTransaction {
  id: string;
  date: ISODate;
  /** Actual's signed amount in cents: payments are negative. */
  amount: Cents;
  payee: string | null;
  account: string | null;
  notes: string | null;
  /** True for one line of a split transaction. */
  isSplitPart: boolean;
}

export interface SourceStatus {
  connected: boolean;
  lastSync: string | null;
  error: string | null;
}

interface ActualConnection {
  serverURL: string;
  password: string;
  syncId: string;
  budgetPassword: string | undefined;
  dataDir: string;
}

// Minimal shapes of what we read back; the API's own types pull in its whole core.
interface RawTxn {
  id: string;
  date: string;
  amount: number;
  payee?: string | null;
  category?: string | null;
  notes?: string | null;
  account?: string | null;
  tombstone?: boolean;
  subtransactions?: RawTxn[];
}

/** Start of every account's history, for balances. */
const EARLIEST = '1900-01-01';

/** Only re-sync with the server when data is older than this. */
const SYNC_INTERVAL_MS = 30_000;

type ActualApi = typeof import('@actual-app/api');

export class ActualApiSource implements BudgetSource {
  private api: ActualApi | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private lastSyncAt = 0;
  private state: SourceStatus = { connected: false, lastSync: null, error: null };

  constructor(
    private readonly conn: ActualConnection,
    /** Replaced in tests. */
    private readonly loadApi: () => Promise<ActualApi> = () => import('@actual-app/api'),
  ) {}

  status(): SourceStatus {
    return { ...this.state };
  }

  /** @actual-app/api is a singleton, so every call goes through one queue. */
  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async connected() {
    if (this.api) {
      if (Date.now() - this.lastSyncAt > SYNC_INTERVAL_MS) {
        // Pull the latest changes. We never make local changes, so nothing is pushed.
        // A failed sync (Actual restarting, say) is retried on the next request.
        try {
          await this.api.sync();
        } catch (err) {
          throw this.unavailable(`Could not sync the budget with Actual: ${describe(err)}`, err);
        }
        this.markSynced();
      }
      return this.api;
    }
    const cacheDir = path.join(this.conn.dataDir, 'actual-cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    try {
      const api = await this.loadApi();
      await api.init({ dataDir: cacheDir, serverURL: this.conn.serverURL, password: this.conn.password });
      await api.downloadBudget(this.conn.syncId, this.conn.budgetPassword ? { password: this.conn.budgetPassword } : {});
      this.api = api;
      this.markSynced();
      return api;
    } catch (err) {
      throw this.unavailable(`Could not load the budget from Actual: ${describe(err)}`, err);
    }
  }

  private unavailable(message: string, err: unknown): SourceUnavailable {
    this.state = { ...this.state, connected: false, error: describe(err) };
    return new SourceUnavailable(message);
  }

  private markSynced() {
    this.lastSyncAt = Date.now();
    this.state = { connected: true, lastSync: new Date().toISOString(), error: null };
  }

  getCategories(): Promise<CategoryGroup[]> {
    return this.serialized(async () => {
      const api = await this.connected();
      const groups = (await api.getCategoryGroups()) as unknown as {
        id: string;
        name: string;
        is_income?: boolean;
        hidden?: boolean;
        categories?: { id: string; name: string; hidden?: boolean }[];
      }[];
      return groups
        .filter((g) => !g.is_income)
        .map((g) => ({
          id: g.id,
          name: g.name,
          categories: (g.categories ?? []).map((c) => ({ id: c.id, name: c.name })),
        }));
    });
  }

  getTransactionsInCategory(categoryId: string, start: ISODate, end: ISODate): Promise<BudgetTransaction[]> {
    return this.serialized(async () => {
      const api = await this.connected();
      const [accounts, payees] = await Promise.all([api.getAccounts(), api.getPayees()]);
      const payeeName = new Map(payees.map((p) => [p.id, p.name]));
      const out: BudgetTransaction[] = [];

      for (const account of accounts) {
        const txns = (await api.getTransactions(account.id, start, end)) as unknown as RawTxn[];
        for (const t of txns) {
          if (t.tombstone) continue;
          const parts = t.subtransactions?.length ? t.subtransactions : null;
          const lines = parts ? parts.map((p) => ({ line: p, split: true })) : [{ line: t, split: false }];
          for (const { line, split } of lines) {
            if (line.tombstone || line.category !== categoryId) continue;
            out.push({
              id: line.id,
              date: t.date,
              amount: line.amount,
              payee: payeeName.get(line.payee ?? t.payee ?? '') ?? null,
              account: account.name,
              notes: line.notes ?? t.notes ?? null,
              isSplitPart: split,
            });
          }
        }
      }
      return out.sort((a, b) => a.date.localeCompare(b.date));
    });
  }

  getAccounts(): Promise<BudgetAccount[]> {
    return this.serialized(async () => {
      const api = await this.connected();
      const accounts = (await api.getAccounts()) as unknown as { id: string; name: string; offbudget?: boolean; closed?: boolean }[];
      return accounts.map((a) => ({ id: a.id, name: a.name, offBudget: !!a.offbudget, closed: !!a.closed }));
    });
  }

  getAccountBalance(accountId: string, asOf: ISODate): Promise<Cents> {
    return this.serialized(async () => {
      const api = await this.connected();
      // Summed from the same read the reconcile screen uses, rather than
      // getAccountBalance, which Actual runs inside its change-tracking
      // wrapper. A split's parent carries the total of its lines.
      const txns = (await api.getTransactions(accountId, EARLIEST, asOf)) as unknown as RawTxn[];
      return txns.reduce((sum, t) => (t.tombstone ? sum : sum + t.amount), 0);
    });
  }

  async close() {
    if (this.api) await this.serialized(() => this.api!.shutdown());
  }
}

export class SourceUnavailable extends Error {}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
