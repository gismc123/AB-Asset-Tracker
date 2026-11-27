import { RELEASE_URL, REPO_URL, VERSION } from '../version.js';

export type SettingsSection = 'about' | 'privacy' | 'terms';

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'about', label: 'About' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'terms', label: 'Terms of use' },
];

interface Props {
  section: SettingsSection;
  onSection(section: SettingsSection): void;
}

/** Version, privacy and terms for the whole tracker (not one loan). */
export function SettingsView({ section, onSection }: Props) {
  return (
    <>
      <div className="mt-tabs mt-screen-tabs" role="tablist" aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" role="tab" className="mt-tab" aria-selected={section === s.id} onClick={() => onSection(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      {section === 'about' && <About />}
      {section === 'privacy' && <Privacy />}
      {section === 'terms' && <Terms />}
    </>
  );
}

function External({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="mt-link">
      {children}
    </a>
  );
}

function About() {
  return (
    <div className="mt-card mt-prose">
      <h3>About</h3>
      <dl className="mt-facts">
        <dt>App</dt>
        <dd>AB Asset Tracker</dd>
        <dt>Version</dt>
        <dd>
          <strong>{VERSION === 'dev' ? 'development build' : `v${VERSION}`}</strong> ·{' '}
          <External href={RELEASE_URL}>Release notes</External>
        </dd>
        <dt>Source</dt>
        <dd>
          <External href={REPO_URL}>github.com/gismc123/AB-Asset-Tracker</External>
        </dd>
        <dt>License</dt>
        <dd>
          MIT · <External href={`${REPO_URL}/blob/main/LICENSE`}>Read the license</External>
        </dd>
        <dt>Help</dt>
        <dd>
          <External href={`${REPO_URL}/blob/main/docs/FAQ.md`}>FAQ</External> ·{' '}
          <External href={`${REPO_URL}/blob/main/docs/TROUBLESHOOTING.md`}>Troubleshooting</External> ·{' '}
          <External href={`${REPO_URL}/issues`}>Report a bug</External>
        </dd>
      </dl>
      <p className="mt-kpi-note">
        To check for a newer version, compare the version above with the latest release on GitHub. AB Asset Tracker is an independent
        add-on and is not affiliated with or endorsed by the Actual Budget project.
      </p>
    </div>
  );
}

function Privacy() {
  return (
    <div className="mt-card mt-prose">
      <h3>Privacy</h3>
      <p>
        AB Asset Tracker runs entirely on your own server. There is no account to create, no analytics, no tracking and no advertising,
        and the tracker makes no connections to anyone but your own Actual server.
      </p>
      <h4>What it stores, and where</h4>
      <ul>
        <li>
          Your loans, reconciled months, asset values, escrow entries and details are kept in a SQLite file in the tracker's{' '}
          <code>data/</code> folder on your server. Nothing is written to your budget in Actual.
        </li>
        <li>
          To read your transactions, the tracker keeps a downloaded copy of your budget in <code>data/actual-cache/</code>. It only reads
          from it.
        </li>
        <li>This browser remembers which loan you looked at last, so it opens there next time. Nothing else is kept in the browser.</li>
        <li>Backup files are made only when you ask for one, and are saved where you choose.</li>
      </ul>
      <h4>Who can see it</h4>
      <p>
        Anyone who can log in to your Actual server through the tracker can see every loan. Each request is checked against Actual's own
        login. If you turn on the optional summary endpoint, anyone with its token can read the loan summary.
      </p>
      <h4>Links</h4>
      <p>
        Links on this page, such as the release notes, open GitHub in a new tab. Nothing is sent to GitHub unless you click one.
      </p>
    </div>
  );
}

function Terms() {
  return (
    <div className="mt-card mt-prose">
      <h3>Terms of use</h3>
      <p>
        AB Asset Tracker is free, open-source software under the{' '}
        <External href={`${REPO_URL}/blob/main/LICENSE`}>MIT License</External>. You may use, copy, change and share it under that
        license.
      </p>
      <h4>No warranty</h4>
      <p>
        The software is provided "as is", without warranty of any kind. The authors are not liable for any claim, damages or other
        liability arising from its use.
      </p>
      <h4>Not financial advice</h4>
      <p>
        Schedules, balances, equity, payoff dates, PMI dates and what-if results are estimates worked out from the numbers you enter.
        They are not financial, legal or tax advice. Your lender's or servicer's statements are always the official record, so check
        important numbers with them before you act on them.
      </p>
      <h4>Your data</h4>
      <p>
        You host the tracker and its data yourself, so you are responsible for keeping your server secure and for making backups. Use
        Backup next to the loan tabs, and back up Actual separately.
      </p>
      <h4>Not affiliated with Actual</h4>
      <p>AB Asset Tracker is an independent add-on. It is not affiliated with or endorsed by the Actual Budget project.</p>
    </div>
  );
}

/** Version and links at the bottom of every Loans screen. */
export function Footer({ onOpen }: { onOpen(section: SettingsSection): void }) {
  return (
    <footer className="mt-footer">
      <span>
        AB Asset Tracker{' '}
        <External href={RELEASE_URL}>
          <span className="mt-version">{VERSION === 'dev' ? 'dev' : `v${VERSION}`}</span>
        </External>
      </span>
      <nav aria-label="About the tracker" className="mt-footer-links">
        <button type="button" className="mt-btn link" onClick={() => onOpen('about')}>
          Settings
        </button>
        <button type="button" className="mt-btn link" onClick={() => onOpen('privacy')}>
          Privacy
        </button>
        <button type="button" className="mt-btn link" onClick={() => onOpen('terms')}>
          Terms
        </button>
      </nav>
    </footer>
  );
}
