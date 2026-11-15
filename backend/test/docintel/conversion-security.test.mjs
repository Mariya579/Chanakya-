import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import * as fx from './fixtures.mjs';
import { parseDocument } from '../../src/docintel/parser.js';
import { convertDocument, supportedTargets } from '../../src/docintel/conversion.js';
import { verifyOutput } from '../../src/docintel/verify.js';
import { findSoffice } from '../../src/docintel/libreoffice.js';
import {
  assertInside,
  safeFileName,
  validateFile,
  withExtension,
} from '../../src/docintel/formats.js';
import { OriginalStore, ResultStore, JobRegistry } from '../../src/docintel/stores.js';
import { OutputStore } from '../../src/fileagent/outputs.js';
import { writeXlsx } from '../../src/docintel/generation.js';

const dir = await fx.tempDir();
const soffice = findSoffice();
const sha = async (f) =>
  crypto
    .createHash('sha256')
    .update(await fs.readFile(f))
    .digest('hex');
const write = async (name, data) => {
  const f = path.join(dir, name);
  await fs.writeFile(f, data);
  return f;
};
const parse = async (f, name) => {
  const doc = await parseDocument(f, name || path.basename(f));
  doc.original = { path: f };
  return doc;
};

test(
  'DOCX → PDF with the local LibreOffice converter; output re-opened and checked',
  { skip: !soffice && 'LibreOffice is not installed' },
  async () => {
    const f = await fx.sampleDocx(dir);
    const before = await sha(f);
    const doc = await parse(f);
    const [out] = await convertDocument({ doc, target: 'pdf', original: doc.original, soffice });
    assert.equal(out.ext, 'pdf');
    assert.equal(out.name, 'policy.pdf');
    const v = await verifyOutput(out.buffer, 'pdf', out.expectations);
    assert.equal(v.ok, true, JSON.stringify(v.checks));
    const pdf = await parse(await write('policy-out.pdf', out.buffer));
    assert.match(pdf.text, /reporting manager/);
    assert.equal(await sha(f), before, 'the source file is unchanged');
  },
);

test('DOCX → PDF without any converter fails clearly instead of renaming the file', async () => {
  const doc = await parse(await fx.sampleDocx(dir, 'no-conv.docx'));
  await assert.rejects(
    convertDocument({
      doc,
      target: 'pdf',
      original: doc.original,
      soffice: null,
      pdfOptions: { browser: null, soffice: null },
    }),
    (e) => e.code === 'CONVERTER_MISSING',
  );
});

test('practical conversions produce verified files with the right extension and content', async () => {
  const inv = await parse(await fx.inventoryWorkbook(dir));
  const csvs = await convertDocument({ doc: inv, target: 'csv' });
  assert.deepEqual(
    csvs.map((o) => o.name),
    ['inventory-Inventory.csv', 'inventory-Suppliers.csv'],
  );
  for (const o of csvs)
    assert.equal((await verifyOutput(o.buffer, 'csv', o.expectations)).ok, true);
  const [json] = await convertDocument({ doc: inv, target: 'json' });
  const data = JSON.parse(json.buffer.toString('utf8'));
  assert.equal(data.Inventory.length, 12);
  assert.equal(data.Inventory[2]['Product ID'], 'P110');

  const big = await parse(await fx.bigCsv(dir));
  const [xlsx] = await convertDocument({ doc: big, target: 'xlsx' });
  const v = await verifyOutput(xlsx.buffer, 'xlsx', xlsx.expectations);
  assert.equal(v.ok, true, JSON.stringify(v.checks));
  const back = await parse(await write('big-back.xlsx', xlsx.buffer));
  assert.equal(back.tables[0].rows.length, 250);
  assert.equal(back.tables[0].rows[0].values[2], 5, 'numbers become real numbers in Excel');

  const pdf = await parse(
    await write(
      'r.pdf',
      fx.makePdf([
        ['Annual summary for 2024', 'Profit rose sharply'],
        ['Second page content here'],
      ]),
    ),
  );
  const [txt] = await convertDocument({ doc: pdf, target: 'txt' });
  assert.match(txt.buffer.toString('utf8'), /--- Page 2 ---\nSecond page content here/);
  const [docx] = await convertDocument({ doc: pdf, target: 'docx' });
  assert.ok(
    docx.notes.some((n) => /not reproduced exactly/.test(n)),
    'PDF → Word reports layout loss',
  );
  assert.equal((await verifyOutput(docx.buffer, 'docx', docx.expectations)).ok, true);

  const word = await parse(await fx.sampleDocx(dir, 'html.docx'));
  const [html] = await convertDocument({ doc: word, target: 'html' });
  assert.match(html.buffer.toString('utf8'), /<table>[\s\S]*Allowance/);
});

test('unsupported conversions and same-format requests are rejected with the supported list', async () => {
  const txt = await parse(await write('notes.txt', 'Meeting notes\n\nAction items follow.'));
  await assert.rejects(
    convertDocument({ doc: txt, target: 'xlsx' }),
    (e) => e.code === 'UNSUPPORTED_CONVERSION' && /Supported targets/.test(e.message),
  );
  await assert.rejects(
    convertDocument({ doc: txt, target: 'txt' }),
    (e) => e.code === 'SAME_FORMAT',
  );
  const pdf = await parse(await write('t.pdf', fx.makePdf([['no tables here at all']])));
  await assert.rejects(
    convertDocument({ doc: pdf, target: 'xlsx' }),
    (e) => e.code === 'NO_TABLES',
  );
  assert.ok(supportedTargets('.pdf').includes('docx'));
  assert.ok(!supportedTargets('.txt').includes('xlsx'));
});

test('corrupt, empty, renamed and unsupported inputs fail with clear codes', async () => {
  const cases = [
    ['random.xlsx', crypto.randomBytes(2048), 'TYPE_MISMATCH'],
    [
      'truncated.docx',
      Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), crypto.randomBytes(500)]),
      'CORRUPT_FILE',
    ],
    ['fake.pdf', Buffer.from('this is not a pdf'), 'TYPE_MISMATCH'],
    ['broken.pdf', Buffer.from('%PDF-1.4\n1 0 obj garbage'), 'CORRUPT_FILE'],
    ['empty.csv', Buffer.alloc(0), 'EMPTY_FILE'],
    ['blank.txt', Buffer.from('   \n\n  '), 'EMPTY_DOCUMENT'],
    ['bad.json', Buffer.from('{"a": [1,'), 'CORRUPT_FILE'],
    ['binary.csv', Buffer.from([0x41, 0x00, 0x42]), 'TYPE_MISMATCH'],
    ['program.exe', Buffer.from('MZ...'), 'UNSUPPORTED_FORMAT'],
  ];
  for (const [name, data, code] of cases) {
    const f = await write(name, data);
    await assert.rejects(
      parseDocument(f, name),
      (e) => e.code === code || assert.fail(`${name}: ${e.code} ${e.message}`),
      name,
    );
  }
  // an .exe renamed to .docx
  const renamed = await write('invoice.docx', Buffer.from('MZ\x90\x00 PE executable'));
  await assert.rejects(parseDocument(renamed, 'invoice.docx'), (e) => e.code === 'TYPE_MISMATCH');
  // MIME label that contradicts the extension
  const okDocx = await fx.sampleDocx(dir, 'mime.docx');
  await assert.rejects(
    validateFile(okDocx, 'mime.docx', { mime: 'application/x-msdownload' }),
    (e) => e.code === 'TYPE_MISMATCH',
  );
});

test('zip bombs and unsafe archive paths are refused before decompression', async () => {
  const bomb = await fx.zipBomb(dir);
  await assert.rejects(parseDocument(bomb, 'bomb.docx'), (e) => e.code === 'UNSAFE_ARCHIVE');
  const JSZip = (await import('jszip')).default;
  const z = new JSZip();
  z.file('[Content_Types].xml', '<Types/>');
  z.file('word/document.xml', '<w:document/>');
  z.file('../../evil.txt', 'x');
  const evil = await write('evil.docx', await z.generateAsync({ type: 'nodebuffer' }));
  await assert.rejects(parseDocument(evil, 'evil.docx'), (e) => e.code === 'UNSAFE_ARCHIVE');
});

test('macros and external links are flagged and never run', async () => {
  const JSZip = (await import('jszip')).default;
  const inv = await fs.readFile(await fx.inventoryWorkbook(dir));
  const z = await JSZip.loadAsync(inv);
  z.file('xl/vbaProject.bin', Buffer.from('fake macro'));
  z.file('xl/externalLinks/externalLink1.xml', '<externalLink/>');
  const f = await write('macro.xlsm', await z.generateAsync({ type: 'nodebuffer' }));
  const doc = await parseDocument(f, 'macro.xlsm');
  assert.match(doc.warnings.join(' '), /macros\. Macros are never run/);
  assert.match(doc.warnings.join(' '), /External links are not followed/);
  assert.equal(doc.tables[0].rows.length, 12);
});

test('generated files: existence, extension, integrity and content are verified; bad files fail', async () => {
  const { buffer, totals } = await writeXlsx({
    sheets: [
      {
        name: 'Data',
        columns: ['Item', 'Amount'],
        rows: [
          ['A', 10],
          ['B', 32.5],
        ],
        totals: ['Amount'],
      },
    ],
  });
  assert.deepEqual(totals, [
    { sheet: 'Data', column: 'Amount', cell: 'B4', value: 42.5, counted: 2 },
  ]);
  const good = await verifyOutput(buffer, 'xlsx', {
    sheets: [{ rows: 2, columns: ['Item', 'Amount'] }],
    totals: [{ cell: 'B4', value: 42.5 }],
  });
  assert.equal(good.ok, true, JSON.stringify(good.checks));
  const wrongTotal = await verifyOutput(buffer, 'xlsx', { totals: [{ cell: 'B4', value: 99 }] });
  assert.equal(wrongTotal.ok, false);
  const wrongRows = await verifyOutput(buffer, 'xlsx', { sheets: [{ rows: 3 }] });
  assert.equal(wrongRows.ok, false);
  assert.equal((await verifyOutput(Buffer.alloc(0), 'pdf')).ok, false);
  assert.equal((await verifyOutput(Buffer.from('%PDF-1.4 truncated'), 'pdf')).ok, false);
  assert.equal((await verifyOutput(Buffer.from('not a zip'), 'docx')).ok, false);
  const missingText = await verifyOutput(Buffer.from('hello world'), 'txt', {
    contains: ['goodbye'],
  });
  assert.equal(missingText.ok, false);
});

test('path traversal and unsafe names are neutralised', () => {
  assert.equal(safeFileName('..\\..\\Windows\\system32\\evil.docx'), 'evil.docx');
  assert.equal(safeFileName('../../etc/passwd'), 'passwd');
  assert.equal(safeFileName('CON.txt'), '_CON.txt');
  assert.equal(safeFileName('a<b>c:"d|e?.pdf'), 'a_b_c__d_e_.pdf');
  assert.equal(safeFileName('...hidden'), 'hidden');
  assert.equal(withExtension('report.final.pdf', 'docx'), 'report.final.docx');
  assert.equal(withExtension('../x/../../y.txt', 'pdf'), 'y.pdf');
  const root = path.join(dir, 'root');
  assert.throws(
    () => assertInside(root, '../escape.txt'),
    (e) => e.code === 'UNSAFE_PATH',
  );
  assert.throws(
    () => assertInside(root, path.resolve('/etc/passwd')),
    (e) => e.code === 'UNSAFE_PATH',
  );
  assert.equal(assertInside(root, 'a/b.txt'), path.join(root, 'a', 'b.txt'));
});

test('stores are owner-scoped; originals are read-only copies; retention removes old entries', async () => {
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  const docId = crypto.randomUUID();
  const store = new OriginalStore(path.join(dir, 'originals'));
  const src = await fx.sampleDocx(dir, 'orig.docx');
  await store.keepCopy(userA, docId, src, { name: 'orig.docx' });
  const mine = await store.get(userA, docId);
  assert.ok(mine);
  assert.equal(await store.get(userB, docId), null, 'another user cannot read it');
  assert.equal(
    (await fs.stat(mine.path)).mode & 0o222,
    0,
    'the stored copy is read-only (read-only attribute on Windows)',
  );
  assert.equal(await store.get(userA, '../../etc'), null, 'ids must be UUIDs');
  assert.equal(await store.remove(userB, docId), false);
  assert.equal(await store.cleanup(Date.now() + 8 * 864e5), 1, 'attachments expire after 7 days');
  assert.equal(await store.get(userA, docId), null);

  const outputs = new OutputStore(path.join(dir, 'outputs'));
  const saved = await outputs.save(userA, '../../x.pdf', Buffer.from('%PDF'), 'application/pdf');
  assert.equal(saved.name, 'x.pdf');
  assert.ok(await outputs.get(userA, saved.id));
  assert.equal(await outputs.get(userB, saved.id), null);

  const results = new ResultStore();
  const rid = results.put(userA, { rows: [] });
  assert.ok(results.get(userA, rid));
  assert.equal(results.get(userB, rid), null);
});

test('jobs report progress, can be cancelled, and are owner-scoped', async () => {
  const jobs = new JobRegistry({ maxActivePerUser: 1 });
  const u = crypto.randomUUID();
  let release;
  const job = jobs.start(u, 'convert', ({ signal, progress }) => {
    progress(40, 'Converting');
    return new Promise((resolve, reject) => {
      release = resolve;
      signal.addEventListener('abort', () => reject(signal.reason));
    });
  });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(jobs.view(job).progress, { percent: 40, message: 'Converting' });
  assert.throws(
    () => jobs.start(u, 'x', async () => {}),
    (e) => e.code === 'BUSY',
  );
  assert.equal(jobs.get(crypto.randomUUID(), job.id), null);
  jobs.cancel(u, job.id);
  assert.equal(jobs.view(job).status, 'cancelled');
  release?.('late result');
  await new Promise((r) => setImmediate(r));
  assert.equal(
    jobs.view(job).status,
    'cancelled',
    'a late result does not resurrect a cancelled job',
  );
  assert.equal(jobs.view(job).result, null);
});
