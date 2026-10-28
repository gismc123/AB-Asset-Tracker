import { useMemo, useState } from 'react';
import { isValidISODate, type LoanSetup, type ValueTrend } from '../../engine/index.js';
import type { AssetFields, LoanType, NewLoan } from '../api.js';
import { parseDollars } from '../format.js';
import { ASSET_KIND_LABEL, LOAN_TYPE_INFO } from '../loanTypes.js';
import { SetupForm } from './SetupForm.js';
import { TypeIcon } from './TypeIcon.js';

interface Props {
  /** True when there are no loans yet: shows the first-run welcome. */
  firstRun: boolean;
  onCreate(loan: NewLoan): Promise<void>;
  onCancel?(): void;
}

const TYPES: LoanType[] = ['mortgage', 'auto', 'personal'];

/** Default yearly depreciation offered for vehicles. Clearly an estimate; editable. */
const VEHICLE_DEPRECIATION = '15';

interface AssetDraft {
  track: boolean;
  name: string;
  value: string;
  trend: ValueTrend;
  rate: string;
}

function assetDefaults(type: LoanType): AssetDraft {
  if (type === 'mortgage') return { track: true, name: 'Home', value: '', trend: 'manual', rate: '' };
  if (type === 'auto') return { track: true, name: 'Car', value: '', trend: 'depreciating', rate: VEHICLE_DEPRECIATION };
  return { track: false, name: '', value: '', trend: 'manual', rate: '' };
}

/**
 * Add a loan in two steps: pick the type, then fill in only what that type
 * needs. With no loans yet, the first step doubles as the welcome screen.
 */
export function AddLoanWizard({ firstRun, onCreate, onCancel }: Props) {
  const [type, setType] = useState<LoanType | null>(null);
  const [nickname, setNickname] = useState('');
  const [asset, setAsset] = useState<AssetDraft>(assetDefaults('mortgage'));

  const choose = (t: LoanType) => {
    setType(t);
    setNickname(LOAN_TYPE_INFO[t].nickname);
    setAsset(assetDefaults(t));
  };

  if (!type) {
    return (
      <div>
        {firstRun && (
          <div className="mt-card mt-welcome">
            <h2>Track your loans next to your budget</h2>
            <p>
              Add each loan once, from its paperwork. Every month, match the payment that synced into Actual and the schedule
              stays in step with your lender: balance, interest, payoff date, and what you own versus what you owe.
            </p>
            <ol>
              <li>Pick the kind of loan below.</li>
              <li>Enter its terms (and what it paid for, if anything).</li>
              <li>Choose the Actual category its payments land in, then reconcile the first month.</li>
            </ol>
            <p className="mt-kpi-note">Nothing here changes your budget. The tracker only reads from Actual.</p>
          </div>
        )}
        {firstRun && <div className="mt-gap" />}
        <h3 className="mt-step">{firstRun ? 'What kind of loan is your first one?' : 'What kind of loan?'}</h3>
        <div className="mt-grid mt-three">
          {TYPES.map((t) => (
            <button key={t} type="button" className="mt-type-card" onClick={() => choose(t)}>
              <TypeIcon type={t} />
              <b>{LOAN_TYPE_INFO[t].label}</b>
              <small>{LOAN_TYPE_INFO[t].blurb}</small>
            </button>
          ))}
        </div>
        {onCancel && (
          <div className="mt-row" style={{ marginTop: 14 }}>
            <button type="button" className="mt-btn link" onClick={onCancel}>
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  return <Details type={type} nickname={nickname} setNickname={setNickname} asset={asset} setAsset={setAsset} onBack={() => setType(null)} onCreate={onCreate} />;
}

function Details({ type, nickname, setNickname, asset, setAsset, onBack, onCreate }: {
  type: LoanType;
  nickname: string;
  setNickname(v: string): void;
  asset: AssetDraft;
  setAsset(fn: (a: AssetDraft) => AssetDraft): void;
  onBack(): void;
  onCreate(loan: NewLoan): Promise<void>;
}) {
  const info = LOAN_TYPE_INFO[type];
  const kind = info.assetKind ?? 'other';
  const assetValue = parseDollars(asset.value);

  const problems = useMemo(() => {
    const out: string[] = [];
    if (!nickname.trim()) out.push('Give the loan a nickname');
    if (asset.track) {
      if (!asset.name.trim()) out.push(`Name the ${ASSET_KIND_LABEL[kind].toLowerCase()}`);
      if (assetValue === null || assetValue <= 0) out.push(`Enter what the ${ASSET_KIND_LABEL[kind].toLowerCase()} cost`);
      if (asset.trend !== 'manual' && !(Number(asset.rate) > 0 && Number(asset.rate) <= 100)) out.push('The yearly change has to be between 0 and 100 percent');
    }
    return out;
  }, [nickname, asset, assetValue, kind]);

  const toAsset = (setup: LoanSetup): AssetFields | null =>
    asset.track
      ? {
          name: asset.name.trim(),
          kind,
          originalValue: assetValue ?? 0,
          valueTrend: asset.trend,
          trendRatePercent: asset.trend === 'manual' ? null : Number(asset.rate),
          acquiredDate: isValidISODate(setup.openDate) ? setup.openDate : null,
        }
      : null;

  const set = (patch: Partial<AssetDraft>) => setAsset((a) => ({ ...a, ...patch }));

  const header = (
    <>
      <div className="mt-row" style={{ marginBottom: 12 }}>
        <button type="button" className="mt-btn link" onClick={onBack}>
          ‹ Loan type
        </button>
        <span className="mt-pill">
          <TypeIcon type={type} /> {info.label}
        </span>
      </div>
      <div className="mt-card">
        <h3>{type === 'personal' ? 'Name' : `Name & ${ASSET_KIND_LABEL[kind].toLowerCase()}`}</h3>
        <div className="mt-form-section">
          <div className="mt-field">
            <label htmlFor="mt-nickname">Nickname</label>
            <input id="mt-nickname" className="mt-input" maxLength={60} value={nickname} onChange={(e) => setNickname(e.target.value)} />
            <div className="hint">How the loan shows up in the picker and the sidebar.</div>
          </div>
        </div>
        {type === 'personal' && (
          <label className="mt-row" style={{ cursor: 'pointer', marginTop: 14 }}>
            <input type="checkbox" checked={asset.track} onChange={(e) => set({ track: e.target.checked, name: asset.name || 'Asset' })} />
            This loan paid for something whose value I want to track (a boat, equipment…)
          </label>
        )}
        {asset.track && (
          <div className="mt-form-section" style={{ marginTop: 14 }}>
            <div className="mt-field">
              <label htmlFor="mt-asset-name">{ASSET_KIND_LABEL[kind]}</label>
              <input id="mt-asset-name" className="mt-input" maxLength={80} value={asset.name} onChange={(e) => set({ name: e.target.value })} placeholder={type === 'auto' ? 'e.g. 2024 hatchback' : undefined} />
            </div>
            <div className="mt-field">
              <label htmlFor="mt-asset-value">{type === 'mortgage' ? 'Purchase price' : 'Price paid'}</label>
              <div className="mt-prefix">
                <span>$</span>
                <input id="mt-asset-value" className="mt-input" inputMode="decimal" value={asset.value} placeholder={type === 'mortgage' ? '355,000.00' : '36,000.00'} onChange={(e) => set({ value: e.target.value })} />
              </div>
              <div className="hint">Equity starts from this until you enter a newer value.</div>
            </div>
            <div className="mt-field">
              <label htmlFor="mt-asset-trend">Value over time</label>
              <select id="mt-asset-trend" className="mt-select" style={{ width: '100%' }} value={asset.trend} onChange={(e) => set({ trend: e.target.value as ValueTrend, rate: e.target.value === 'manual' ? '' : asset.rate || (e.target.value === 'depreciating' ? VEHICLE_DEPRECIATION : '3') })}>
                <option value="manual">Only the values I enter</option>
                <option value="depreciating">Project a yearly drop (estimate)</option>
                <option value="appreciating">Project a yearly rise (estimate)</option>
              </select>
            </div>
            {asset.trend !== 'manual' && (
              <div className="mt-field">
                <label htmlFor="mt-asset-rate">Yearly change</label>
                <div className="mt-suffix">
                  <input id="mt-asset-rate" className="mt-input" inputMode="decimal" value={asset.rate} onChange={(e) => set({ rate: e.target.value })} />
                  <span>%</span>
                </div>
                <div className="hint">A rough curve for the chart ahead, always labeled as an estimate. Equity today uses the latest value you enter.</div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="mt-gap" />
    </>
  );

  return (
    <SetupForm
      key={type}
      type={type}
      initial={null}
      hasReconciled={false}
      header={header}
      headerProblems={problems}
      homeValueFromAsset={type === 'mortgage' && asset.track ? assetValue : undefined}
      submitLabel="Add loan"
      onSave={(setup) => onCreate({ nickname: nickname.trim(), type, setup, asset: toAsset(setup) })}
    />
  );
}

