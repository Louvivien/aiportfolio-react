import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from '../node_modules/typescript/lib/typescript.js';
const require = createRequire(new URL('../package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const moduleUrl = async (file, imports = {}) => {
  const source = await fs.readFile(new URL(file, import.meta.url), 'utf8');
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const [specifier, url] of Object.entries({ react: pathToFileURL(require.resolve('react')).href,
    'react/jsx-runtime': pathToFileURL(require.resolve('react/jsx-runtime')).href, ...imports })) {
    code = code.replaceAll(`from "${specifier}"`, `from "${url}"`);
  }
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
};
const format = await moduleUrl('../src/utils/format.ts');
const portfolio = await moduleUrl('../src/utils/portfolio.ts');
const colors = await moduleUrl('../src/utils/colors.ts');
const { TotalsPanel } = await import(await moduleUrl('../src/components/TotalsPanel.tsx', { '../utils/format': format }));
const { TagSummary } = await import(await moduleUrl('../src/components/TagSummary.tsx', { '../utils/format': format, '../utils/portfolio': portfolio, '../utils/colors': colors }));
const { buildPortfolioView } = await import(portfolio);

test('totals visibly identify partial numbers and name the incomplete records', () => {
  const { totals } = buildPortfolioView([{ symbol: 'UNDATED', tags: [] }]);
  totals.plVsInvestAll = 123;
  const html = renderToStaticMarkup(React.createElement(TotalsPanel, { totals }));
  assert.match(html, /€123/);
  assert.match(html, /Partial/);
  assert.match(html, /UNDATED: Valuation unavailable/);
  assert.match(html, /Unavailable/);
  assert.match(html, /#64748b/); // Missing performance must not look positive.
});
test('first tag table renders only tags with a positive known holding value', () => {
  const rows = [0, null, 100].map((value, index) => ({ tag: ['ClosedOnly', 'MissingValue', 'Active'][index], total_market_value: value,
    total_quantity: 1, total_unrealized_pl: 0, intraday_change_pct: null, change_10d_pct: null, change_1y_pct: null }));
  const html = renderToStaticMarkup(React.createElement(TagSummary, { rows, activeFilter: null, onFilter() {}, onOpenTimeseries() {}, totalMarketValueOpen: 100 }));
  assert.match(html, /Active/);
  assert.doesNotMatch(html, /ClosedOnly|MissingValue/);
});

const apiStub = `data:text/javascript;base64,${Buffer.from(`
export const fetchMonthlyReports = (...args) => globalThis.__monthlyApi.list(...args);
export const fetchMonthlyReport = (...args) => globalThis.__monthlyApi.get(...args);
export const regenerateMonthlyReport = (...args) => globalThis.__monthlyApi.regenerate(...args);
`).toString('base64')}`;
const chartsStub = `data:text/javascript;base64,${Buffer.from('export const Bar=()=>null,BarChart=()=>null,Cell=()=>null,ReferenceLine=()=>null,ResponsiveContainer=()=>null,Tooltip=()=>null,XAxis=()=>null,YAxis=()=>null;').toString('base64')}`;
const { MonthlyReportsPanel } = await import(await moduleUrl('../src/components/MonthlyReportsPanel.tsx', {
  '../api/client': apiStub, '../utils/format': format, '../utils/colors': colors, recharts: chartsStub,
}));
const renderer = require('react-test-renderer');
const reportFixture = (month, gain) => ({ month, period_start: `${month}-01`, period_end: `${month}-28`, generated_at: '2026-09-07',
  summary: { start_value: 1000, end_value: 1000 + gain, performance_value: gain, performance_pct: gain / 10, positions_count: 0, positions_skipped: 0 },
  tags: [], positions: [], skipped_positions: [],
});
test('failed monthly request exits loading state and offers a working retry', async () => {
  let attempt = 0;
  globalThis.__monthlyApi = { list: async () => ({ reports: [{ month: '2026-08' }] }),
    get: async () => { if (++attempt === 1) throw new Error('Request timed out'); return reportFixture('2026-08', 42); } };
  let view;
  await renderer.act(async () => { view = renderer.create(React.createElement(MonthlyReportsPanel)); });
  let text = JSON.stringify(view.toJSON());
  assert.match(text, /Report could not be loaded/);
  assert.doesNotMatch(text, /Loading report…/);
  const retry = view.root.findAllByType('button').find((b) => b.children.includes('Retry'));
  await renderer.act(async () => { retry.props.onClick(); });
  assert.match(JSON.stringify(view.toJSON()), /42\.00/);
  await renderer.act(async () => view.unmount());
});
test('switching months ignores an older request that finishes last', async () => {
  const pending = {};
  globalThis.__monthlyApi = { list: async () => ({ reports: [{ month: '2026-08' }, { month: '2026-06' }] }),
    get: (month) => new Promise((resolve) => { pending[month] = resolve; }) };
  let view;
  await renderer.act(async () => { view = renderer.create(React.createElement(MonthlyReportsPanel)); });
  await renderer.act(async () => { view.root.findByType('select').props.onChange({ target: { value: '2026-06' } }); });
  await renderer.act(async () => { pending['2026-06'](reportFixture('2026-06', 202)); });
  await renderer.act(async () => { pending['2026-08'](reportFixture('2026-08', 101)); });
  assert.match(JSON.stringify(view.toJSON()), /202\.00/);
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /101\.00/);
  await renderer.act(async () => view.unmount());
});
test('monthly report shows available totals and names a security missing history', async () => {
  const report = reportFixture('2026-08', 42);
  report.summary.coverage = { ...report.summary };
  Object.assign(report.summary, { incomplete: true, start_value: null, end_value: null, performance_value: null, performance_pct: null });
  report.skipped_positions = [{ symbol: 'URNU.DE', incomplete: true, reason: 'Missing boundary or sale price.' }];
  globalThis.__monthlyApi = { list: async () => ({ reports: [{ month: '2026-08' }] }), get: async () => report };
  let view;
  await renderer.act(async () => { view = renderer.create(React.createElement(MonthlyReportsPanel)); });
  const text = JSON.stringify(view.toJSON());
  assert.match(text, /42\.00/);
  assert.match(text, /Partial report/);
  assert.match(text, /URNU.DE/);
  await renderer.act(async () => view.unmount());
});
