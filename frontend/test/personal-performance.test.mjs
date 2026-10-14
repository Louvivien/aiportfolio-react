import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from '../node_modules/typescript/lib/typescript.js';
const require = createRequire(new URL('../package.json', import.meta.url));
const React = require('react');
const renderer = require('react-test-renderer');
const { renderToStaticMarkup } = require('react-dom/server');
const stub = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const moduleUrl = async (file, imports = {}) => {
  const source = await fs.readFile(new URL(file, import.meta.url), 'utf8');
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const [specifier, url] of Object.entries({ react: pathToFileURL(require.resolve('react')).href,
    'react/jsx-runtime': pathToFileURL(require.resolve('react/jsx-runtime')).href, ...imports }))
    code = code.replaceAll(`from "${specifier}"`, `from "${url}"`);
  return stub(code);
};
const format = await moduleUrl('../src/utils/format.ts');
const { Performance2026Result, default: Panel } = await import(await moduleUrl('../src/components/Performance2026Badge.tsx', {
  '../utils/format': format,
  '../api/client': stub('export const fetchPersonalPerformance2026 = () => globalThis.__performanceApi();'),
}));
const fixture = { status: 'incomplete', as_of: '2026-10-14', effective_return_pct: null, net_gain_eur: null,
  missing: ['Liquidités manquantes'], opening: { known_value_eur: 14340.08, complete: false, cash_eur: null },
  current: { known_value_eur: 20000, complete: true, cash_eur: null },
  flows: { personal_deposits_eur: 6292, withdrawals_eur: 1117.07, promotions_eur: 101, net_capital_eur: 5275.93, movements: [] },
  methodology: 'XIRR consolidé en EUR' };

test('incomplete global performance does not render a plausible percentage or gain', () => {
  const html = renderToStaticMarkup(React.createElement(Performance2026Result, { report: { ...fixture, effective_return_pct: 13, net_gain_eur: 3000 } }));
  assert.match(html, /Performance 2026/); assert.match(html, /—/); assert.doesNotMatch(html, /Incomplet/);
  assert.doesNotMatch(html, /Liquidités manquantes/); assert.doesNotMatch(html, /13\.00%|3,000\.00/);
});

test('complete performance shows the effective rate and separate gain, without account breakdown', () => {
  const html = renderToStaticMarkup(React.createElement(Performance2026Result, { report: { ...fixture, status: 'complete', missing: [], effective_return_pct: 7.25, annualized_xirr: 0.13, net_gain_eur: 1200 } }));
  assert.match(html, /7\.25%/); assert.match(html, /1,200\.00/); assert.doesNotMatch(html, /13\.00%|Trade Republic|DEGIRO/);
  assert.match(html, /\+€1,200\.00/);
});

test('a failed request stays neutral and an older response cannot overwrite a newer revision', async () => {
  let pending;
  globalThis.__performanceApi = () => new Promise((resolve) => { pending = resolve; });
  let view;
  await renderer.act(async () => { view = renderer.create(React.createElement(Panel, { revision: 'old' })); });
  const old = pending;
  globalThis.__performanceApi = async () => { throw new Error('network'); };
  await renderer.act(async () => { view.update(React.createElement(Panel, { revision: 'failed' })); });
  assert.match(JSON.stringify(view.toJSON()), /—/);
  globalThis.__performanceApi = async () => ({ ...fixture, status: 'complete', effective_return_pct: 4.7, net_gain_eur: 840.64 });
  await renderer.act(async () => { view.update(React.createElement(Panel, { revision: 'new' })); });
  await renderer.act(async () => old({ ...fixture, status: 'complete', effective_return_pct: 99, net_gain_eur: 99999 }));
  assert.match(JSON.stringify(view.toJSON()), /4\.70%/); assert.doesNotMatch(JSON.stringify(view.toJSON()), /99\.00%/);
  await renderer.act(async () => view.unmount());
});

test('calculated performance uses a single original-style badge with no additional labels or panel', () => {
  const html = renderToStaticMarkup(React.createElement(Performance2026Result, { report: {
    ...fixture, missing: ['Dates de crédit à confirmer'],
    indicative: { effective_return_pct: 4.7, net_gain_eur: 840.64, annualized_xirr: 0.0604,
      assumptions: ['Dates de crédit à confirmer'] },
  } }));
  assert.match(html, /^<span class="badge"/); assert.match(html, /#34a853/);
  assert.match(html, /Performance 2026: .*840\.64.*4\.70%/);
  assert.doesNotMatch(html, /Indicatif|Incomplet|Partial|6\.04%|details|card|Hypothèses|Dates de crédit/);
});

test('2026 badge occupies the former 1Y slot inside the existing totals card', async () => {
  const { TotalsPanel } = await import(await moduleUrl('../src/components/TotalsPanel.tsx', { '../utils/format': format }));
  const portfolio = await import(await moduleUrl('../src/utils/portfolio.ts'));
  const { totals } = portfolio.buildPortfolioView([]);
  const badge = React.createElement(Performance2026Result, { report: { ...fixture, status: 'complete', effective_return_pct: 4.7, net_gain_eur: 840.64 } });
  const html = renderToStaticMarkup(React.createElement(TotalsPanel, { totals }, badge));
  assert.equal((html.match(/class="card"/g) ?? []).length, 1);
  assert.equal((html.match(/class="badge"/g) ?? []).length, 3);
  assert.match(html, /Today P\/L:.*10D P\/L:.*Performance 2026:/s);
  assert.doesNotMatch(html, /1Y P\/L:|Indicatif/);
});

test('the badge refreshes changed cash/flows without a position edit and discards obsolete requests', async () => {
  const originalWindow = globalThis.window;
  const listeners = new Map();
  let tick, cleared = false, view;
  globalThis.window = {
    setInterval: (callback, delay) => { assert.equal(delay, 60000); tick = callback; return 7; },
    clearInterval: (id) => { assert.equal(id, 7); cleared = true; },
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name) => listeners.delete(name),
  };
  try {
    globalThis.__performanceApi = async () => ({ ...fixture, status: 'complete', effective_return_pct: 5, net_gain_eur: 500 });
    await renderer.act(async () => { view = renderer.create(React.createElement(Panel, { revision: 'same-positions' })); });
    let obsolete;
    globalThis.__performanceApi = () => new Promise((resolve) => { obsolete = resolve; });
    await renderer.act(async () => tick());
    globalThis.__performanceApi = async () => ({ ...fixture, status: 'complete', effective_return_pct: 6, net_gain_eur: 600 });
    await renderer.act(async () => listeners.get('focus')());
    await renderer.act(async () => obsolete({ ...fixture, status: 'complete', effective_return_pct: 99, net_gain_eur: 999 }));
    assert.match(JSON.stringify(view.toJSON()), /6\.00%/);
    assert.doesNotMatch(JSON.stringify(view.toJSON()), /99\.00%/);
    await renderer.act(async () => view.unmount());
    assert.equal(cleared, true); assert.equal(listeners.size, 0);
  } finally {
    if (view) await renderer.act(async () => view.unmount());
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
  }
});
