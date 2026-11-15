import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import * as fx from './fixtures.mjs';

const dataDir = await fx.tempDir('docintel-routes-');
process.env.APP_DATA_PATH = dataDir;

const { default: express } = await import('express');
const { createDocIntelRouter } = await import('../../src/routes/docintel.js');
const { requireAuth } = await import('../../src/middleware/auth.js');
const { parseDocument } = await import('../../src/docintel/parser.js');
const { JobRegistry, ResultStore } = await import('../../src/docintel/stores.js');
const { OutputStore } = await import('../../src/fileagent/outputs.js');
const { routeTask, executeTask, runDocumentIntelligence } =
  await import('../../src/docintel/agent.js');
const { findSoffice } = await import('../../src/docintel/libreoffice.js');

const dir = await fx.tempDir();
const userA = crypto.randomUUID();
const userB = crypto.randomUUID();
const ids = {
  inv: crypto.randomUUID(),
  big: crypto.randomUUID(),
  word: crypto.randomUUID(),
  pdf: crypto.randomUUID(),
};
const files = {
  inv: await fx.inventoryWorkbook(dir),
  big: await fx.bigCsv(dir),
  word: await fx.sampleDocx(dir),
  pdf: path.join(dir, 'report.pdf'),
};
await fs.writeFile(
  files.pdf,
  fx.makePdf([['Quarterly report', 'Revenue grew 12 percent'], ['Chennai branch opened in May']]),
);
const names = { inv: 'inventory.xlsx', big: 'big.csv', word: 'policy.docx', pdf: 'report.pdf' };
const owner = { [ids.inv]: userA, [ids.big]: userA, [ids.word]: userA, [ids.pdf]: userA };

/** Owner-scoped document loader over real parsed fixtures (stands in for the app's document store). */
async function loadDocuments(userId, documentIds) {
  const out = [];
  for (const id of documentIds) {
    if (owner[id] !== userId) continue;
    const key = Object.keys(ids).find((k) => ids[k] === id);
    const doc = await parseDocument(files[key], names[key]);
    doc.id = id;
    doc.original = { path: files[key] };
    out.push(doc);
  }
  return out;
}

const outputs = new OutputStore(path.join(dataDir, 'outputs'));
const results = new ResultStore();
const jobs = new JobRegistry();
const deps = { loadDocuments, outputs, results, chat: null, completeJSON: null };
const fakeAuth = (req, res, next) => {
  const u = req.headers['x-test-user'];
  if (!u) return res.status(401).json({ error: 'Authentication required.' });
  req.userId = u;
  next();
};
const app = express();
app.use(express.json());
app.use(
  '/real',
  createDocIntelRouter({ auth: requireAuth, deps, jobs, results, limiter: (_q, _s, n) => n() }),
);
app.use(
  '/api/docintel',
  createDocIntelRouter({ auth: fakeAuth, deps, jobs, results, limiter: (_q, _s, n) => n() }),
);
const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
test.after(() => server.close());
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, url, { user = userA, body } = {}) => {
  const r = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
};
const waitJob = async (id, user = userA) => {
  for (let i = 0; i < 600; i++) {
    const r = await call('GET', `/api/docintel/jobs/${id}`, { user });
    if (r.body.status !== 'running') return r.body;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('job did not finish');
};

test('authentication: the real session middleware rejects requests without a bearer token', async () => {
  const r = await fetch(`${base}/real/capabilities`);
  assert.equal(r.status, 401);
  assert.equal((await call('GET', '/api/docintel/capabilities', { user: null })).status, 401);
});

test('authorization: another user cannot inspect, query or page through your documents and results', async () => {
  assert.equal(
    (await call('GET', `/api/docintel/documents/${ids.inv}`, { user: userB })).status,
    404,
  );
  assert.equal(
    (
      await call('POST', `/api/docintel/documents/${ids.inv}/range`, {
        user: userB,
        body: { from: 'P110', to: 'P115' },
      })
    ).status,
    404,
  );
  const r = await call('POST', `/api/docintel/documents/${ids.big}/range`, {
    body: { from: 'P1000', to: 'P1249' },
  });
  assert.equal(r.status, 200);
});

test('inspect returns sheets, header rows, column types and warnings', async () => {
  const r = await call('GET', `/api/docintel/documents/${ids.inv}`);
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.tables.map((t) => [t.name, t.rows, t.headerRow]),
    [
      ['Inventory', 12, 3],
      ['Suppliers', 3, 1],
    ],
  );
  assert.equal(r.body.tables[0].types[6], 'date');
});

test('range endpoint: all matching rows, missing IDs, real row refs and pagination with the total', async () => {
  const r = await call('POST', `/api/docintel/documents/${ids.inv}/range`, {
    body: { from: 'P110', to: 'P115' },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.rows.map((x) => x.values[0]),
    ['P110', 'P111', 'P113', 'P114', 'P114', 'P115'],
  );
  assert.deepEqual(r.body.missing, ['P112']);
  assert.equal(r.body.verified, true);
  assert.equal(r.body.source.rows, '6–11');
  const p = await call('POST', `/api/docintel/documents/${ids.big}/range`, {
    body: { from: 'P1000', to: 'P1249', page: 3, pageSize: 100 },
  });
  assert.deepEqual(
    [p.body.total, p.body.pages, p.body.page, p.body.rows.length, p.body.rows[0].values[0]],
    [250, 3, 3, 50, 'P1200'],
  );
});

test('filter / aggregate / group / duplicates / search endpoints validate input and compute exactly', async () => {
  const f = await call('POST', `/api/docintel/documents/${ids.inv}/filter`, {
    body: {
      conditions: [{ column: 'Stock', op: 'lt', value: '20' }],
      sort: [{ column: 'Stock', direction: 'asc' }],
    },
  });
  assert.deepEqual(
    f.body.rows.map((x) => x.values[0]),
    ['P113', 'P117', 'P110', 'P109', 'P120'],
  );
  assert.equal(f.body.skippedCount, 1);
  const a = await call('POST', `/api/docintel/documents/${ids.inv}/aggregate`, {
    body: { fn: 'sum', column: 'Stock' },
  });
  assert.deepEqual(
    [a.body.value, a.body.included, a.body.blanks, a.body.invalid.length],
    [1443, 10, [7], 1],
  );
  const s = await call('POST', `/api/docintel/documents/${ids.inv}/aggregate`, {
    body: {
      fn: 'SUMIF',
      column: 'Stock',
      criteria: [{ column: 'Category', op: 'eq', value: 'Electronics' }],
    },
  });
  assert.equal(s.body.value, 83);
  const g = await call('POST', `/api/docintel/documents/${ids.big}/group`, {
    body: { by: ['Region'], aggregates: [{ fn: 'SUM', column: 'Amount' }] },
  });
  assert.equal(
    g.body.rows.reduce((n, r) => n + r.rows, 0),
    250,
  );
  const d = await call('POST', `/api/docintel/documents/${ids.inv}/duplicates`, {
    body: { columns: ['Product ID'] },
  });
  assert.equal(d.body.groupCount, 1);
  const q = await call('POST', `/api/docintel/documents/${ids.pdf}/search`, {
    body: { query: 'chennai' },
  });
  assert.deepEqual(
    q.body.hits.map((h) => h.page),
    [2],
  );
  // validation
  assert.equal(
    (
      await call('POST', `/api/docintel/documents/${ids.inv}/filter`, {
        body: { conditions: [{ column: 'Stock', op: 'drop table', value: 1 }] },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call('POST', `/api/docintel/documents/${ids.inv}/aggregate`, {
        body: { fn: 'EVAL', column: 'Stock' },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call('POST', `/api/docintel/documents/not-a-uuid/range`, {
        body: { from: 'P1', to: 'P2' },
      })
    ).status,
    400,
  );
  const amb = await call('POST', `/api/docintel/documents/${ids.inv}/aggregate`, {
    body: { fn: 'SUM', column: 'cost' },
  });
  assert.deepEqual([amb.status, amb.body.code], [400, 'AMBIGUOUS_COLUMN']);
  assert.equal(
    (
      await call('POST', `/api/docintel/documents/${ids.inv}/range`, {
        body: { from: 'P115', to: 'P110' },
      })
    ).body.code,
    'BAD_RANGE',
  );
});

test('natural-language task job: P110 to P115 exported to Excel, verified, downloadable only by the owner', async () => {
  const start = await call('POST', '/api/docintel/tasks', {
    body: { message: 'List P110 to P115 and export to Excel', documentIds: [ids.inv] },
  });
  assert.equal(start.status, 202);
  const job = await waitJob(start.body.id);
  assert.equal(job.status, 'done', JSON.stringify(job.error));
  assert.equal(job.result.status, 'ok');
  const outputId = job.result.markdown.match(/#chanakya-output=([0-9a-f-]{36})/)[1];
  const saved = await outputs.get(userA, outputId);
  assert.equal(saved.name, 'inventory-P110-P115.xlsx');
  assert.ok(saved.size > 0);
  assert.equal(saved.verification.ok, true);
  assert.equal(await outputs.get(userB, outputId), null);
  const back = await parseDocument(saved.path, 'check.xlsx');
  assert.deepEqual(
    back.tables[0].rows.map((r) => r.values[1]),
    ['P110', 'P111', 'P113', 'P114', 'P114', 'P115'],
  );
  assert.equal(
    (await call('GET', `/api/docintel/jobs/${start.body.id}`, { user: userB })).status,
    404,
  );
});

test('convert job, unsupported conversion job and cancellation', async () => {
  const ok = await call('POST', '/api/docintel/convert', {
    body: { documentId: ids.inv, target: 'csv' },
  });
  const done = await waitJob(ok.body.id);
  assert.equal(done.status, 'done');
  assert.equal(
    (done.result.markdown.match(/#chanakya-output=/g) || []).length,
    2,
    'one CSV per sheet',
  );
  const bad = await waitJob(
    (await call('POST', '/api/docintel/convert', { body: { documentId: ids.pdf, target: 'xlsx' } }))
      .body.id,
  );
  assert.match(bad.result.markdown, /no tables/);
  const gen = await call('POST', '/api/docintel/generate', {
    body: {
      format: 'xlsx',
      spec: {
        title: 'Stock',
        sheets: [
          {
            name: 'S',
            columns: ['Item', 'Qty'],
            rows: [
              ['A', 2],
              ['B', 3],
            ],
            totals: ['Qty'],
          },
        ],
      },
    },
  });
  const g = await waitJob(gen.body.id);
  assert.equal(g.status, 'done', JSON.stringify(g.error));
  assert.equal(g.result.verification.ok, true);
  const cancel = await call('POST', `/api/docintel/jobs/${crypto.randomUUID()}/cancel`);
  assert.equal(cancel.status, 404);
});

test('result pages for large chat answers come from the full stored rows', async () => {
  const docs = await loadDocuments(userA, [ids.big]);
  const task = routeTask('show P1000 to P1249', docs);
  const r = await executeTask(task, docs, {
    userId: userA,
    outputs,
    results,
    message: 'show P1000 to P1249',
  });
  assert.match(r.markdown, /Showing 1–50 of 250 rows/);
  const resultId = r.markdown.match(/#chanakya-docintel=([0-9a-f-]{36})/)[1];
  const p = await call('GET', `/api/docintel/results/${resultId}?page=3&pageSize=100`);
  assert.deepEqual(
    [p.body.total, p.body.from, p.body.to, p.body.rows[0][1]],
    [250, 201, 250, 'P1200'],
  );
  assert.equal(
    (await call('GET', `/api/docintel/results/${resultId}`, { user: userB })).status,
    404,
  );
});

test('agent: chat prompts route deterministically and answers carry counts, checks and sources', async () => {
  const docs = await loadDocuments(userA, [ids.inv]);
  const run = async (message, soffice = null) => {
    const task = routeTask(message, docs);
    return task
      ? executeTask(task, docs, { userId: userA, outputs, results, message, soffice })
      : null;
  };
  const range = await run('List out P110 to P115.');
  assert.match(range.markdown, /6 matching rows/);
  assert.match(range.markdown, /Missing \(not in the file\): P112/);
  assert.match(range.markdown, /Source: inventory\.xlsx › sheet "Inventory" › rows 6–11/);
  const sum = await run('Excel-la total cost SUM pannu');
  assert.match(sum.markdown, /SUM of Total Cost \(column F\) = 1,38,360/);
  assert.match(sum.markdown, /Error cells excluded: 1 — row 12: #VALUE!/);
  assert.match(
    sum.markdown,
    /Formula cells with no saved result \(unknown, excluded\): 1 — e\.g\. row 13: =D13\*E13/,
  );
  assert.match(sum.markdown, /LibreOffice is not installed/);
  if (findSoffice()) {
    const recalc = await run('Excel-la total cost SUM pannu', findSoffice());
    assert.match(
      recalc.markdown,
      /= 1,55,160\*\*/,
      'with LibreOffice the unsaved formula (8 × 2100) is recalculated',
    );
    assert.match(recalc.markdown, /recalculated with LibreOffice/);
    assert.doesNotMatch(recalc.markdown, /no saved result/);
  }
  const filter = await run('Show products where stock is below 20');
  assert.equal(
    filter.status,
    'partial',
    'skipped cells make the result partial, not silently complete',
  );
  assert.match(filter.markdown, /5 rows/);
  const sumText = await run('total stock');
  assert.match(
    sumText.markdown,
    /would show 243/,
    "the answer says Excel's SUM differs when numbers are stored as text",
  );
  const clarify = await run('total of cost');
  assert.equal(clarify.status, 'clarify');
  assert.match(
    clarify.markdown,
    /Which sheet or table/,
    'no column matches exactly and two sheets exist: ask, do not guess',
  );
  const backwards = await run('list P115 to P110');
  assert.equal(backwards.status, 'error');
  assert.match(backwards.markdown, /starts after it ends/);
  assert.equal(
    routeTask('who supplies the keyboards?', docs),
    null,
    'open questions go to conversational document Q&A',
  );
});

test('agent: totals edit and Word edit produce verified new files; originals unchanged', async () => {
  const sha = async (f) =>
    crypto
      .createHash('sha256')
      .update(await fs.readFile(f))
      .digest('hex');
  const before = { inv: await sha(files.inv), word: await sha(files.word) };
  const docs = await loadDocuments(userA, [ids.inv, ids.word]);
  const t1 = routeTask('add a total row for Unit Cost in inventory.xlsx', docs);
  assert.equal(t1.action, 'edit');
  const r1 = await executeTask(t1, docs, {
    userId: userA,
    outputs,
    results,
    soffice: findSoffice(),
  });
  assert.match(r1.markdown, /E16: =SUM\(E4:E15\) → 15356/);
  assert.match(r1.markdown, /#chanakya-output=/);
  const t2 = routeTask('replace "reporting manager" with "HR manager"', docs);
  const r2 = await executeTask(t2, docs, { userId: userA, outputs, results });
  assert.match(r2.markdown, /Replaced 1 occurrence/);
  assert.deepEqual({ inv: await sha(files.inv), word: await sha(files.word) }, before);
});

test('chat entry point streams the deterministic answer and returns null for non-document messages', async () => {
  let streamed = '';
  const out = await runDocumentIntelligence({
    message: 'P110 to P115 kaattu',
    userId: userA,
    documentIds: [ids.inv],
    emit: (t) => (streamed += t),
    status: () => {},
    deps,
  });
  assert.equal(out.task.action, 'range');
  assert.equal(streamed, out.content);
  assert.equal(
    await runDocumentIntelligence({
      message: 'hello, how are you?',
      userId: userA,
      documentIds: [],
      emit: () => {},
      deps,
    }),
    null,
  );
  assert.equal(
    await runDocumentIntelligence({
      message: 'P110 to P115',
      userId: userB,
      documentIds: [ids.inv],
      emit: () => {},
      deps,
    }),
    null,
    "someone else's document is never loaded",
  );
});
