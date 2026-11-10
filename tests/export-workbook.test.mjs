import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { buildMonthlyWorkbook, monthlyExportFileName } from '../src/exportWorkbook.js';

const entry = (lorryId, overrides = {}) => ({ date: '2026-10-01', loriId: lorryId, timeRange: '0800-1700', rest: 1, hours: 8, total: 640, ...overrides });

test('invalid, long, and colliding lorry IDs produce a readable workbook with original IDs retained', () => {
  const ids = ['LD/2', 'LD:2', 'ld-2', 'x'.repeat(40), 'X'.repeat(40)];
  const site = { name: 'Test Site', rate: 80, entries: ids.map((id) => entry(id)) };
  const workbook = buildMonthlyWorkbook(site, '2026-10');
  assert.equal(workbook.SheetNames.length, ids.length);
  assert.equal(new Set(workbook.SheetNames.map((name) => name.toLowerCase())).size, ids.length);
  workbook.SheetNames.forEach((name) => assert.ok(name.length <= 31));
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const restored = XLSX.read(bytes);
  const retainedIds = restored.SheetNames.map((name) => restored.Sheets[name].A4.v);
  ids.forEach((id) => assert.ok(retainedIds.includes(`LORI ID: ${id}`)));
});

test('export is limited to the selected month and totals match recorded ledger fees', () => {
  const site = { name: 'Test Site', rate: 999, entries: [entry('LD'), entry('LD', { date: '2026-09-01', total: 9999 })] };
  const workbook = buildMonthlyWorkbook(site, '2026-10');
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.LD, { header: 1 });
  assert.equal(rows.find((row) => row[0] === 'TOTAL FEE')[4], 'RM 640.00');
  assert.equal(rows.find((row) => row[0] === 'TOTAL HOURS')[4], '8.0');
});

test('empty months have an explicit error and filenames exclude OS-reserved characters', () => {
  assert.throws(() => buildMonthlyWorkbook({ name: 'Test', entries: [] }, '2026-10'), /no saved entries/);
  assert.equal(monthlyExportFileName('Site/West:1', '2026-10'), 'Site-West-1_2026-10.xlsx');
});

test('combined layout stacks each lorry on one tab with its own totals and no empty days', () => {
  const site = { name: 'Test Site', entries: [entry('LD2', { total: 320, hours: 4 }), entry('LD', { total: 640 })] };
  const workbook = buildMonthlyWorkbook(site, '2026-10', { exportLayout: 'combined', includeEmptyDays: false, companyName: 'ACME' });
  assert.deepEqual(workbook.SheetNames, ['All Lorries']);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['All Lorries'], { header: 1 });
  assert.equal(rows.filter((row) => row[0] === 'LORI ID: LD').length, 1);
  assert.equal(rows.filter((row) => row[0] === 'LORI ID: LD2').length, 1);
  assert.deepEqual(rows.filter((row) => row[0] === 'TOTAL FEE').map((row) => row[4]), ['RM 640.00', 'RM 320.00']);
  assert.equal(rows.filter((row) => row[0] === 1).length, 2);
  assert.equal(rows.some((row) => row[0] === 2), false);
  assert.equal(rows[0][0], 'ACME');
});

test('summary stays on the combined tab or gets its own tab with separate lorries', () => {
  const site = { name: 'Test Site', entries: [entry('LD'), entry('LD2', { total: 320, hours: 4 })] };
  const combined = buildMonthlyWorkbook(site, '2026-10', { exportLayout: 'combined', includeSummary: true });
  assert.deepEqual(combined.SheetNames, ['All Lorries']);
  const combinedRows = XLSX.utils.sheet_to_json(combined.Sheets['All Lorries'], { header: 1 });
  assert.deepEqual(combinedRows.find((row) => row[0] === 'GRAND TOTAL'), ['GRAND TOTAL', 12, 960]);
  const separate = buildMonthlyWorkbook(site, '2026-10', { includeSummary: true });
  assert.deepEqual(separate.SheetNames, ['Summary', 'LD', 'LD2']);
});

test('summary worksheet does not collide with a lorry named Summary', () => {
  const site = { name: 'Test Site', entries: [entry('Summary')] };
  const workbook = buildMonthlyWorkbook(site, '2026-10', { includeSummary: true });
  assert.deepEqual(workbook.SheetNames, ['Summary', 'Summary (2)']);
  assert.equal(workbook.Sheets['Summary (2)'].A4.v, 'LORI ID: Summary');
});
