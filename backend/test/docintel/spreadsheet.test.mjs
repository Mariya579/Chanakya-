import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import * as fx from './fixtures.mjs';
import { parseDocument } from '../../src/docintel/parser.js';
import {
  aggregate,
  filterRows,
  findDuplicates,
  groupRows,
  idRange,
  lookupValues,
  paginate,
  resolveColumn,
  searchRows,
  sortRows,
} from '../../src/docintel/operations.js';
import { routeDocumentTask, routerContext, parseIdRange } from '../../src/docintel/router.js';
import { columnTypes } from '../../src/docintel/parser.js';

const dir = await fx.tempDir();
const invPath = await fx.inventoryWorkbook(dir);
const inv = await parseDocument(invPath, 'inventory.xlsx');
const sheet = inv.tables.find((t) => t.name === 'Inventory');
const ids = (rows) => rows.map((r) => r.values[0]);

test('multi-sheet discovery: every sheet, header row, row counts and empty sheets', () => {
  assert.deepEqual(
    inv.metadata.sheets.map((s) => [s.name, s.rows, s.empty]),
    [
      ['Inventory', 12, false],
      ['Suppliers', 3, false],
      ['Empty', 0, true],
    ],
  );
  assert.equal(sheet.headerRow, 3, 'title row and blank row are skipped');
  assert.deepEqual(sheet.columns, [
    'Product ID',
    'Name',
    'Category',
    'Stock',
    'Unit Cost',
    'Total Cost',
    'Received',
  ]);
  assert.equal(sheet.rows[0].ref, 4, 'refs are real sheet row numbers');
  assert.equal(sheet.rows.at(-1).ref, 15);
  assert.deepEqual(columnTypes(sheet).slice(3, 7), ['number', 'number', 'number', 'date']);
});

test('P110 to P115 returns every existing matching ID in order — not just the first and last', () => {
  const r = idRange(sheet, { from: 'P110', to: 'P115' });
  assert.deepEqual(ids(r.rows), ['P110', 'P111', 'P113', 'P114', 'P114', 'P115']);
  assert.equal(r.total, 6);
  assert.deepEqual(r.missing, ['P112']);
  assert.equal(r.missingCount, 1);
  assert.deepEqual(r.duplicates, [{ id: 'P114', count: 2 }]);
  assert.equal(r.verified, true);
  assert.deepEqual(
    r.rows.map((x) => x.ref),
    [6, 7, 8, 9, 11, 10],
    'duplicates keep document order; refs are sheet rows',
  );
  assert.equal(r.column, 'Product ID');
});

test('missing and non-contiguous IDs are reported; the requested range is never changed', () => {
  const r = idRange(sheet, { from: 'P111', to: 'P120' });
  assert.deepEqual(ids(r.rows), [
    'P111',
    'P113',
    'P114',
    'P114',
    'P115',
    'P116',
    'P117',
    'P118',
    'P120',
  ]);
  assert.deepEqual(r.missing, ['P112', 'P119']);
  assert.deepEqual(r.requested, { from: 'P111', to: 'P120', count: 10 });
  assert.throws(() => idRange(sheet, { from: 'P115', to: 'P110' }), /starts after it ends/);
  assert.throws(() => idRange(sheet, { from: 'P110', to: 'Q115' }), /different prefixes/);
  const none = idRange(sheet, { from: 'P200', to: 'P205' });
  assert.equal(none.total, 0);
  assert.equal(none.missing.length, 6);
  // "P110 to 115": the second ID inherits the prefix
  assert.equal(idRange(sheet, { from: 'P110', to: '115' }).total, 6);
});

test('zero-padded IDs keep their width in missing IDs', () => {
  const t = {
    name: 'T',
    columns: ['Emp ID', 'Name'],
    rows: ['EMP-007', 'EMP-008', 'EMP-010'].map((v, i) => ({ ref: i + 2, values: [v, `N${i}`] })),
    source: { kind: 'sheet', sheet: 'T' },
  };
  const r = idRange(t, { from: 'EMP-007', to: 'EMP-011' });
  assert.deepEqual(ids(r.rows), ['EMP-007', 'EMP-008', 'EMP-010']);
  assert.deepEqual(r.missing, ['EMP-009', 'EMP-011']);
});

test('exact lookup of an ID list reports values that are not present', () => {
  const r = lookupValues(sheet, ['P120', 'P109', 'P999']);
  assert.deepEqual(ids(r.rows), ['P120', 'P109']);
  assert.deepEqual(r.missing, ['P999']);
});

test('SUM: blanks, invalid text and error cells are reported, never counted as zero', () => {
  const r = aggregate(sheet, sheet.rows, { fn: 'SUM', column: 'Stock' });
  // numbers: 40+15+12+5+60+25+60+8+1200("1,200" text)+18
  assert.equal(r.value, 1443);
  assert.equal(r.included, 10);
  assert.deepEqual(r.blanks, [7]);
  assert.deepEqual(r.invalid, [{ row: 12, value: 'N/A' }]);
  assert.equal(r.textNumbers, 1);
  assert.equal(r.excelValue, 243, "Excel's own SUM ignores the number stored as text");
  assert.equal(r.verified, true);
  assert.equal(r.columnLetter, 'D');
});

test('formula cells: cached results are used and reported; errors and unsaved results are excluded', () => {
  const r = aggregate(sheet, sheet.rows, { fn: 'SUM', column: 'total cost' });
  assert.equal(r.formulaResults, 10);
  assert.deepEqual(r.errors, [{ row: 12, error: '#VALUE!' }]);
  assert.deepEqual(r.uncalculated, [{ row: 13, formula: 'D13*E13' }]);
  // 12800+6750+10800+0+47500+2880+3750+2880+24000+27000
  assert.equal(r.value, 138360);
  assert.ok(
    sheet.rows.find((x) => x.ref === 7).formulas[5],
    'formula text is kept separately from the value',
  );
  assert.equal(sheet.rows.find((x) => x.ref === 7).values[5], 0, 'a saved result of 0 is a real 0');
});

test('SUMIF / COUNTIF / AVERAGEIF with conditions', () => {
  const sumif = aggregate(sheet, sheet.rows, {
    fn: 'SUMIF',
    column: 'Stock',
    criteria: [{ column: 'Category', op: 'eq', value: 'electronics' }],
  });
  assert.equal(sumif.value, 15 + 12 + 5 + 25 + 8 + 18);
  assert.equal(sumif.rowsConsidered, 6);
  const countif = aggregate(sheet, sheet.rows, {
    fn: 'COUNTIF',
    criteria: [{ column: 'Stock', op: 'lt', value: '20' }],
  });
  assert.equal(countif.value, 5);
  assert.equal(countif.conditionSkipped.length, 1, 'the N/A cell is reported as not comparable');
  const avg = aggregate(sheet, sheet.rows, {
    fn: 'AVERAGEIF',
    column: 'Unit Cost',
    criteria: [{ column: 'Category', op: 'eq', value: 'Grocery' }],
  });
  assert.equal(avg.value, (320 + 140 + 48 + 48 + 180 + 20) / 6);
  assert.throws(
    () => aggregate(sheet, sheet.rows, { fn: 'SUMIF', column: 'Stock' }),
    /needs a condition/,
  );
  const mm = aggregate(sheet, sheet.rows, { fn: 'MAX', column: 'Unit Cost' });
  assert.equal(mm.value, 9500);
  assert.deepEqual(mm.at, [8]);
});

test('date filters, text filters, sorting and duplicate detection', () => {
  const dates = filterRows(sheet, sheet.rows, [
    { column: 'Received', op: 'date_between', value: '01/02/2024', value2: '30/04/2024' },
  ]);
  assert.deepEqual(ids(dates.rows), ['P109', 'P110', 'P111', 'P114', 'P116', 'P117']); // second P114 row is dated 10 Feb
  const after = filterRows(sheet, sheet.rows, [
    { column: 'Received', op: 'date_after', value: '2024-06-01' },
  ]);
  assert.deepEqual(ids(after.rows), ['P114', 'P120']);
  const text = filterRows(sheet, sheet.rows, [{ column: 'Name', op: 'contains', value: 'kg' }]);
  assert.equal(text.rows.length, 5);
  const sorted = sortRows(sheet, sheet.rows, [{ column: 'Unit Cost', direction: 'desc' }]);
  assert.deepEqual(ids(sorted).slice(0, 3), ['P113', 'P117', 'P120']);
  const blanksLast = sortRows(sheet, sheet.rows, [{ column: 'Stock', direction: 'asc' }]);
  assert.equal(ids(blanksLast).at(-1), 'P111', 'blank cells sort last');
  // The two P114 rows differ in their Received date, so they are duplicates by ID but not whole-row duplicates.
  assert.equal(findDuplicates(sheet, sheet.rows).groups.length, 0);
  const d = findDuplicates(sheet, sheet.rows, { columns: ['Product ID'] });
  assert.equal(d.groups.length, 1);
  assert.deepEqual(d.groups[0].rows, [9, 11]);
  const exact = { ...sheet, rows: [...sheet.rows, { ref: 99, values: [...sheet.rows[0].values] }] };
  assert.deepEqual(findDuplicates(exact, exact.rows).groups[0].rows, [4, 99]);
  const byCat = findDuplicates(sheet, sheet.rows, { columns: ['Category'] });
  assert.equal(byCat.duplicateRows, 10);
  const search = searchRows(sheet, sheet.rows, 'usb');
  assert.deepEqual(ids(search.rows), ['P115']);
});

test('grouping totals agree with the overall total', () => {
  const g = groupRows(sheet, sheet.rows, {
    by: ['Category'],
    aggregates: [{ fn: 'SUM', column: 'Unit Cost' }],
  });
  const total = aggregate(sheet, sheet.rows, { fn: 'SUM', column: 'Unit Cost' }).value;
  assert.equal(
    g.rows.reduce((s, r) => s + r.values[1], 0),
    total,
  );
  assert.deepEqual(g.columns, ['Category', 'SUM of Unit Cost']);
});

test('ambiguous and unknown columns ask instead of guessing', () => {
  assert.throws(
    () => resolveColumn(sheet, 'cost'),
    (e) => e.code === 'AMBIGUOUS_COLUMN' && e.details.candidates.includes('Unit Cost'),
  );
  assert.throws(
    () => resolveColumn(sheet, 'salary'),
    (e) => e.code === 'COLUMN_NOT_FOUND',
  );
  assert.equal(resolveColumn(sheet, 'column D'), 3);
  assert.equal(resolveColumn(sheet, 'unit cost'), 4);
});

test('large results paginate with the correct total count', async () => {
  const big = await parseDocument(await fx.bigCsv(dir), 'big.csv');
  const t = big.tables[0];
  const r = idRange(t, { from: 'P1000', to: 'P1249' });
  assert.equal(r.total, 250);
  const p1 = paginate(r.rows, { page: 1, pageSize: 50 });
  assert.deepEqual([p1.total, p1.pages, p1.rows.length, p1.from, p1.to], [250, 5, 50, 1, 50]);
  const p5 = paginate(r.rows, { page: 5, pageSize: 50 });
  assert.equal(p5.rows.at(-1).values[0], 'P1249');
  const clamp = paginate(r.rows, { page: 99, pageSize: 100000 });
  assert.equal(clamp.pageSize, 500, 'page size is capped');
  assert.equal(clamp.page, 1);
  const all = aggregate(t, t.rows, { fn: 'SUM', column: 'Amount' });
  assert.equal(all.included, 250, 'calculations always use every row, not a page');
});

test('merged cells: text repeats across the merge, numbers are counted once', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('M');
  ws.addRow(['Region', 'City', 'Sales']);
  ws.addRow(['South', 'Chennai', 100]);
  ws.addRow([null, 'Madurai', 50]);
  ws.addRow(['North', 'Delhi', 70]);
  ws.mergeCells('A2:A3');
  const f = path.join(dir, 'merged.xlsx');
  await wb.xlsx.writeFile(f);
  const doc = await parseDocument(f, 'merged.xlsx');
  const t = doc.tables[0];
  assert.deepEqual(
    t.rows.map((r) => r.values[0]),
    ['South', 'South', 'North'],
  );
  assert.equal(aggregate(t, t.rows, { fn: 'SUM', column: 'Sales' }).value, 220);
  assert.match(t.warnings.join(' '), /merged/);
});

test('router: English and Tanglish prompts become exact, deterministic tasks', () => {
  const ctx = routerContext([{ ...inv, id: 'inv' }], columnTypes);
  const r = (m) => routeDocumentTask(m, ctx);
  assert.deepEqual(r('List out P110 to P115.').ids, { from: 'P110', to: 'P115' });
  assert.deepEqual(r('P110 muthal P115 varai kaattu').ids, { from: 'P110', to: 'P115' });
  const sum = r('Excel-la total cost SUM pannu');
  assert.deepEqual(
    [sum.action, sum.fn, sum.column, sum.output],
    ['aggregate', 'SUM', 'Total Cost', null],
  );
  const f = r('Show products where stock is below 20');
  assert.deepEqual(
    [f.action, f.conditions],
    ['filter', [{ column: 'Stock', op: 'lt', value: '20' }]],
  );
  const t = r('stock 20 ku keezha irukura products kaattu');
  assert.deepEqual(t.conditions, [{ column: 'Stock', op: 'lt', value: '20' }]);
  const g = r('total cost by category');
  assert.deepEqual(
    [g.action, g.by, g.aggregates],
    ['group', ['Category'], [{ fn: 'SUM', column: 'Total Cost' }]],
  );
  const ex = r('List P110 to P115 and export to Excel');
  assert.equal(ex.output, 'xlsx');
  assert.equal(parseIdRange('page 2 to 5'), null, 'page ranges are not ID ranges');
  // ambiguous: two sheets, no column named → a question, not a guess
  assert.equal(r('find duplicates').action, 'clarify');
  assert.equal(r('Filter the Excel rows between two dates').action, 'clarify');
});
