/**
 * Styles for the loan screens. They live inside a shadow root, so they
 * cannot leak into Actual and Actual's styles cannot leak in. Colors come
 * from Actual's own theme variables (which do cross the shadow boundary),
 * with fallbacks, so the tab follows Actual's light/dark theme.
 */
export const styles = /* css */ `
:host { all: initial; }
.mt {
  --bg: var(--color-pageBackground, #f4f5f8);
  --card: var(--color-cardBackground, var(--color-tableBackground, #fff));
  --border: var(--color-tableBorder, #e2e4ea);
  --text: var(--color-pageText, #272630);
  --muted: var(--color-pageTextSubdued, #6b6f7b);
  --link: var(--color-pageTextLink, #5c3dbb);
  --primary: var(--color-buttonPrimaryBackground, #5c3dbb);
  --primary-text: var(--color-buttonPrimaryText, #fff);
  --btn: var(--color-buttonNormalBackground, #fff);
  --btn-text: var(--color-buttonNormalText, #272630);
  --btn-border: var(--color-buttonNormalBorder, #d0d3db);
  --input: var(--color-formInputBackground, #fff);
  --input-border: var(--color-formInputBorder, #d0d3db);
  --input-text: var(--color-formInputText, #272630);
  --hover: var(--color-tableRowBackgroundHover, #f6f7fa);
  --header: var(--color-tableHeaderBackground, #f7f8fa);
  --good: var(--color-noticeTextLight, #1a7f4b);
  --good-bg: var(--color-noticeBackgroundLight, #e8f6ee);
  --warn: var(--color-warningText, #9a5b00);
  --warn-bg: var(--color-warningBackground, #fff5e1);
  --bad: var(--color-errorText, #c4302b);
  --bad-bg: var(--color-errorBackground, #fdecec);
  --shadow: 0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.05);
  /* Validated categorical slots (light). */
  --s-principal: #2a78d6;
  --s-interest: #eb6834;
  --s-pmi: #1baf7a;
  --s-escrow: #eda100;

  /* --mt-top: height of Actual's top bar, set by the injected script. */
  position: absolute; inset: var(--mt-top, 0px) 0 0 0; overflow: auto;
  background: var(--bg); color: var(--text);
  font: 13px/1.45 var(--font-family, 'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
  font-feature-settings: 'tnum' 1;
  -webkit-font-smoothing: antialiased;
}
.mt.dark {
  --s-principal: #3987e5;
  --s-interest: #d95926;
  --s-pmi: #199e70;
  --s-escrow: #c98500;
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
}
.mt *, .mt *::before, .mt *::after { box-sizing: border-box; }
.mt-page { max-width: 1120px; margin: 0 auto; padding: 24px 28px 64px; }

/* header, loan picker and tabs */
.mt-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
.mt-title { font-size: 24px; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
.mt-sub { color: var(--muted); margin-top: 2px; }
.mt-tabs { display: flex; gap: 2px; background: var(--header); border: 1px solid var(--border); border-radius: 8px; padding: 3px; }
.mt-tab { border: 0; background: transparent; color: var(--muted); font: inherit; font-weight: 600; padding: 6px 14px; border-radius: 6px; cursor: pointer; }
.mt-tab:hover { color: var(--text); }
.mt-tab[aria-selected='true'] { background: var(--card); color: var(--text); box-shadow: var(--shadow); }
.mt-screen-tabs { display: inline-flex; flex-wrap: wrap; margin-bottom: 18px; }
.mt-picker { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
.mt-loan-tab { display: inline-flex; align-items: center; gap: 6px; max-width: 220px; font: inherit; font-weight: 600; color: var(--muted); background: transparent; border: 1px solid var(--border); border-radius: 999px; padding: 5px 12px; cursor: pointer; }
.mt-loan-tab span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mt-loan-tab:hover { color: var(--text); background: var(--hover); }
.mt-loan-tab[aria-selected='true'] { color: var(--text); background: var(--card); border-color: var(--primary); box-shadow: var(--shadow); }
.mt-loan-tab.add { border-style: dashed; }
.mt-type-icon { display: inline-flex; flex: none; }
.mt-type-icon svg { display: block; }
.mt-pill .mt-type-icon svg { width: 12px; height: 12px; }

/* add-loan wizard and first run */
.mt-welcome h2 { margin: 0 0 8px; font-size: 18px; }
.mt-welcome ol { margin: 8px 0; padding-left: 20px; }
.mt-step { margin: 0 0 10px; font-size: 14px; font-weight: 700; }
.mt-type-card { display: grid; gap: 6px; text-align: left; font: inherit; color: inherit; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 16px; cursor: pointer; box-shadow: var(--shadow); }
.mt-type-card:hover { border-color: var(--primary); }
.mt-type-card .mt-type-icon { color: var(--primary); }
.mt-type-card .mt-type-icon svg { width: 22px; height: 22px; }
.mt-type-card b { font-size: 15px; }
.mt-type-card small { color: var(--muted); }

/* cards and layout */
.mt-grid { display: grid; gap: 14px; }
.mt-kpis { grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
.mt-two { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); }
.mt-halves { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
@media (max-width: 860px) { .mt-halves { grid-template-columns: 1fr; } }
@media (max-width: 860px) { .mt-two { grid-template-columns: 1fr; } }
.mt-card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; box-shadow: var(--shadow); min-width: 0; }
.mt-card h3 { margin: 0 0 12px; font-size: 13px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.mt-gap { height: 14px; }

.mt-kpi-label { color: var(--muted); font-size: 12px; font-weight: 500; }
.mt-kpi-value { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; margin-top: 4px; }
.mt-kpi-note { color: var(--muted); font-size: 12px; margin-top: 2px; }
.mt-meter { height: 6px; border-radius: 3px; background: var(--header); overflow: hidden; margin-top: 10px; }
.mt-meter > span { display: block; height: 100%; background: var(--s-principal); border-radius: 3px; }

/* breakdown */
.mt-stack { display: flex; height: 12px; gap: 2px; margin: 4px 0 14px; }
.mt-stack > span { border-radius: 2px; min-width: 2px; }
.mt-stack > span:first-child { border-top-left-radius: 4px; border-bottom-left-radius: 4px; }
.mt-stack > span:last-child { border-top-right-radius: 4px; border-bottom-right-radius: 4px; }
.mt-legend { display: grid; gap: 7px; }
.mt-legend-row { display: flex; align-items: center; gap: 8px; }
.mt-swatch { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.mt-legend-row .v { margin-left: auto; font-weight: 600; }
.mt-legend-total { border-top: 1px solid var(--border); padding-top: 8px; margin-top: 2px; font-weight: 700; }

/* PMI countdown */
.mt-count { display: flex; align-items: baseline; gap: 6px; }
.mt-count-big { font-size: 34px; font-weight: 700; letter-spacing: -0.02em; }
.mt-milestones { display: grid; gap: 10px; margin-top: 14px; }
.mt-milestone { display: grid; grid-template-columns: 18px 1fr auto; gap: 8px; align-items: start; }
.mt-dot { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--muted); margin-top: 4px; }
.mt-dot.done { background: var(--good); border-color: var(--good); }
.mt-dot.next { border-color: var(--primary); }
.mt-milestone .t { font-weight: 600; }
.mt-milestone .d { color: var(--muted); font-size: 12px; }
.mt-milestone .r { text-align: right; font-weight: 600; white-space: nowrap; }

/* chart */
.mt-chart { width: 100%; height: auto; display: block; overflow: visible; }
.mt-chart .grid { stroke: var(--border); stroke-width: 1; }
.mt-chart .axis { fill: var(--muted); font-size: 11px; }
.mt-chart .line { fill: none; stroke: var(--s-principal); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.mt-chart .line.projected { stroke-dasharray: 5 4; }
.mt-chart .area { fill: var(--s-principal); opacity: 0.1; }
.mt-chart .ref { stroke: var(--muted); stroke-width: 1; }
.mt-chart .ref-label { fill: var(--muted); font-size: 11px; }
.mt-chart .today { stroke: var(--text); stroke-width: 1; opacity: 0.5; }
.mt-chart .cross { stroke: var(--text); stroke-width: 1; opacity: 0.35; }
.mt-chart .dot { fill: var(--s-principal); stroke: var(--card); stroke-width: 2; }
.mt-chart-wrap { position: relative; }
.mt-tip { position: absolute; pointer-events: none; background: var(--card); border: 1px solid var(--border); box-shadow: var(--shadow); border-radius: 8px; padding: 8px 10px; font-size: 12px; white-space: nowrap; transform: translate(-50%, -110%); }
.mt-tip b { display: block; font-size: 13px; }

/* buttons + inputs */
.mt-btn { font: inherit; font-weight: 600; border-radius: 6px; padding: 7px 14px; cursor: pointer; border: 1px solid var(--btn-border); background: var(--btn); color: var(--btn-text); }
.mt-btn:hover { filter: brightness(0.97); }
.mt-btn:disabled { opacity: 0.55; cursor: default; }
.mt-btn.primary { background: var(--primary); color: var(--primary-text); border-color: transparent; }
.mt-btn.small { padding: 4px 10px; font-size: 12px; }
.mt-btn.link { border: 0; background: none; color: var(--link); padding: 4px 6px; }
.mt-btn.danger { background: var(--bad); color: #fff; border-color: transparent; }
.mt-kpi-value.neg { color: var(--bad); }
.mt-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.mt-spacer { flex: 1; }
.mt-input, .mt-select { font: inherit; color: var(--input-text); background: var(--input); border: 1px solid var(--input-border); border-radius: 6px; padding: 7px 10px; width: 100%; }
.mt-input:focus, .mt-select:focus { outline: 2px solid var(--primary); outline-offset: -1px; }
.mt-select { width: auto; min-width: 220px; }

/* forms */
.mt-form-section { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px 18px; }
.mt-field label { display: block; font-weight: 600; margin-bottom: 5px; }
.mt-field .hint { color: var(--muted); font-size: 12px; margin-top: 4px; }
.mt-prefix, .mt-suffix { position: relative; }
.mt-prefix > span, .mt-suffix > span { position: absolute; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
.mt-prefix > span { left: 10px; }
.mt-prefix > .mt-input { padding-left: 22px; }
.mt-suffix > span { right: 10px; }
.mt-suffix > .mt-input { padding-right: 26px; }
.mt-radio { display: grid; gap: 8px; }
.mt-radio label { display: flex; gap: 10px; align-items: flex-start; font-weight: 400; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; }
.mt-radio label:has(input:checked) { border-color: var(--primary); background: var(--hover); }
.mt-radio input { margin-top: 2px; accent-color: var(--primary); }
.mt-radio b { display: block; }
.mt-radio small { color: var(--muted); }

/* notices */
.mt-note { border-radius: 8px; padding: 10px 12px; border: 1px solid var(--border); background: var(--header); }
.mt-note.good { background: var(--good-bg); color: var(--good); border-color: transparent; }
.mt-note.warn { background: var(--warn-bg); color: var(--warn); border-color: transparent; }
.mt-note.bad { background: var(--bad-bg); color: var(--bad); border-color: transparent; }
.mt-note ul { margin: 6px 0 0; padding-left: 18px; }

/* pills */
.mt-pill { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 8px; border-radius: 999px; background: var(--header); color: var(--muted); }
.mt-pill.paid { background: var(--good-bg); color: var(--good); }
.mt-pill.flagged { background: var(--warn-bg); color: var(--warn); }
.mt-pill.skipped { background: var(--header); color: var(--muted); border: 1px dashed var(--muted); }
.mt-pill.history { background: var(--header); color: var(--muted); }

/* plain data tables inside cards */
.mt-data { width: 100%; border-collapse: collapse; }
.mt-data th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; text-align: right; padding: 6px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
.mt-data td { padding: 7px 10px; text-align: right; border-bottom: 1px solid var(--border); white-space: nowrap; }
.mt-data th:first-child, .mt-data td:first-child, .mt-data .l { text-align: left; }
.mt-data tr:last-child td { border-bottom: 0; }
.mt-data tr.total td { font-weight: 700; border-top: 1px solid var(--border); }
.mt-data td.muted, .mt-data .muted { color: var(--muted); }
.mt-data .neg { color: var(--bad); }
.mt-data .good { color: var(--good); }
.mt-kpi-value.good { color: var(--good); }
.mt-scroll { overflow-x: auto; }

/* equity parts: one hue, bar length = size of the part */
.mt-parts { display: grid; gap: 9px; }
.mt-part { display: grid; grid-template-columns: minmax(140px, 1.2fr) 2fr auto; gap: 12px; align-items: center; }
.mt-part .bar { height: 10px; border-radius: 0 4px 4px 0; background: var(--s-principal); min-width: 2px; }
.mt-part .bar.neg { background: var(--muted); opacity: 0.6; }
.mt-part .v { font-weight: 600; text-align: right; white-space: nowrap; }
.mt-part.total { border-top: 1px solid var(--border); padding-top: 9px; font-weight: 700; }

.mt-three { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.mt-inline-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; align-items: end; }
.mt-x { border: 0; background: none; color: var(--muted); cursor: pointer; font: inherit; padding: 2px 6px; border-radius: 4px; }
.mt-x:hover { color: var(--bad); background: var(--bad-bg); }
.mt-input.secret:not(:focus) { -webkit-text-security: disc; }
textarea.mt-input { min-height: 90px; resize: vertical; font: inherit; }

/* table */
.mt-table-wrap { overflow: auto; max-height: calc(100vh - 230px); border: 1px solid var(--border); border-radius: 10px; background: var(--card); }
.mt-table { width: 100%; border-collapse: separate; border-spacing: 0; }
.mt-table th { position: sticky; top: 0; background: var(--header); color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; text-align: right; padding: 9px 12px; border-bottom: 1px solid var(--border); z-index: 1; }
.mt-table td { padding: 8px 12px; text-align: right; border-bottom: 1px solid var(--border); white-space: nowrap; }
.mt-table th:first-child, .mt-table td:first-child, .mt-table th.l, .mt-table td.l { text-align: left; }
.mt-table tbody tr { cursor: pointer; }
.mt-table tbody tr:hover td { background: var(--hover); }
.mt-table tr.current td { background: var(--hover); font-weight: 600; }
.mt-table tr.current td:first-child { box-shadow: inset 3px 0 0 var(--primary); }
.mt-table tr.year td { background: var(--header); font-weight: 700; cursor: default; color: var(--muted); font-size: 12px; }
.mt-table td.muted { color: var(--muted); }
.mt-table tr.mt-subrow td { padding-top: 0; text-align: left; background: var(--card); cursor: default; border-bottom: 1px solid var(--border); }
.mt-table tr.mt-subrow:hover td { background: var(--card); }
.mt-table tr.has-sub td { border-bottom: 0; }
.mt-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.mt-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 1px 2px 1px 8px; border-radius: 999px; background: var(--header); color: var(--text); border: 1px solid var(--border); }
.mt-chip .mt-x { padding: 0 6px; }
.mt-plus { border: 1px dashed var(--border); background: none; color: var(--muted); cursor: pointer; font: inherit; font-size: 11px; line-height: 1; padding: 2px 5px; border-radius: 4px; margin-left: 6px; opacity: 0; }
.mt-table tr:hover .mt-plus, .mt-plus:focus { opacity: 1; }
.mt-plus:hover { color: var(--primary); border-color: var(--primary); }
.mt-badge { display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 1px 6px; border-radius: 999px; background: var(--good-bg); color: var(--good); margin-left: 6px; vertical-align: 1px; }

/* reconcile */
.mt-month-nav { display: flex; align-items: center; gap: 10px; }
.mt-month-nav .label { font-size: 18px; font-weight: 700; min-width: 220px; text-align: center; }
.mt-cands { display: grid; gap: 8px; }
.mt-cand { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; text-align: left; font: inherit; color: inherit; background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; cursor: pointer; }
.mt-cand:hover:not(:disabled) { border-color: var(--primary); background: var(--hover); }
.mt-cand:disabled { opacity: 0.5; cursor: default; }
.mt-cand .amt { font-weight: 700; font-size: 15px; text-align: right; }
.mt-cand .meta { color: var(--muted); font-size: 12px; }
.mt-answers { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px; margin-top: 12px; }
.mt-answer { text-align: left; font: inherit; color: inherit; background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px; cursor: pointer; }
.mt-answer:hover:not(:disabled) { border-color: var(--primary); }
.mt-answer:disabled { opacity: 0.45; cursor: not-allowed; }
.mt-answer b { display: block; margin-bottom: 3px; }
.mt-answer small { color: var(--muted); }
.mt-answer.suggested { border-color: var(--primary); }
.mt-kv { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; }
.mt-kv dt { color: var(--muted); }
.mt-kv dd { margin: 0; text-align: right; font-weight: 600; }
.mt-kv dt, .mt-kv dd { padding: 2px 0; }
.mt-empty { text-align: center; color: var(--muted); padding: 28px 12px; }
.mt-diff { font-size: 22px; font-weight: 700; }
/*
 * Actual's privacy mode. Like Actual, draw amounts in its "Redacted Script"
 * font (squiggles) and show the real digits on hover or focus. The font is
 * Actual's own, loaded by its page; if it's ever missing, blur instead.
 */
.mt.privacy.redact .mt-amt:not(:hover), .mt.privacy.redact .mt-chart .axis.amount, .mt.privacy.redact .mt-tip b,
.mt.privacy.redact .mt-secret:not(:focus):not(:hover), .mt.privacy.redact .mt-prefix > .mt-input:not(:focus):not(:hover) {
  font-family: 'Redacted Script', var(--font-family, sans-serif);
}
.mt.privacy:not(.redact) .mt-amt:not(:hover), .mt.privacy:not(.redact) .mt-chart .axis.amount, .mt.privacy:not(.redact) .mt-tip b,
.mt.privacy:not(.redact) .mt-secret:not(:focus):not(:hover), .mt.privacy:not(.redact) .mt-prefix > .mt-input:not(:focus):not(:hover) {
  filter: blur(5px);
}
.mt-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
`;
