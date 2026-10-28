import { useState } from 'react';
import type { Backup, LoanListItem, TrackerClient } from '../api.js';
import { date } from '../format.js';

interface Props {
  client: TrackerClient;
  /** What's in the tracker now, so the restore warning can name it. */
  loans: LoanListItem[];
  /** Called after a restore replaced the data. */
  onRestored(): void;
}

/** A backup file the person picked, read in the browser before anything is sent. */
interface Picked {
  fileName: string;
  data: unknown;
  exportedAt: string;
  loans: string[];
  assets: number;
}

function readPicked(fileName: string, text: string): Picked {
  let data: Partial<Backup>;
  try {
    data = JSON.parse(text) as Partial<Backup>;
  } catch {
    throw new Error(`${fileName} is not a backup file (it isn't JSON).`);
  }
  if (data?.format !== 'ab-asset-tracker-backup' || !data.tables) throw new Error(`${fileName} is not an AB Asset Tracker backup file.`);
  const loans = Array.isArray(data.tables.loans) ? data.tables.loans.map((l) => String(l.nickname ?? 'Unnamed loan')) : [];
  const assets = Array.isArray(data.tables.assets) ? data.tables.assets.length : 0;
  return { fileName, data, exportedAt: String(data.exportedAt ?? ''), loans, assets };
}

function localDay(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** Download everything as one file, or replace everything from one. */
export function BackupView({ client, loans, onRestored }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [restored, setRestored] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const backup = await client.backup();
      const name = `ab-asset-tracker-backup-${localDay()}.json`;
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setSaved(`Saved ${name} with ${plural(backup.counts.loans ?? 0, 'loan')} and ${plural(backup.counts.assets ?? 0, 'asset')}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File | undefined) => {
    setError(null);
    setRestored(null);
    setPicked(null);
    if (!file) return;
    try {
      setPicked(readPicked(file.name, await file.text()));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const restore = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.restore(picked.data);
      setRestored(
        `Restored ${plural(result.counts.loans ?? 0, 'loan')} and ${plural(result.counts.assets ?? 0, 'asset')} from ${picked.fileName}.` +
          (result.safetyCopy ? ` The data it replaced was saved in the tracker's data folder as ${result.safetyCopy}.` : ''),
      );
      setPicked(null);
      onRestored();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && (
        <div className="mt-note bad" style={{ marginBottom: 14 }} role="alert">
          {error}
        </div>
      )}
      <div className="mt-grid mt-two">
        <div className="mt-card">
          <h3>Back up</h3>
          <p style={{ marginTop: 0 }}>
            Download everything in the tracker as one file: every loan (archived ones too) with its setup, reconciled months, skips,
            escrow entries and details, and every asset with its value history.
          </p>
          <p>
            Your budget isn't in it; back that up in Actual (<em>Settings → Export data</em>). Neither are your <code>.env</code>{' '}
            settings or passwords.
          </p>
          <button type="button" className="mt-btn primary" disabled={busy} onClick={() => void download()}>
            Download backup
          </button>
          {saved && (
            <div className="mt-note good" style={{ marginTop: 10 }} role="status">
              {saved}
            </div>
          )}
          <p className="mt-kpi-note" style={{ marginTop: 10 }}>
            The file is plain text and includes loan numbers and notes from Details. Keep it somewhere private.
          </p>
        </div>

        <div className="mt-card">
          <h3>Restore</h3>
          <p style={{ marginTop: 0 }}>
            Load a backup file to move to a new install or go back to an earlier point. A backup from an older version of the tracker
            works too.
          </p>
          <div className="mt-field">
            <label htmlFor="mt-restore-file">Backup file</label>
            <input
              id="mt-restore-file"
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(e) => {
                void pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          {picked && (
            <div className="mt-note warn" style={{ marginTop: 12 }}>
              <strong>{picked.fileName}</strong>
              {picked.exportedAt && <> was made {date(picked.exportedAt.slice(0, 10))}</>}. It has{' '}
              {plural(picked.loans.length, 'loan')}
              {picked.loans.length > 0 && <> ({picked.loans.join(', ')})</>} and {plural(picked.assets, 'asset')}.
              <p style={{ marginBottom: 8 }}>
                Restoring <strong>replaces everything in the tracker</strong>
                {loans.length > 0 && <>, including the {plural(loans.length, 'loan')} here now</>}. A copy of the current data is saved
                in the tracker's data folder first. Your budget in Actual isn't touched.
              </p>
              <div className="mt-row">
                <button type="button" className="mt-btn danger" disabled={busy} onClick={() => void restore()}>
                  Replace with this backup
                </button>
                <button type="button" className="mt-btn" disabled={busy} onClick={() => setPicked(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {restored && (
            <div className="mt-note good" style={{ marginTop: 12 }} role="status">
              {restored}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
