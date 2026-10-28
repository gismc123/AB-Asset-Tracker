// Bundle the browser code with esbuild.
//   dist/ui/inject.js     the single script the proxy injects into Actual
//   dist/ui/preview.html  stand-alone preview of the screens with mock data
import fs from 'node:fs';
import { build } from 'esbuild';

const outdir = 'dist/ui';
fs.mkdirSync(outdir, { recursive: true });

const common = {
  bundle: true,
  format: 'iife',
  target: ['es2020', 'chrome100', 'firefox100', 'safari15'],
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
};

const entries = [['src/ui/preview.tsx', `${outdir}/preview.js`]];
if (fs.existsSync('src/inject/inject.tsx')) entries.unshift(['src/inject/inject.tsx', `${outdir}/inject.js`]);
for (const [entry, outfile] of entries) await build({ ...common, entryPoints: [entry], outfile });

// Preview page. The variables below mimic Actual's light/dark theme, and the
// left column mimics its sidebar, so the components can be judged without a
// running Actual.
const navIcon = '<svg viewBox="0 0 20 20" width="15" height="15" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="3"/></svg>';
const nav = ['Budget', 'Reports', 'Schedules']
  .map((label) => `<a class="nav" href="#">${navIcon}<span>${label}</span></a>`)
  .join('\n  ');
fs.writeFileSync(
  `${outdir}/preview.html`,
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Loans preview (sample data)</title>
<style>
  html, body { margin: 0; height: 100%; }
  :root {
    --color-pageBackground: #f4f5f8;
    --color-sidebarBackground: #262a3f; --color-sidebarItemText: #e8e9f0;
    --color-sidebarItemBackgroundHover: rgba(255, 255, 255, 0.08); --color-sidebarItemAccentSelected: #a891f5;
  }
  :root.dark {
    --color-pageBackground: #141520; --color-pageText: #e8e9ee; --color-pageTextSubdued: #9a9cab;
    --color-cardBackground: #1e1f2c; --color-tableBackground: #1e1f2c; --color-tableBorder: #2e3040;
    --color-tableHeaderBackground: #24263a; --color-tableRowBackgroundHover: #26283a;
    --color-buttonNormalBackground: #26283a; --color-buttonNormalText: #e8e9ee; --color-buttonNormalBorder: #3a3d52;
    --color-formInputBackground: #181927; --color-formInputBorder: #3a3d52; --color-formInputText: #e8e9ee;
    --color-buttonPrimaryBackground: #8b6cf0; --color-pageTextLink: #a891f5;
    --color-noticeBackgroundLight: #12301f; --color-noticeTextLight: #6fd69b;
    --color-warningBackground: #3a2b0c; --color-warningText: #f1c063;
    --color-errorBackground: #3c1616; --color-errorText: #ff8a85;
    --color-sidebarBackground: #0f1017;
  }
  #sidebar { position: fixed; inset: 0 auto 0 0; width: 240px; background: var(--color-sidebarBackground); color: var(--color-sidebarItemText);
    font: 13px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding-top: 14px; overflow: auto; }
  #sidebar .brand { font-weight: 700; font-size: 15px; padding: 0 16px 14px; }
  #sidebar .nav { display: flex; align-items: center; gap: 10px; padding: 7px 16px; color: inherit; text-decoration: none; opacity: 0.85; }
  #sidebar .nav.current { opacity: 1; font-weight: 600; box-shadow: inset 3px 0 0 var(--color-sidebarItemAccentSelected); background: var(--color-sidebarItemBackgroundHover); }
  #app { position: fixed; inset: 0 0 0 240px; }
  @media (max-width: 720px) { #sidebar { display: none; } #app { left: 0; } }
</style>
</head>
<body>
<nav id="sidebar" aria-label="Sample sidebar">
  <div class="brand">Sample Budget</div>
  ${nav}
  <a class="nav current" href="#">${navIcon}<span>Loans</span></a>
  <div id="loans-list"></div>
</nav>
<div id="app"></div>
<script src="preview.js"></script>
</body>
</html>
`,
);
