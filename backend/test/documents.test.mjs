import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import JSZip from 'jszip';
import Database from 'better-sqlite3';
import * as lancedb from '@lancedb/lancedb';

const temporary = await fs.mkdtemp(path.resolve('.astra-tmp/documents-tests-'));
process.env.APP_DATA_PATH = temporary;
process.env.OLLAMA_URL = 'http://127.0.0.1:1'; // Local offline failure, no real model or user store is touched.
process.env.MAX_FILE_SIZE_MB = '1';
const { db } = await import('../src/services/db.js');
const { migrateDocuments } = await import('../src/db/documentMigrations.js');
const { createSession } = await import('../src/services/sessionService.js');
const { prepareDocument } = await import('../src/docqa/ingest.js');
const { chunkText } = await import('../src/lib/chunkText.js');
const { indexDocumentFiles } = await import('../src/services/documentIngestionService.js');
const store = await import('../src/services/documentsStore.js');
const { appendHistory, getConversations, deleteConversation } =
  await import('../src/services/historyService.js');
const { retrieveDocumentContext } = await import('../src/docqa/retrieve.js');
const structured = await import('../src/docqa/structuredStore.js');
const { scopedVectorSearch } = await import('../src/services/vectorService.js');
const { prepareImageAttachment, saveImageAttachment, getAttachmentImages } =
  await import('../src/services/imageAttachmentService.js');
const { buildTable } = await import('../src/docqa/tableParser.js');
const { uploadRouter } = await import('../src/routes/upload.js');
const { documentsRouter } = await import('../src/routes/documents.js');
const { chatRouter } = await import('../src/routes/chat.js');
const userId = randomUUID(),
  otherUserId = randomUUID();
for (const id of [userId, otherUserId])
  db.prepare('INSERT INTO users(id,username,passwordHash,salt) VALUES(?,?,?,?)').run(
    id,
    id,
    'fixture',
    'fixture',
  );
const { token } = createSession(userId);
const app = express();
app.use(express.json());
app.use('/upload', uploadRouter);
app.use('/documents', documentsRouter);
app.use('/chat', chatRouter);
app.use((error, _request, response, _next) =>
  response
    .status(error.status || (error.code === 'LIMIT_FILE_SIZE' ? 413 : 500))
    .json({ error: error.status ? error.message : 'Upload failed.' }),
);
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  console.log(`Isolated document test artifacts: ${temporary}`);
});

async function write(name, content) {
  const filePath = path.join(temporary, name);
  await fs.writeFile(filePath, content);
  return { path: filePath, originalname: name, size: Buffer.byteLength(content) };
}
async function upload(files, purpose = 'attachment', sessionToken = token) {
  const body = new FormData();
  body.append('purpose', purpose);
  for (const [name, data, mime = 'text/plain'] of files)
    body.append('documents', new Blob([data], { type: mime }), name);
  const response = await fetch(`${base}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken}` },
    body,
  });
  return { response, result: await response.json() };
}

test('additive migration preserves old document and message rows', () => {
  const d = new Database(':memory:');
  d.exec(
    "CREATE TABLE documents(id TEXT,userId TEXT,name TEXT);CREATE TABLE messages(id TEXT,content TEXT);INSERT INTO documents VALUES('old','owner','old.pdf');INSERT INTO messages VALUES('turn','text');",
  );
  migrateDocuments(d);
  migrateDocuments(d);
  assert.equal(
    d.prepare("SELECT purpose FROM documents WHERE id='old'").get().purpose,
    'knowledge',
  );
  assert.equal(d.prepare("SELECT content FROM messages WHERE id='turn'").get().content, 'text');
  d.close();
});

test('long unpunctuated text is split into bounded overlapping chunks', () => {
  const text = Array.from({ length: 12000 }, (_, i) => String.fromCharCode(65 + (i % 26))).join('');
  const chunks = chunkText(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 900));
  assert.equal(chunks[0].slice(-140), chunks[1].slice(0, 140));
  assert.throws(() => chunkText(text, { size: 100, overlap: 100 }));
});

test('HTTP multipart attachment upload extracts text offline and never enters Knowledge', async () => {
  const { response, result } = await upload([
    ['note.txt', 'Cobalt budget is 730 rupees.'],
    ['plan.md', '# Project\nLaunch is Wednesday.'],
  ]);
  assert.equal(response.status, 201);
  assert.equal(result.documents.length, 2);
  assert.ok(
    result.documents.every((d) => d.scope === 'attachment' && d.characters > 0 && d.keywordOnly),
  );
  const listing = await fetch(`${base}/documents`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.deepEqual((await listing.json()).documents, []);
  assert.equal((await fs.readdir(path.join(temporary, 'storage', 'uploads'))).length, 0);
});

test('unsupported files and MIME/content mismatches have explicit per-file errors', async () => {
  const { response, result } = await upload([
    ['photo.gif', Buffer.from([1, 2, 3]), 'image/gif'],
    ['fake.pdf', 'hello', 'application/pdf'],
    ['fake.txt', 'hello', 'image/jpeg'],
    ['valid.txt', 'Cobalt valid text'],
  ]);
  assert.equal(response.status, 201);
  assert.equal(result.documents.length, 1);
  assert.equal(result.skipped.length, 3);
  assert.ok(result.skipped.some((s) => /Images and videos/.test(s.reason)));
  assert.ok(result.skipped.some((s) => /content does not match/.test(s.reason)));
  assert.ok(result.skipped.some((s) => /type does not match/.test(s.reason)));
});

test('unauthorized uploads write no files', async () => {
  const result = await upload([['no.txt', 'Should never be stored']], 'attachment', 'invalid');
  assert.equal(result.response.status, 401);
  assert.equal((await fs.readdir(path.join(temporary, 'storage', 'uploads'))).length, 0);
});

test('oversized uploads fail and remove partial upload files', async () => {
  const { response } = await upload([['oversize.txt', Buffer.alloc(1024 * 1024 + 1, 65)]]);
  assert.equal(response.status, 413);
  assert.equal((await fs.readdir(path.join(temporary, 'storage', 'uploads'))).length, 0);
});

test('offline model failure still preserves the exact sent attachment in history', async () => {
  const uploaded = await upload([['offline-history.txt', 'Offline readable evidence']]);
  const id = uploaded.result.documents[0].id,
    conversationId = randomUUID(),
    userMessageId = randomUUID();
  const response = await fetch(`${base}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      message: 'Explain this attachment',
      attachmentIds: [id],
      conversationId,
      userMessageId,
      workspaceId: null,
    }),
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /error/);
  const conversation = (await getConversations(userId)).find((c) => c.id === conversationId);
  assert.ok(conversation);
  assert.equal(conversation.messages[0].id, userMessageId);
  assert.equal(conversation.messages[0].attachments[0].id, id);
});

test('attachments bind transactionally to one user message and stable IDs prevent duplication', async () => {
  const file = await write('bound.txt', 'Cobalt exact attachment evidence');
  const { documents } = await indexDocumentFiles([file], userId, { purpose: 'attachment' });
  const id = documents[0].id,
    conversationId = randomUUID(),
    userMessageId = randomUUID();
  const first = await appendHistory(
    {
      conversationId,
      role: 'user',
      content: 'What is Cobalt?',
      attachmentIds: [id],
      userMessageId,
    },
    userId,
  );
  const repeated = await appendHistory(
    {
      conversationId,
      role: 'user',
      content: 'What is Cobalt?',
      attachmentIds: [id],
      userMessageId,
    },
    userId,
  );
  assert.equal(first.id, repeated.id);
  assert.equal(first.attachments[0].name, 'bound.txt');
  const conversation = (await getConversations(userId)).find((c) => c.id === conversationId);
  assert.equal(conversation.messages.length, 1);
  assert.equal(conversation.messages[0].attachments[0].id, id);
  await assert.rejects(
    appendHistory(
      { conversationId: randomUUID(), role: 'user', content: 'Other chat', attachmentIds: [id] },
      userId,
    ),
    /Attachment not found/,
  );
  await assert.rejects(
    appendHistory(
      { conversationId: randomUUID(), role: 'user', content: 'Other user', attachmentIds: [id] },
      otherUserId,
    ),
    /Attachment not found/,
  );
  await assert.rejects(
    appendHistory(
      { conversationId, role: 'user', content: 'Changed', attachmentIds: [id], userMessageId },
      userId,
    ),
    /Message does not belong/,
  );
});

test('scoped text retrieval excludes another conversation, Knowledge and another user', async () => {
  const own = await indexDocumentFiles(
    [await write('scope-a.txt', 'Cobalt allowance equals 730.')],
    userId,
    { purpose: 'attachment' },
  );
  await indexDocumentFiles([await write('scope-b.txt', 'Cobalt allowance equals 999.')], userId, {
    purpose: 'attachment',
  });
  await indexDocumentFiles(
    [await write('scope-knowledge.txt', 'Cobalt allowance equals 888.')],
    userId,
    { purpose: 'knowledge' },
  );
  await indexDocumentFiles(
    [await write('scope-other-user.txt', 'Cobalt allowance equals 666.')],
    otherUserId,
    { purpose: 'attachment' },
  );
  const sources = await retrieveDocumentContext({
    message: 'Cobalt allowance',
    userId,
    model: 'offline',
    skipPlanner: true,
    documentIds: [own.documents[0].id],
  });
  assert.ok(sources.length);
  assert.ok(sources.every((s) => s.documentId === own.documents[0].id));
  assert.ok(sources.some((s) => s.text.includes('730')));
  const foreign = await retrieveDocumentContext({
    message: 'Cobalt allowance',
    userId: otherUserId,
    model: 'offline',
    skipPlanner: true,
    documentIds: [own.documents[0].id],
  });
  assert.deepEqual(foreign, []);
});

test('generic attachment summaries have bounded document evidence offline', async () => {
  const own = await indexDocumentFiles(
    [await write('summary.txt', 'Unusual orchard harvest contains plums and pears.')],
    userId,
    { purpose: 'attachment' },
  );
  const sources = await retrieveDocumentContext({
    message: 'summarize this document',
    userId,
    model: 'offline',
    skipPlanner: true,
    documentIds: [own.documents[0].id],
  });
  assert.ok(sources.some((s) => s.text.includes('plums')));
  assert.ok(sources.reduce((n, s) => n + s.text.length, 0) <= 7010);
});

test('spreadsheet exact rows and planner table selection obey document scope', async () => {
  const a = await indexDocumentFiles(
    [await write('table-a.csv', 'Name,City\nRavi,Chennai\nPriya,Mumbai')],
    userId,
    { purpose: 'attachment' },
  );
  const b = await indexDocumentFiles(
    [await write('table-b.csv', 'Name,City\nRavi,Delhi')],
    userId,
    { purpose: 'attachment' },
  );
  const ids = [a.documents[0].id];
  assert.ok(structured.listTables(userId, ids).every((t) => t.documentId === ids[0]));
  assert.ok(structured.searchRows('Ravi', userId, 20, ids).every((r) => r.documentId === ids[0]));
  const sources = await retrieveDocumentContext({
    message: 'Ravi details',
    userId,
    model: 'offline',
    skipPlanner: true,
    documentIds: ids,
  });
  assert.ok(sources.some((s) => s.text.includes('Chennai')));
  assert.ok(sources.every((s) => s.documentId !== b.documents[0].id));
});

test('large spreadsheets avoid argument-stack overflow and reject truncation', () => {
  const rows = Array.from({ length: 150000 }, (_, i) => [String(i), 'Chennai']);
  const table = buildTable('Large', [['Identifier', 'City'], ...rows]);
  assert.equal(table.rows.length, 150000);
  assert.throws(
    () => buildTable('Wide', [Array(201).fill('column'), Array(201).fill('value')]),
    /too many columns/,
  );
  assert.throws(() => buildTable('Oversized', Array(200021).fill(['data'])), /too many rows/);
});

test('folder hierarchy is retained and traversal metadata is rejected', async () => {
  const body = new FormData();
  body.append('purpose', 'attachment');
  body.append('relativePaths', JSON.stringify(['folder/nested/file.txt']));
  body.append(
    'documents',
    new Blob(['Safe hierarchical evidence'], { type: 'text/plain' }),
    'file.txt',
  );
  const response = await fetch(`${base}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).documents[0].relativePath, 'folder/nested/file.txt');
  const unsafe = new FormData();
  unsafe.append('relativePaths', JSON.stringify(['../escape.txt']));
  unsafe.append('documents', new Blob(['unsafe metadata']), 'escape.txt');
  const rejected = await fetch(`${base}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: unsafe,
  });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /unsafe/);
  assert.equal((await fs.readdir(path.join(temporary, 'storage', 'uploads'))).length, 0);
});

test('workspace null is optional and foreign workspace IDs are denied before inference', async () => {
  const allowed = await fetch(`${base}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: 'Hello', workspaceId: null, conversationId: randomUUID() }),
  });
  assert.equal(allowed.status, 200);
  assert.match(await allowed.text(), /error/); // Real offline discovery fails as expected.
  const denied = await fetch(`${base}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      message: 'Hello',
      workspaceId: randomUUID(),
      conversationId: randomUUID(),
    }),
  });
  assert.equal(denied.status, 400);
  assert.match((await denied.json()).error, /Workspace not found/);
});

test('workspace reindex/removal and cancelled ingestion preserve original files', async () => {
  const file = await write('workspace.txt', 'Workspace original evidence');
  const workspaceId = randomUUID();
  const result = await indexDocumentFiles([file], userId, { purpose: 'workspace', workspaceId });
  await store.deleteDocument(result.documents[0].id, userId);
  assert.equal(await fs.readFile(file.path, 'utf8'), 'Workspace original evidence');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    indexDocumentFiles([file], userId, {
      purpose: 'workspace',
      workspaceId,
      signal: controller.signal,
    }),
    { name: 'AbortError' },
  );
  assert.ok(await fs.stat(file.path));
});

test('cancelling reindex preserves the prior ready metadata and searchable text', async () => {
  const file = await write('reindex.txt', 'Sapphire original searchable evidence');
  const workspaceId = randomUUID();
  const first = await indexDocumentFiles([file], userId, { purpose: 'workspace', workspaceId });
  const originalId = first.documents[0].id;
  await fs.writeFile(file.path, 'Topaz replacement evidence');
  const controller = new AbortController();
  await assert.rejects(
    indexDocumentFiles([{ ...file, documentId: originalId }], userId, {
      purpose: 'workspace',
      workspaceId,
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.status === 'indexing') controller.abort();
      },
    }),
    { name: 'AbortError' },
  );
  assert.ok(store.getDocument(originalId, userId));
  assert.equal((await store.getDocuments(userId, { purpose: 'workspace', workspaceId })).length, 1);
  assert.ok(structured.searchTextChunks('Sapphire', userId, 10, [originalId]).length);
  assert.equal(await fs.readFile(file.path, 'utf8'), 'Topaz replacement evidence');
  const replacement = await indexDocumentFiles([{ ...file, documentId: originalId }], userId, {
    purpose: 'workspace',
    workspaceId,
  });
  assert.equal(replacement.documents.length, 1);
  assert.notEqual(replacement.documents[0].id, originalId);
  assert.equal(store.getDocument(originalId, userId), null);
  assert.ok(structured.searchTextChunks('Topaz', userId, 10, [replacement.documents[0].id]).length);
});

test('deleting a conversation removes its attachment indexes and preserves originals', async () => {
  const file = await write('delete-chat.txt', 'Amber attachment');
  const { documents } = await indexDocumentFiles([file], userId, { purpose: 'attachment' });
  const conversationId = randomUUID();
  await appendHistory(
    { conversationId, role: 'user', content: 'Amber', attachmentIds: [documents[0].id] },
    userId,
  );
  await deleteConversation(conversationId, userId);
  assert.equal(store.getDocument(documents[0].id, userId), null);
  assert.deepEqual(structured.searchTextChunks('Amber', userId, 10, [documents[0].id]), []);
  assert.ok(await fs.stat(file.path));
});

test('real DOCX extraction reads text and rejects a ZIP wearing a DOCX extension', async () => {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Indigo DOCX extraction evidence.</w:t></w:r></w:p></w:body></w:document>`,
  );
  const file = await write('real.docx', await zip.generateAsync({ type: 'nodebuffer' }));
  const extracted = await prepareDocument(file);
  assert.match(extracted.text, /Indigo DOCX extraction evidence/);
  const fake = new JSZip();
  fake.file('notes.txt', 'fake');
  const bad = await write('fake.docx', await fake.generateAsync({ type: 'nodebuffer' }));
  await assert.rejects(prepareDocument(bad), /content does not match/);
});

test('real PDF extraction preserves page numbers', async () => {
  const fixture = await fs.readFile(new URL('./fixtures/document-pages.pdf', import.meta.url));
  const extracted = await prepareDocument(await write('pages.pdf', fixture));
  assert.match(extracted.text, /Violet page one/);
  assert.match(extracted.text, /Emerald page two/);
  assert.ok(extracted.chunks.some((c) => c.startsWith('[Page 1]')));
  assert.ok(extracted.chunks.some((c) => c.startsWith('[Page 2]')));
});

test('real PNG/JPEG/WebP signatures and dimensions are validated', async () => {
  for (const extension of ['png', 'jpg', 'webp']) {
    const fixture = await fs.readFile(new URL(`./fixtures/image.${extension}`, import.meta.url));
    const prepared = await prepareImageAttachment(await write(`image.${extension}`, fixture));
    assert.equal(prepared.width, 16);
    assert.equal(prepared.height, 12);
    assert.ok(prepared.bytes.length);
  }
  await assert.rejects(
    prepareImageAttachment(await write('fake-image.png', 'malicious executable bytes')),
    /content does not match/,
  );
  const png = await fs.readFile(new URL('./fixtures/image.png', import.meta.url));
  await assert.rejects(
    prepareImageAttachment({ ...(await write('wrong-mime.png', png)), mimetype: 'image/jpeg' }),
    /type does not match/,
  );
});

test('image upload clearly rejects offline vision capability and leaves no stored bytes', async () => {
  const fixture = await fs.readFile(new URL('./fixtures/image.png', import.meta.url));
  const result = await upload([['offline-image.png', fixture, 'image/png']]);
  assert.equal(result.response.status, 201);
  assert.deepEqual(result.result.documents, []);
  assert.match(result.result.skipped[0].reason, /offline/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM document_images').get().n, 0);
  assert.equal((await fs.readdir(path.join(temporary, 'storage', 'uploads'))).length, 0);
});

test('image bytes remain private, require conversation ownership, and delete with attachment', async () => {
  const fixture = await fs.readFile(new URL('./fixtures/image.png', import.meta.url));
  const image = await prepareImageAttachment(await write('private-image.png', fixture));
  const id = randomUUID(),
    conversationId = randomUUID();
  await store.appendDocuments(
    [
      {
        id,
        name: 'private-image.png',
        size: fixture.length,
        purpose: 'attachment',
        kind: 'image',
        mediaType: 'image',
        mimeType: image.mimeType,
        status: 'ready',
      },
    ],
    userId,
  );
  saveImageAttachment(id, image);
  assert.deepEqual(getAttachmentImages([id], userId, conversationId), []);
  const sent = await appendHistory(
    { conversationId, role: 'user', content: 'Describe this', attachmentIds: [id] },
    userId,
  );
  assert.equal(sent.attachments[0].kind, 'image');
  assert.ok(!JSON.stringify(sent).includes(fixture.toString('base64')));
  assert.equal(getAttachmentImages([id], userId, conversationId)[0], fixture.toString('base64'));
  assert.deepEqual(getAttachmentImages([id], otherUserId, conversationId), []);
  assert.deepEqual(getAttachmentImages([id], userId, randomUUID()), []);
  const api = await fetch(`${base}/documents?purpose=attachment&conversationId=${conversationId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const listing = await api.text();
  assert.ok(!listing.includes(fixture.toString('base64')));
  await store.deleteDocument(id, userId);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM document_images WHERE documentId=?').get(id).n,
    0,
  );
});

test('real LanceDB prefilter excludes closer vectors belonging to another document', async () => {
  const connection = await lancedb.connect(path.join(temporary, 'scoped-vectors'));
  const target = randomUUID(),
    foreign = randomUUID();
  const rows = [
    {
      id: randomUUID(),
      documentId: foreign,
      filename: 'other.txt',
      chunkIndex: 0,
      text: 'wrong',
      vector: [1, 0],
    },
    {
      id: randomUUID(),
      documentId: target,
      filename: 'own.txt',
      chunkIndex: 0,
      text: 'right',
      vector: [0, 1],
    },
  ];
  const table = await connection.createTable('chunks', rows);
  const hits = await scopedVectorSearch(table, [1, 0], [target], 1);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].documentId, target);
  assert.equal(hits[0].text, 'right');
  assert.deepEqual(await scopedVectorSearch(table, [1, 0], [randomUUID()], 1), []);
});

test('HTTP chat rejects foreign attachments before model inference', async () => {
  const own = await indexDocumentFiles(
    [await write('foreign-chat.txt', 'Foreign ownership')],
    otherUserId,
    { purpose: 'attachment' },
  );
  const response = await fetch(`${base}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      message: 'read it',
      attachmentIds: [own.documents[0].id],
      conversationId: randomUUID(),
    }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Attachment not found/);
});
