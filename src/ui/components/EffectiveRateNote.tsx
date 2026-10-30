import type { EffectiveRate } from '../../engine/index.js';
import { percent } from '../format.js';
import { Amt } from './Amt.js';

/** The note rate next to the effective rate with fees, labeled as an estimate, with how it's worked out. */
export function EffectiveRateNote({ rate }: { rate: EffectiveRate }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div className="mt-row" style={{ color: 'var(--muted)', gap: 6 }}>
        <span>
          Rate {percent(rate.nominalPercent, 2)} · effective about <b style={{ color: 'var(--text)' }}>{percent(rate.percent, 2)}</b> a year
        </span>
        <span className="mt-pill">Estimate</span>
      </div>
      <details style={{ marginTop: 4 }}>
        <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 12 }}>How is this worked out?</summary>
        <p className="mt-kpi-note">
          It's the yearly rate, compounded monthly, at which what you received when the loan was opened equals everything you pay
          back on the original schedule.{' '}
          {rate.hasFees
            ? 'Fees push it above the note rate, because you pay interest on money you never had in hand.'
            : 'With no fees it is the note rate compounded monthly, which is why it is a little higher.'}
        </p>
        <ul className="mt-kpi-note" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {rate.feesAtOpening > 0 && <li>Fees paid at opening: <Amt cents={rate.feesAtOpening} /> (less money received)</li>}
          {rate.feesFinanced > 0 && <li>Fees in the amount borrowed: <Amt cents={rate.feesFinanced} /> (less money received)</li>}
          {rate.yearlyFees > 0 && <li>Yearly fees: <Amt cents={rate.yearlyFees} /> over the loan</li>}
          {rate.laterFees > 0 && <li>Later one-off fees: <Amt cents={rate.laterFees} /></li>}
          {rate.feesAdded > 0 && <li>Fees added to the balance: <Amt cents={rate.feesAdded} />, paid back with interest</li>}
          <li>Left out: PMI, escrow and extra principal. It follows the original schedule, so skips and extras don't change it.</li>
        </ul>
      </details>
    </div>
  );
}
