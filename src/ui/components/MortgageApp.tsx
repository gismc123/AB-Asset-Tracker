import { useCallback, useEffect, useState } from 'react';
import type { LoanSetup } from '../../engine/index.js';
import { ApiError, type MortgageClient, type StateView } from '../api.js';
import { date, money } from '../format.js';
import { BalanceChart } from './BalanceChart.js';
import { PaymentBreakdown } from './PaymentBreakdown.js';
import { PmiCountdown } from './PmiCountdown.js';
import { ReconcileView } from './ReconcileView.js';
import { ScheduleView } from './ScheduleView.js';
import { SetupForm } from './SetupForm.js';
import { SummaryCards } from './SummaryCards.js';

type Tab = 'overview' | 'reconcile' | 'schedule' | 'setup';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'reconcile', label: 'Reconcile' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'setup', label: 'Setup' },
];

/**
 * The whole Mortgage tab. It talks to the backend only through `client`, so
 * the same component can be hosted by the injected script today or by
 * Actual itself later.
 */
export function MortgageApp({ client }: { client: MortgageClient }) {
  const [state, setState] = useState<StateView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [payment, setPayment] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await client.state());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, (e as Error).message));
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (state && !state.setup) setTab('setup');
    if (state?.schedule && payment === null) setPayment(state.schedule.currentPayment ?? 1);
  }, [state, payment]);

  if (error && !state) {
    return (
      <div className="mt-page">
        <Header />
        <div className={`mt-note ${error.status === 401 ? 'warn' : 'bad'}`}>
          {error.message}
          <div style={{ marginTop: 8 }}>
            <button type="button" className="mt-btn small" onClick={refresh}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="mt-page">
        <Header />
        <div className="mt-empty">Loading…</div>
      </div>
    );
  }

  const s = state.schedule;
  const saveSetup = async (setup: LoanSetup) => {
    try {
      const next = await client.saveSetup(setup);
      setState(next);
      setPayment(next.schedule?.currentPayment ?? 1);
    } catch (e) {
      const err = e as ApiError;
      throw Object.assign(new Error(err.message), { problems: err.problems });
    }
  };
  const openMonth = (n: number) => {
    setPayment(n);
    setTab('reconcile');
  };
  const setCategory = async (categoryId: string | null) => {
    const settings = await client.saveSettings(categoryId);
    setState((prev) => (prev ? { ...prev, settings } : prev));
  };

  const current = s && s.currentPayment ? s.rows[s.currentPayment - 1] : undefined;

  return (
    <div className="mt-page">
      <Header
        subtitle={
          s && current
            ? `Next: payment #${current.payment} of ${money(current.total)} due ${date(current.dueDate)}`
            : state.setup
              ? 'Paid off'
              : 'Set up your loan to get started'
        }
      >
        {state.setup && (
          <div className="mt-tabs" role="tablist" aria-label="Mortgage sections">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" className="mt-tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        )}
      </Header>

      {error && (
        <div className="mt-note bad" style={{ marginBottom: 14 }}>
          {error.message}
        </div>
      )}
      {!state.source.connected && state.source.error && (
        <div className="mt-note warn" style={{ marginBottom: 14 }}>
          Can't read from Actual right now: {state.source.error}
        </div>
      )}

      {tab === 'setup' && (
        <SetupForm initial={state.setup} hasReconciled={!!s?.rows.some((r) => r.status === 'paid')} onSave={saveSetup} />
      )}

      {tab === 'overview' && s && state.summary && state.setup && (
        <>
          <SummaryCards summary={state.summary} />
          <div className="mt-gap" />
          <div className="mt-grid mt-two">
            <div className="mt-card">
              <h3>Balance over time</h3>
              <BalanceChart
                rows={s.rows}
                today={state.today}
                references={
                  s.pmi.hasPmi
                    ? [
                        { label: '80% · request PMI removal', balance: s.pmi.request80.thresholdBalance },
                        { label: '78% · automatic', balance: s.pmi.auto78Scheduled.thresholdBalance },
                      ]
                    : []
                }
              />
              <div className="mt-row" style={{ marginTop: 10, color: 'var(--muted)' }}>
                Total interest {money(s.totals.interest, { whole: true })} · PMI {money(s.totals.pmi, { whole: true })} · payoff{' '}
                {date(s.rows.at(-1)?.dueDate, 'month')}
              </div>
            </div>
            <PmiCountdown pmi={s.pmi} status={state.summary.pmi} nextPayment={s.currentPayment} rule={state.setup.pmiRemovalRule} />
          </div>
          {current && (
            <>
              <div className="mt-gap" />
              <div className="mt-grid mt-two">
                <div className="mt-card">
                  <PaymentBreakdown row={current} title={`Payment #${current.payment} · ${date(current.dueDate)}`} />
                </div>
                <div className="mt-card">
                  <h3>This month</h3>
                  <p style={{ marginTop: 0 }}>
                    When the payment shows up in Actual, match it to keep the schedule in step with your bank.
                  </p>
                  <button type="button" className="mt-btn primary" onClick={() => openMonth(current.payment)}>
                    Reconcile payment #{current.payment}
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'reconcile' && s && payment !== null && (
        <ReconcileView
          client={client}
          rows={s.rows}
          payment={Math.min(payment, s.rows.length)}
          onPaymentChange={setPayment}
          categoryId={state.settings.categoryId}
          onCategoryChange={setCategory}
          onState={setState}
          onRefresh={refresh}
        />
      )}

      {tab === 'schedule' && s && <ScheduleView rows={s.rows} currentPayment={s.currentPayment} onOpen={openMonth} />}
    </div>
  );
}

function Header({ subtitle, children }: { subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="mt-head">
      <div>
        <h1 className="mt-title">Mortgage</h1>
        {subtitle && <div className="mt-sub">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}
