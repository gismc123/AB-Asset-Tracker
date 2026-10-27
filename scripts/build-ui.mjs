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

// Preview page. The variables below mimic Actual's light/dark theme so the
// components can be judged without a running Actual.
fs.writeFileSync(
  `${outdir}/preview.html`,
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Mortgage tab preview (sample data)</title>
<style>
  html, body { margin: 0; height: 100%; }
  :root { --color-pageBackground: #f4f5f8; }
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
  }
  #app { position: fixed; inset: 0; }
</style>
</head>
<body>
<div id="app"></div>
<script src="preview.js"></script>
</body>
</html>
`,
);
