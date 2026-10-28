import { useCallback, useEffect, useState } from 'react';
import { modulesOf, type LoanSetup } from '../../engine/index.js';
import { ApiError, type LoanClient, type LoanListItem, type NewLoan, type StateView, type TrackerClient } from '../api.js';
import { date } from '../format.js';
import { valueScreenLabel } from '../loanTypes.js';
import { AddLoanWizard } from './AddLoanWizard.js';
import { Amt } from './Amt.js';
import { BackupView } from './BackupView.js';
import { BalanceChart } from './BalanceChart.js';
import { DetailsView } from './DetailsView.js';
import { EquityView } from './EquityView.js';
import { EscrowView } from './EscrowView.js';
import { LoanPicker, type PickerScreen } from './LoanPicker.js';
import { LoanSettings } from './LoanSettings.js';
import { PaymentBreakdown } from './PaymentBreakdown.js';
import { PayoffCard } from './PayoffCard.js';
import { PmiCountdown } from './PmiCountdown.js';
import { ReconcileView } from './ReconcileView.js';
import { ScheduleView } from './ScheduleView.js';
import { SetupForm } from './SetupForm.js';
import { SummaryCards } from './SummaryCards.js';

type Tab = 'overview' | 'equity' | 'escrow' | 'reconcile' | 'schedule' | 'details' | 'setup';

const REMEMBER = 'ab-asset-tracker:loan';

function remembered(): number | null {
  try {
    const v = Number(localStorage.getItem(REMEMBER));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function remember(id: number) {
  try {
    localStorage.setItem(REMEMBER, String(id));
  } catch {
    /* private window: the choice just isn't remembered */
  }
}

export interface TrackerAppProps {
  client: TrackerClient;
  /** Open this loan first (from the sidebar list). */
  initialLoan?: number | null;
  /** Lets the host switch loans after mounting. */
  bindSelect?(select: (loanId: number) => void): void;
  /** Called after anything that changes the loan list or a loan's numbers. */
  onChange?(): void;
  /** Called with the loan on screen (null while adding one). */
  onSelect?(loanId: number | null): void;
}

/**
 * The whole tracker: a loan picker on top, then the screens for the chosen
 * loan. It talks to the backend only through `client`, so the same
 * component can be hosted by the injected script or by a preview page.
 */
export function TrackerApp({ client, initialLoan, bindSelect, onChange, onSelect }: TrackerAppProps) {
  const [loans, setLoans] = useState<LoanListItem[] | null>(null);
  const [selected, setSelected] = useState<number | null>(initialLoan ?? remembered());
  const [screen, setScreen] = useState<PickerScreen>('loan');
  const [error, setError] = useState<ApiError | null>(null);

  const refreshLoans = useCallback(async () => {
    try {
      const list = await client.loans();
      setLoans(list);
      setError(null);
      return list;
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, (e as Error).message));
      return null;
    }
  }, [client]);

  useEffect(() => {
    void refreshLoans();
  }, [refreshLoans]);

  const select = useCallback((id: number) => {
    setSelected(id);
    setScreen('loan');
    remember(id);
  }, []);
  useEffect(() => bindSelect?.(select), [bindSelect, select]);

  // Fall back to the first active loan when the chosen one is gone or archived.
  const active = loans?.filter((l) => !l.loan.archived) ?? [];
  const current = loans?.find((l) => l.loan.id === selected) ?? active[0] ?? loans?.[0] ?? null;
  const shownId = screen !== 'loan' || !current ? null : current.loan.id;
  useEffect(() => onSelect?.(shownId), [onSelect, shownId]);
  const changed = useCallback(() => {
    void refreshLoans();
    onChange?.();
  }, [refreshLoans, onChange]);

  const create = async (loan: NewLoan) => {
    try {
      const { loan: created } = await client.createLoan(loan);
      await refreshLoans();
      select(created.id);
      onChange?.();
    } catch (e) {
      const err = e as ApiError;
      throw Object.assign(new Error(err.message), { problems: err.problems });
    }
  };

  if (error && !loans) {
    return (
      <div className="mt-page">
        <Header title="Loans" />
        <div className={`mt-note ${error.status === 401 ? 'warn' : 'bad'}`}>
          {error.message}
          <div style={{ marginTop: 8 }}>
            <button type="button" className="mt-btn small" onClick={() => void refreshLoans()}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!loans) {
    return (
      <div className="mt-page">
        <Header title="Loans" />
        <div className="mt-empty">Loading…</div>
      </div>
    );
  }

  const picker = (shown: PickerScreen) => (
    <LoanPicker loans={loans} selected={current?.loan.id ?? null} onSelect={select} onScreen={setScreen} screen={shown} />
  );

  if (screen === 'backup') {
    return (
      <div className="mt-page">
        <Header title="Backup and restore" subtitle="Save everything in the tracker to a file, or load it back">
          {loans.length > 0 ? (
            picker('backup')
          ) : (
            <button type="button" className="mt-btn" onClick={() => setScreen('loan')}>
              Back
            </button>
          )}
        </Header>
        <BackupView
          client={client}
          loans={loans}
          onRestored={() => {
            void refreshLoans();
            onChange?.();
          }}
        />
      </div>
    );
  }

  if (loans.length === 0 || screen === 'add' || !current) {
    return (
      <div className="mt-page">
        <Header title={loans.length === 0 ? 'Welcome' : 'Add a loan'} subtitle={loans.length === 0 ? 'Set up your first loan to get started' : undefined}>
          {loans.length > 0 && picker('add')}
        </Header>
        <AddLoanWizard firstRun={loans.length === 0} onCreate={create} onCancel={loans.length > 0 ? () => setScreen('loan') : undefined} />
        {loans.length === 0 && (
          <p className="mt-kpi-note" style={{ marginTop: 14 }}>
            Moving from another install?{' '}
            <button type="button" className="mt-btn link" onClick={() => setScreen('backup')}>
              Restore a backup
            </button>
          </p>
        )}
      </div>
    );
  }

  return (
    <LoanScreens
      key={current.loan.id}
      client={client.loan(current.loan.id)}
      picker={picker('loan')}
      onChange={changed}
      onRename={async (nickname) => {
        await client.updateLoan(current.loan.id, { nickname });
        changed();
      }}
      onArchive={async (archived) => {
        await client.updateLoan(current.loan.id, { archived });
        changed();
      }}
      onDelete={async () => {
        await client.deleteLoan(current.loan.id, current.loan.nickname);
        setSelected(null);
        changed();
      }}
    />
  );
}

interface ScreensProps {
  client: LoanClient;
  picker: React.ReactNode;
  onChange(): void;
  onRename(nickname: string): Promise<void>;
  onArchive(archived: boolean): Promise<void>;
  onDelete(): Promise<void>;
}

/** The screens for one loan. Which ones appear depends on its type and modules. */
function LoanScreens({ client, picker, onChange, onRename, onArchive, onDelete }: ScreensProps) {
  const [state, setStateRaw] = useState<StateView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [payment, setPayment] = useState<number | null>(null);

  const setState = useCallback(
    (next: StateView) => {
      setStateRaw(next);
      onChange();
    },
    [onChange],
  );

  const refresh = useCallback(async () => {
    try {
      setStateRaw(await client.state());
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

  if (!state) {
    return (
      <div className="mt-page">
        <Header title="Loans">{picker}</Header>
        {error ? <div className="mt-note bad">{error.message}</div> : <div className="mt-empty">Loading…</div>}
      </div>
    );
  }

  const s = state.schedule;
  const modules = state.setup ? modulesOf(state.setup) : { pmi: false, escrow: false };
  const assetKind = state.asset?.kind ?? (state.loan.type === 'mortgage' ? 'home' : null);
  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'equity', label: valueScreenLabel(assetKind) },
    ...(modules.escrow ? [{ id: 'escrow' as const, label: 'Escrow' }] : []),
    { id: 'reconcile', label: 'Reconcile' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'details', label: 'Details' },
    { id: 'setup', label: 'Setup' },
  ];
  const shown = tabs.some((t) => t.id === tab) ? tab : 'overview';

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
    setStateRaw((prev) => (prev ? { ...prev, settings } : prev));
  };

  const current = s && s.currentPayment ? s.rows[s.currentPayment - 1] : undefined;

  return (
    <div className="mt-page">
      <Header
        title={state.loan.nickname}
        subtitle={
          s && current ? (
            <>
              Next: payment #{current.payment} of <Amt cents={current.total} /> due {date(current.dueDate)}
            </>
          ) : state.setup ? (
            'Paid off'
          ) : (
            'Enter the loan terms to build its schedule'
          )
        }
      >
        {picker}
      </Header>
      {state.setup && (
        <div className="mt-tabs mt-screen-tabs" role="tablist" aria-label={`${state.loan.nickname} sections`}>
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" className="mt-tab" aria-selected={shown === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      )}

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

      {shown === 'setup' && (
        <>
          <SetupForm type={state.loan.type} initial={state.setup} hasReconciled={!!s?.rows.some((r) => r.status === 'paid')} onSave={saveSetup} />
          <div className="mt-gap" />
          <LoanSettings loan={state.loan} onRename={onRename} onArchive={onArchive} onDelete={onDelete} />
        </>
      )}

      {shown === 'overview' && s && state.summary && state.setup && (
        <>
          {state.summary.pastDue > 0 && (
            <div className="mt-note warn" style={{ marginBottom: 14 }}>
              <Amt cents={state.summary.pastDue} /> past due from missed payments.{' '}
              {state.adjustments.some((a) => a.adjustment.kind === 'catchUpPlan')
                ? 'A catch-up plan is in the schedule.'
                : 'Set up a catch-up plan from the missed month in Reconcile.'}
            </div>
          )}
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
                Total interest <Amt cents={s.totals.interest} whole />
                {modules.pmi && <> · PMI <Amt cents={s.totals.pmi} whole /></>}
                {s.totals.fees > 0 && <> · fees <Amt cents={s.totals.fees} whole /></>} · payoff {date(s.rows.at(-1)?.dueDate, 'month')}
              </div>
            </div>
            {modules.pmi ? (
              <PmiCountdown state={state} client={client} onState={setState} />
            ) : (
              <PayoffCard summary={state.summary} totals={s.totals} />
            )}
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
                  <p style={{ marginTop: 0 }}>When the payment shows up in Actual, match it to keep the schedule in step with your lender.</p>
                  <button type="button" className="mt-btn primary" onClick={() => openMonth(current.payment)}>
                    Reconcile payment #{current.payment}
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {shown === 'reconcile' && s && payment !== null && state.setup && (
        <ReconcileView
          client={client}
          rows={s.rows}
          adjustments={state.adjustments}
          modules={modules}
          payment={Math.min(payment, s.rows.length)}
          onPaymentChange={setPayment}
          categoryId={state.settings.categoryId}
          onCategoryChange={setCategory}
          onState={setState}
          onRefresh={async () => {
            await refresh();
            onChange();
          }}
        />
      )}

      {shown === 'schedule' && s && <ScheduleView rows={s.rows} modules={modules} currentPayment={s.currentPayment} onOpen={openMonth} />}

      {shown === 'equity' && state.analysis && <EquityView state={state} client={client} onState={setState} />}
      {shown === 'escrow' && state.analysis && <EscrowView state={state} client={client} onState={setState} />}
      {shown === 'details' && <DetailsView state={state} client={client} onState={setState} />}
    </div>
  );
}

function Header({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mt-head">
      <div style={{ minWidth: 0 }}>
        <h1 className="mt-title">{title}</h1>
        {subtitle && <div className="mt-sub">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}
