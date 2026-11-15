import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { toDocx } from '../../src/fileagent/documents.js';

/** Deterministic fixtures for the Document Intelligence tests (built at test time). */

export async function tempDir(prefix = 'docintel-test-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/**
 * inventory.xlsx
 *   Inventory: title row, blank row, header on row 3, data rows 4..15
 *     IDs P108..P120 without P112 (missing) — P114 appears twice (duplicate)
 *     Stock: one blank (P111), one "N/A" (P116), one "1,200" text number (P118)
 *     Total Cost: formulas =D*E with cached results; one formula without saved result (P119)
 *   Suppliers: 3 rows; Empty: no data
 */
export async function inventoryWorkbook(dir) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Inventory');
  ws.addRow(['Inventory report 2024']);
  ws.addRow([]);
  ws.addRow(['Product ID', 'Name', 'Category', 'Stock', 'Unit Cost', 'Total Cost', 'Received']);
  const items = [
    ['P108', 'Rice 5kg', 'Grocery', 40, 320],
    ['P109', 'Mouse', 'Electronics', 15, 450],
    ['P110', 'Keyboard', 'Electronics', 12, 900],
    ['P111', 'Dal 1kg', 'Grocery', null, 140],
    ['P113', 'Monitor', 'Electronics', 5, 9500],
    ['P114', 'Sugar 1kg', 'Grocery', 60, 48],
    ['P115', 'USB Cable', 'Electronics', 25, 150],
    ['P114', 'Sugar 1kg', 'Grocery', 60, 48],
    ['P116', 'Oil 1L', 'Grocery', 'N/A', 180],
    ['P117', 'Webcam', 'Electronics', 8, 2100],
    ['P118', 'Salt 1kg', 'Grocery', '1,200', 20],
    ['P120', 'Headset', 'Electronics', 18, 1500],
  ];
  items.forEach((it, i) => {
    const r = ws.addRow([...it, null, new Date(Date.UTC(2024, i % 6, 3 + i))]);
    const stock =
      typeof it[3] === 'number'
        ? it[3]
        : typeof it[3] === 'string' && /^[\d,]+$/.test(it[3])
          ? Number(it[3].replace(/,/g, ''))
          : null;
    r.getCell(6).value =
      stock === null
        ? { formula: `D${r.number}*E${r.number}`, result: 0 }
        : { formula: `D${r.number}*E${r.number}`, result: stock * it[4] };
  });
  // P111 has a blank stock: cached result 0 is what Excel would show; P116 'N/A' → #VALUE!
  ws.getCell('F12').value = { formula: 'D12*E12', result: { error: '#VALUE!' } };
  // P119 is not in the list; make P117's total an unsaved formula result
  ws.getCell('F13').value = { formula: 'D13*E13' };
  const s = wb.addWorksheet('Suppliers');
  s.addRow(['Supplier', 'City', 'Rating']);
  s.addRow(['Arun Traders', 'Chennai', 4]);
  s.addRow(['Kavi Stores', 'Madurai', 5]);
  s.addRow(['Mega Supply', 'Chennai', 3]);
  wb.addWorksheet('Empty');
  const file = path.join(dir, 'inventory.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

/** 250 rows P1000..P1249 for pagination. */
export async function bigCsv(dir) {
  const lines = ['ID,Region,Amount'];
  for (let i = 0; i < 250; i++)
    lines.push(`P${1000 + i},${['North', 'South', 'East'][i % 3]},${(i % 7) * 10 + 5}`);
  const file = path.join(dir, 'big.csv');
  await fs.writeFile(file, lines.join('\r\n') + '\r\n');
  return file;
}

export async function sampleDocx(dir, name = 'policy.docx', variant = 0) {
  const blocks = [
    { type: 'heading', level: 1, text: 'Scope' },
    {
      type: 'paragraph',
      text: `This policy applies to all employees of Chanakya Traders from April ${variant ? 2025 : 2024}.`,
    },
    { type: 'heading', level: 1, text: 'Leave Rules' },
    {
      type: 'bullets',
      items: ['Casual leave: 12 days per year', `Sick leave: ${variant ? 10 : 8} days per year`],
    },
    {
      type: 'table',
      columns: ['Grade', 'Allowance'],
      rows: [
        ['A', '5000'],
        ['B', variant ? '4000' : '3500'],
      ],
    },
    { type: 'heading', level: 1, text: 'Approval' },
    { type: 'paragraph', text: 'Leave must be approved by the reporting manager in writing.' },
  ];
  const file = path.join(dir, name);
  await fs.writeFile(file, toDocx({ title: 'Leave Policy', blocks }));
  return file;
}

const pdfEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Minimal valid text PDF: pages = [[line, line, ...], ...] (Helvetica, one text line per row). */
export function makePdf(pages) {
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;
  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
  add('PAGES');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (const lines of pages) {
    const content = `BT /F1 12 Tf 72 760 Td 16 TL ${lines.map((l) => `(${pdfEsc(l)}) Tj T*`).join(' ')} ET`;
    const c = add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`,
      ),
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Image-only PDF with one JPEG per page (what a scanner produces). */
export function makeScannedPdf(jpegs) {
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;
  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
  add('PAGES');
  const kids = [];
  const binary = [];
  for (const { data, width, height } of jpegs) {
    const img = add({
      head: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode /Length ${data.length} >>\nstream\n`,
      data,
      tail: '\nendstream',
    });
    binary.push(img);
    const content = `q ${width} 0 0 ${height} 0 0 cm /Im1 Do Q`;
    const c = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im1 ${img} 0 R >> >> /Contents ${c} 0 R >>`,
      ),
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const chunks = [Buffer.from('%PDF-1.4\n', 'latin1')];
  let size = chunks[0].length;
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(size);
    const parts =
      typeof o === 'string'
        ? [Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1')]
        : [
            Buffer.from(`${i + 1} 0 obj\n${o.head}`, 'latin1'),
            o.data,
            Buffer.from(`${o.tail}\nendobj\n`, 'latin1'),
          ];
    for (const p of parts) {
      chunks.push(p);
      size += p.length;
    }
  });
  const tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${size}\n%%EOF\n`;
  chunks.push(Buffer.from(tail, 'latin1'));
  return Buffer.concat(chunks);
}

/** DOCX-looking zip whose single entry expands ~1000×. */
export async function zipBomb(dir) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', Buffer.alloc(8 * 1024 * 1024, 0x41));
  const file = path.join(dir, 'bomb.docx');
  await fs.writeFile(
    file,
    await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    }),
  );
  return file;
}
