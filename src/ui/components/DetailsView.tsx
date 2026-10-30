import { useEffect, useState } from 'react';
import type { LoanDetailField } from '../../server/db.js';
import { modulesOf } from '../../engine/index.js';
import type { LoanDetails, LoanClient, LoanType, StateView } from '../api.js';

interface Props {
  state: StateView;
  client: LoanClient;
  onState(state: StateView): void;
}

type FieldSpec = { key: LoanDetailField; label: string; placeholder?: string; secret?: boolean; wide?: boolean; options?: string[] };

const SERVICER: FieldSpec[] = [
  { key: 'servicerName', label: 'Servicer / lender', placeholder: 'Who you send payments to' },
  { key: 'loanNumber', label: 'Loan / account number', secret: true },
  { key: 'servicerPhone', label: 'Phone' },
  { key: 'servicerWebsite', label: 'Website' },
  { key: 'servicerAddress', label: 'Payment mailing address', wide: true },
];

/** Only the sections that make sense for this kind of loan. */
function sectionsFor(type: LoanType, pmi: boolean): { title: string; fields: FieldSpec[] }[] {
  if (type === 'auto') {
    return [
      { title: 'Lender', fields: SERVICER },
      {
        title: 'Vehicle',
        fields: [
          { key: 'vin', label: 'VIN', secret: true },
          { key: 'licensePlate', label: 'License plate' },
          { key: 'lenderName', label: 'Original lender', placeholder: 'If different from the servicer' },
        ],
      },
      {
        title: 'Insurance',
        fields: [
          { key: 'insuranceCarrier', label: 'Auto insurance' },
          { key: 'insurancePolicyNumber', label: 'Policy number', secret: true },
          { key: 'insuranceAgent', label: 'Agent / contact' },
        ],
      },
    ];
  }
  if (type === 'personal' || type === 'student') {
    return [
      { title: 'Lender', fields: SERVICER },
      { title: 'Loan', fields: [{ key: 'lenderName', label: 'Original lender', placeholder: 'If different from the servicer' }] },
    ];
  }
  return [
    { title: 'Servicer', fields: SERVICER },
    {
      title: 'Loan',
      fields: [
        { key: 'lenderName', label: 'Original lender', placeholder: 'If different from the servicer' },
        { key: 'loanType', label: 'Loan type', options: ['Conventional', 'FHA', 'VA', 'USDA', 'Jumbo', 'Other'] },
        { key: 'mersMin', label: 'MERS MIN', placeholder: '18-digit number on your note', secret: true },
        { key: 'propertyAddress', label: 'Property address', wide: true },
      ],
    },
    {
      title: 'Insurance & taxes',
      fields: [
        { key: 'insuranceCarrier', label: 'Homeowners insurance' },
        { key: 'insurancePolicyNumber', label: 'Policy number', secret: true },
        { key: 'insuranceAgent', label: 'Agent / contact' },
        { key: 'taxParcelNumber', label: 'Tax parcel number' },
        { key: 'taxAuthority', label: 'Tax authority', placeholder: 'e.g. County Treasurer' },
      ],
    },
    ...(pmi
      ? [
          {
            title: 'PMI',
            fields: [
              { key: 'pmiCompany', label: 'Mortgage insurance company' },
              { key: 'pmiCertificateNumber', label: 'Certificate number', secret: true },
            ] as FieldSpec[],
          },
        ]
      : []),
  ];
}

/** Reference details about the loan: servicer, account numbers, insurance, notes. */
export function DetailsView({ state, client, onState }: Props) {
  const [d, setD] = useState<LoanDetails>(state.details);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setD(state.details), [state.details]);

  const setField = (key: LoanDetailField, value: string) => {
    setSaved(false);
    setD((p) => ({ ...p, fields: { ...p.fields, [key]: value } }));
  };
  const setCustom = (i: number, part: 'label' | 'value', value: string) => {
    setSaved(false);
    setD((p) => ({ ...p, custom: p.custom.map((c, k) => (k === i ? { ...c, [part]: value } : c)) }));
  };

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onState(await client.saveDetails(d));
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} noValidate autoComplete="off">
      <div className="mt-note" style={{ marginBottom: 14 }}>
        Kept only in the add-on's own database on your server. Never sent to Actual, and never included in the dashboard summary.
        Numbers marked ••• stay masked until you click into them.
      </div>

      {sectionsFor(state.loan.type, state.setup ? modulesOf(state.setup).pmi : state.loan.type === 'mortgage').map((section) => (
        <div key={section.title}>
          <div className="mt-card">
            <h3>{section.title}</h3>
            <div className="mt-form-section">
              {section.fields.map((f) => (
                <div className="mt-field" key={f.key} style={f.wide ? { gridColumn: '1 / -1' } : undefined}>
                  <label htmlFor={`mt-det-${f.key}`}>{f.label}</label>
                  {f.options ? (
                    <select id={`mt-det-${f.key}`} className="mt-select" style={{ width: '100%' }} value={d.fields[f.key] ?? ''} onChange={(ev) => setField(f.key, ev.target.value)}>
                      <option value="">—</option>
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`mt-det-${f.key}`}
                      className={`mt-input ${f.secret ? 'secret mt-secret' : ''}`}
                      placeholder={f.placeholder}
                      value={d.fields[f.key] ?? ''}
                      onChange={(ev) => setField(f.key, ev.target.value)}
                      autoComplete="off"
                      data-1p-ignore=""
                      data-lpignore="true"
                      spellCheck={false}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-gap" />
        </div>
      ))}

      <div className="mt-card">
        <h3>Notes & other details</h3>
        <div className="mt-field">
          <label htmlFor="mt-det-notes">Notes</label>
          <textarea id="mt-det-notes" className="mt-input" value={d.fields.notes ?? ''} onChange={(ev) => setField('notes', ev.target.value)} placeholder="Prepayment terms, who to call, anything worth remembering…" />
        </div>
        <div className="mt-gap" />
        <div style={{ display: 'grid', gap: 8 }}>
          {d.custom.map((c, i) => (
            <div className="mt-row" key={i} style={{ flexWrap: 'nowrap' }}>
              <input className="mt-input" style={{ flex: 1 }} aria-label="Label" placeholder="Label" value={c.label} onChange={(ev) => setCustom(i, 'label', ev.target.value)} />
              <input className="mt-input" style={{ flex: 2 }} aria-label="Value" placeholder="Value" value={c.value} onChange={(ev) => setCustom(i, 'value', ev.target.value)} />
              <button
                type="button"
                className="mt-x"
                aria-label={`Remove ${c.label || 'this field'}`}
                onClick={() => {
                  setSaved(false);
                  setD((p) => ({ ...p, custom: p.custom.filter((_, k) => k !== i) }));
                }}
              >
                ✕
              </button>
            </div>
          ))}
          <div>
            <button type="button" className="mt-btn small" disabled={d.custom.length >= 30} onClick={() => setD((p) => ({ ...p, custom: [...p.custom, { label: '', value: '' }] }))}>
              Add a field
            </button>
          </div>
        </div>
      </div>

      <div className="mt-gap" />
      {error && (
        <div className="mt-note bad" style={{ marginBottom: 12 }} role="alert">
          {error}
        </div>
      )}
      <div className="mt-row">
        <span className="mt-spacer" />
        {saved && <span style={{ color: 'var(--good)', fontWeight: 600 }}>Saved</span>}
        <button type="submit" className="mt-btn primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save details'}
        </button>
      </div>
    </form>
  );
}
