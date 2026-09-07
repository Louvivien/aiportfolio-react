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
