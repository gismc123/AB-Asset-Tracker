import { withAccountValue, type AccountReading, type Asset, type AssetValueSource, type ISODate } from '../engine/index.js';
import { SourceUnavailable, type BudgetSource } from './actual.js';
import type { AssetRecord } from './db.js';

/** The latest balance read from one Actual account. */
export type LinkedAccount = AccountReading;

/** Don't ask Actual again for a balance read this recently. */
const FRESH_MS = 30_000;

/**
 * Balances of the Actual accounts linked to assets and loans, read on
 * demand and kept in memory. Only linked accounts are ever read, so a
 * tracker with no links never asks Actual for a balance.
 */
export class LinkedAccounts {
  private readonly accounts = new Map<string, LinkedAccount & { readAt: number }>();

  constructor(
    private readonly source: BudgetSource,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(id: string): LinkedAccount {
    const found = this.accounts.get(id);
    if (!found) return { id, name: null, balance: null, asOf: null, error: 'Not read from Actual yet' };
    const { readAt: _r, ...account } = found;
    return account;
  }

  /** Read the balances of `ids` as of `today`. Never throws: a failure is kept as the account's `error`. */
  async refresh(ids: Iterable<string>, today: ISODate): Promise<void> {
    const wanted = [...new Set(ids)].filter((id) => {
      const known = this.accounts.get(id);
      return !known || known.error !== null || known.asOf !== today || this.now() - known.readAt > FRESH_MS;
    });
    if (!wanted.length) return;
    try {
      const all = await this.source.getAccounts();
      for (const id of wanted) {
        const account = all.find((a) => a.id === id);
        if (!account) {
          this.accounts.set(id, { id, name: null, balance: null, asOf: null, error: "That account isn't in the budget any more", readAt: this.now() });
          continue;
        }
        const balance = await this.source.getAccountBalance(id, today);
        this.accounts.set(id, { id, name: account.name, balance, asOf: today, error: null, readAt: this.now() });
      }
    } catch (e) {
      const error = e instanceof SourceUnavailable ? e.message : `Could not read the account from Actual: ${(e as Error).message}`;
      // Keep a balance read earlier, flagged with why it wasn't refreshed.
      for (const id of wanted) this.accounts.set(id, { ...this.get(id), error, readAt: 0 });
    }
  }
}

/** The asset as equity sees it: with its linked account's balance as the newest value, when that can be used. */
export function assetWithLinkedValue(record: AssetRecord, linked: LinkedAccounts): { asset: Asset; source: AssetValueSource } {
  return withAccountValue<Asset>(record, record.actualAccountId ? linked.get(record.actualAccountId) : null);
}
