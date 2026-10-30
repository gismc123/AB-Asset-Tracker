import { useMemo, useState } from 'react';
import {
  BANK_COLUMNS,
  guessDateFormat,
  guessMapping,
  guessNumberFormat,
  parseCsv,
  readBankTable,
  type BankColumn,
  type BankMapping,
  type DateFormat,
  type NumberFormat,
} from '../../engine/index.js';
import type { BankPreview, LoanClient, StateView } from '../api.js';
import { date } from '../format.js';
import { Amt } from './Amt.js';

interface Props {
  state: StateView;
  client: LoanClient;
  onState(state: StateView): void;
}

const LABELS: Record<BankColumn, string> = {
  date: 'Date',
  number: 'Payment #',
  payment: 'Payment',
  principal: 'Principal',
  interest: 'Interest',
  balance: 'Balance',
};

/**
 * Import the lender's amortization table from a CSV file, so each month's
 * interest and principal match the lender exactly. Read in the browser,
 * mapped column by column, previewed, then saved. Imported months can be
 * removed one by one or all at once.
 */
export function BankTableView({ state, client, onState }: Props) {
  const rows = state.schedule!.rows;
  const imported = state.bankSchedule;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [mapping, setMapping] = useState<BankMapping>({});
  const [header, setHeader] = useState(true);
  const [dateFormat, setDateFormat] = useState<DateFormat>('mdy');
  const [numberFormat, setNumberFormat] = useState<NumberFormat>('dot');
  const [preview, setPreview] = useState<BankPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);

  const cells = useMemo(() => (text ? parseCsv(text) : []), [text]);
  const read = useMemo(
    () => (cells.length ? readBankTable(cells, mapping, { header, dateFormat, numberFormat }, rows) : null),
    [cells, mapping, header, dateFormat, numberFormat, rows],
  );
  const columns = Math.max(0, ...cells.map((r) => r.length));
  const columnName = (i: number) => (header && cells[0]?.[i] ? `${cells[0][i]}` : `Column ${i + 1}`);

  const load = (contents: string, name: string | null) => {
    setText(contents);
    setFileName(name);
    setPreview(null);
    setError(null);
    const c = parseCsv(contents);
    const guessed = c.length ? guessMapping(c[0]!) : {};
    const hasHeader = Object.keys(guessed).length >= 2;
    setHeader(hasHeader);
    setMapping(hasHeader ? guessed : {});
    const body = hasHeader ? c.slice(1) : c;
    if (guessed.date !== undefined) setDateFormat(guessDateFormat(body.map((r) => r[guessed.date!] ?? '')));
    setNumberFormat(guessNumberFormat(body.flatMap((r) => r)));
  };
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) return setError('That file is too big for an amortization table.');
    load(await file.text(), file.name);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const doPreview = () => run(async () => setPreview(await client.previewBankSchedule(read!.rows)));
  const apply = () =>
    run(async () => {
      onState(await client.saveBankSchedule(read!.rows));
      setText('');
      setPreview(null);
      setOpen(false);
    });
  const remove = (payment?: number) => run(async () => onState(await client.deleteBankSchedule(payment)));

  const canPreview = !!read?.rows.length && mapping.interest !== undefined && (mapping.principal !== undefined || mapping.payment !== undefined);

  return (
    <div className="mt-card" style={{ marginBottom: 14 }}>
      <div className="mt-row">
        <h3 style={{ margin: 0 }}>Lender's amortization table</h3>
        <span className="mt-spacer" />
        {!open && (
          <button type="button" className="mt-btn small" onClick={() => setOpen(true)}>
            {imported.length ? 'Import more' : 'Import a CSV file'}
          </button>
        )}
      </div>
      {imported.length > 0 ? (
        <div className="mt-row" style={{ marginTop: 8 }}>
          <span>
            {imported.length} {imported.length === 1 ? 'month uses' : 'months use'} your lender's numbers (#{imported[0]!.payment} to #
            {imported.at(-1)!.payment}). After the table, months are calculated from the balance it leaves.
          </span>
          <button type="button" className="mt-btn link" onClick={() => setShowList((v) => !v)}>
            {showList ? 'Hide' : 'Show'} months
          </button>
          <button type="button" className="mt-btn link" disabled={busy} onClick={() => remove()}>
            Remove all
          </button>
        </div>
      ) : (
        !open && (
          <p className="mt-kpi-note" style={{ marginBottom: 0 }}>
            If your lender's interest doesn't match the calculation to the cent, import their table and those months use the
            lender's interest and principal.
          </p>
        )
      )}
      {showList && imported.length > 0 && (
        <div className="mt-table-wrap" style={{ maxHeight: 240, marginTop: 8 }}>
          <table className="mt-data">
            <thead>
              <tr>
                <th>#</th>
                <th className="l">Date in file</th>
                <th>Interest</th>
                <th>Principal</th>
                <th>Balance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {imported.map((r) => (
                <tr key={r.payment}>
                  <td className="l">{r.payment}</td>
                  <td className="l">{r.dueDate ? date(r.dueDate) : ''}</td>
                  <td><Amt cents={r.interest} /></td>
                  <td><Amt cents={r.principal} /></td>
                  <td>{r.balance === null ? '' : <Amt cents={r.balance} />}</td>
                  <td style={{ width: 1 }}>
                    <button type="button" className="mt-x" aria-label={`Remove the imported row for #${r.payment}`} disabled={busy} onClick={() => remove(r.payment)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div style={{ marginTop: 12 }}>
          <p className="mt-kpi-note" style={{ marginTop: 0 }}>
            CSV only: open the lender's table in a spreadsheet and save it as CSV. Nothing is saved until you choose "Use these
            months". Reconciled months keep what they paid.
          </p>
          <div className="mt-row">
            <label className="mt-btn small" style={{ cursor: 'pointer' }}>
              Choose a file
              <input type="file" accept=".csv,.txt,text/csv,text/plain" style={{ display: 'none' }} onChange={(e) => void pick(e.target.files?.[0])} />
            </label>
            <span className="mt-kpi-note" style={{ marginTop: 0 }}>{fileName ?? 'or paste it below'}</span>
            <span className="mt-spacer" />
            <button type="button" className="mt-btn link" onClick={() => { setOpen(false); setText(''); setPreview(null); }}>
              Cancel
            </button>
          </div>
          {!fileName && (
            <textarea
              className="mt-input"
              aria-label="Paste the table"
              rows={4}
              style={{ width: '100%', marginTop: 8, fontFamily: 'monospace', fontSize: 12 }}
              placeholder={'Date,Payment,Principal,Interest,Balance\n04/01/2025,2022.62,289.29,1733.33,319710.71'}
              value={text}
              onChange={(e) => load(e.target.value, null)}
            />
          )}

          {cells.length > 0 && (
            <>
              <div className="mt-inline-form" style={{ marginTop: 12 }}>
                {BANK_COLUMNS.map((field) => (
                  <div className="mt-field" key={field}>
                    <label htmlFor={`mt-bt-${field}`}>
                      {LABELS[field]}
                      {field === 'interest' ? ' *' : ''}
                    </label>
                    <select
                      id={`mt-bt-${field}`}
                      className="mt-select"
                      style={{ width: '100%', minWidth: 0 }}
                      value={mapping[field] ?? ''}
                      onChange={(e) => {
                        setPreview(null);
                        setMapping({ ...mapping, [field]: e.target.value === '' ? undefined : Number(e.target.value) });
                      }}
                    >
                      <option value="">Not in the file</option>
                      {Array.from({ length: columns }, (_, i) => (
                        <option key={i} value={i}>
                          {columnName(i)}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="mt-row" style={{ marginTop: 10 }}>
                <label className="mt-row" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={header} onChange={(e) => { setPreview(null); setHeader(e.target.checked); }} />
                  First row is column names
                </label>
                <select className="mt-select" aria-label="Date format" value={dateFormat} onChange={(e) => { setPreview(null); setDateFormat(e.target.value as DateFormat); }}>
                  <option value="mdy">Dates like 04/01/2025 (month first)</option>
                  <option value="dmy">Dates like 01/04/2025 (day first)</option>
                  <option value="ymd">Dates like 2025-04-01</option>
                </select>
                <select className="mt-select" aria-label="Number format" value={numberFormat} onChange={(e) => { setPreview(null); setNumberFormat(e.target.value as NumberFormat); }}>
                  <option value="dot">Numbers like 1,234.56</option>
                  <option value="comma">Numbers like 1.234,56</option>
                </select>
              </div>
              <p className="mt-kpi-note">
                Needs interest, and principal or the payment. Months are matched by payment number, or by the month of the date.
                {read && (
                  <>
                    {' '}
                    Found <b>{read.rows.length}</b> {read.rows.length === 1 ? 'month' : 'months'}
                    {read.rows.length > 0 && <> (#{read.rows[0]!.payment} to #{read.rows.at(-1)!.payment})</>}.
                    {read.skipped.length > 0 && <> {read.skipped.length} {read.skipped.length === 1 ? 'line' : 'lines'} left out: {read.skipped.slice(0, 3).map((s) => `line ${s.line} (${s.reason.toLowerCase()})`).join(', ')}{read.skipped.length > 3 ? ', …' : ''}.</>}
                  </>
                )}
              </p>
              <button type="button" className="mt-btn" disabled={busy || !canPreview} onClick={doPreview}>
                Preview
              </button>
            </>
          )}

          {preview && (
            <div style={{ marginTop: 12 }}>
              <div className="mt-table-wrap" style={{ maxHeight: 320 }}>
                <table className="mt-data">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th className="l">Due</th>
                      <th>Interest now</th>
                      <th>Lender's</th>
                      <th>Principal now</th>
                      <th>Lender's</th>
                      <th>Balance after</th>
                      <th>Lender's</th>
                      <th className="l" />
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.payment} className={r.applies ? undefined : 'muted'}>
                        <td className="l">{r.payment}</td>
                        <td className="l">{date(r.dueDate)}</td>
                        <td className="muted">{r.now ? <Amt cents={r.now.interest} /> : ''}</td>
                        <td><Amt cents={r.bank.interest} /></td>
                        <td className="muted">{r.now ? <Amt cents={r.now.principal} /> : ''}</td>
                        <td><Amt cents={r.bank.principal} /></td>
                        <td>{r.then ? <Amt cents={r.then.endingBalance} /> : ''}</td>
                        <td className={r.bank.balance !== null && r.then && r.applies && r.bank.balance !== r.then.endingBalance ? 'neg' : 'muted'}>
                          {r.bank.balance === null ? '' : <Amt cents={r.bank.balance} />}
                        </td>
                        <td className="l muted">{r.note ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.balanceCheck && (
                <div className={`mt-note ${preview.balanceCheck.bank === preview.balanceCheck.tracker ? 'good' : 'warn'}`} style={{ marginTop: 10 }}>
                  {preview.balanceCheck.bank === preview.balanceCheck.tracker ? (
                    <>After #{preview.balanceCheck.payment} the balance matches the lender's to the cent.</>
                  ) : (
                    <>
                      After #{preview.balanceCheck.payment} the tracker's balance would be <Amt cents={preview.balanceCheck.tracker} />, the
                      lender's <Amt cents={preview.balanceCheck.bank} /> (<Amt cents={preview.balanceCheck.tracker - preview.balanceCheck.bank} sign />). The
                      lender's table may start from a different balance, or not include extra payments you recorded. The tracker
                      keeps its own balance either way.
                    </>
                  )}
                </div>
              )}
              <div className="mt-row" style={{ marginTop: 10 }}>
                <span className="mt-kpi-note" style={{ marginTop: 0 }}>
                  {preview.applies} of {preview.rows.length} months would change. Payoff {date(preview.payoffDate.now, 'month')}
                  {preview.payoffDate.then !== preview.payoffDate.now && <> → {date(preview.payoffDate.then, 'month')}</>}.
                </span>
                <span className="mt-spacer" />
                <button type="button" className="mt-btn primary" disabled={busy} onClick={apply}>
                  Use these {preview.rows.length} months
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="mt-note bad" style={{ marginTop: 10 }} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
