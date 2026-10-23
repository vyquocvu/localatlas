import { cleanupTestDirectory } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CodexChatManager, JsonRpcPeer } from '../src/core/codex-chat.js';
import { importProject } from '../src/core.js';
import { app } from '../src/server.js';

async function snapshotDirectory(root: string): Promise<string> {
  const items: string[] = [];
  async function visit(dir: string, relative = ''): Promise<void> {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        items.push(`d:${child}`);
        await visit(fullPath, child);
      } else {
        items.push(`f:${child}:${await fs.readFile(fullPath, 'utf8')}`);
      }
    }
  }
  await visit(root);
  return items.join('\n');
}

async function waitForAcceptedApproval(logPath: string): Promise<Record<string, any>[]> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const log = (await fs.readFile(logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, any>);
    if (log.some(item => item.id === 900 && item.result?.decision === 'accept')) return log;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return (await fs.readFile(logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, any>);
}

test('Codex JSON-RPC peer handles fragmented messages, notifications, and approvals', async () => {
  const sent: string[] = [];
  const peer = new JsonRpcPeer(line => sent.push(line));
  const notificationMethods: string[] = [];
  peer.onNotification(frame => notificationMethods.push(String(frame.method)));
  peer.onServerRequest(frame => peer.respond(frame.id!, { decision: 'accept' }));

  const responsePromise = peer.request<{ ok: boolean }>('test/ping', { value: 1 });
  assert.deepEqual(JSON.parse(sent[0]!), { jsonrpc: '2.0', id: 1, method: 'test/ping', params: { value: 1 } });
  peer.receive('{"jsonrpc":"2.0","id":1,"result":{"ok":');
  peer.receive('true}}\n{"jsonrpc":"2.0","method":"thread/started","params":{}}\n');
  assert.deepEqual(await responsePromise, { ok: true });
  assert.deepEqual(notificationMethods, ['thread/started']);

  peer.receive('{"jsonrpc":"2.0","id":44,"method":"item/commandExecution/requestApproval","params":{}}\n');
  assert.deepEqual(JSON.parse(sent.at(-1)!), { jsonrpc: '2.0', id: 44, result: { decision: 'accept' } });
  peer.fail(new Error('test complete'));
});

test('Codex chat endpoints stay localhost-only when remote UI access is enabled', async () => {
  const previousRemoteSetting = process.env.LOCALATLAS_ALLOW_REMOTE;
  process.env.LOCALATLAS_ALLOW_REMOTE = 'true';
  try {
    const headers = {
      host: 'remote.example:3456',
      origin: 'http://remote.example:3456',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    };
    const start = await app.request('/api/projects/not-a-project/codex-chat/start', { method: 'POST', headers });
    assert.equal(start.status, 403);
    assert.match((await start.json() as { error: string }).error, /localhost/);
    const localHostExternalOrigin = {
      host: '127.0.0.1:3456',
      origin: 'https://preview.trycloudflare.com',
      'sec-fetch-site': 'same-site',
      'content-type': 'application/json',
    };
    const crossOriginStart = await app.request('/api/projects/not-a-project/codex-chat/start', { method: 'POST', headers: localHostExternalOrigin });
    assert.equal(crossOriginStart.status, 403);
    const events = await app.request('/api/projects/not-a-project/codex-chat/11111111-1111-4111-8111-111111111111/events', { headers: localHostExternalOrigin });
    assert.equal(events.status, 403);
  } finally {
    if (previousRemoteSetting === undefined) delete process.env.LOCALATLAS_ALLOW_REMOTE;
    else process.env.LOCALATLAS_ALLOW_REMOTE = previousRemoteSetting;
  }
});

test('Codex chats stay scoped to each project, surface approval requests, and leave imported repositories untouched', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localatlas-codex-chat-'));
  const previousHome = process.env.LOCALATLAS_HOME;
  const previousPath = process.env.PATH;
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const logPath = path.join(root, 'fake-codex.jsonl');
  const repoA = path.join(root, 'repo-a');
  const repoB = path.join(root, 'repo-b');
  const codexPath = path.join(bin, 'codex');
  const manager = new CodexChatManager();

  try {
    await fs.mkdir(bin, { recursive: true });
    for (const repo of [repoA, repoB]) {
      await fs.mkdir(repo);
      await fs.writeFile(path.join(repo, 'README.md'), `# ${path.basename(repo)}\n`);
    }
    await fs.writeFile(codexPath, String.raw`#!/usr/bin/env node
const fs = require('node:fs');
let buffer = '';
function send(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
function record(value) { fs.appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify(value) + '\n'); }
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let newline = buffer.indexOf('\n');
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) {
      const request = JSON.parse(line);
      record(request);
      if (request.method === 'initialize') send({ jsonrpc: '2.0', id: request.id, result: {} });
      else if (request.method === 'thread/start') {
        const threadId = process.cwd().endsWith('repo-a') ? '11111111-1111-4111-8111-111111111111' : '33333333-3333-4333-8333-333333333333';
        send({ jsonrpc: '2.0', id: request.id, result: { thread: { id: threadId, status: { type: 'idle' }, turns: [] }, cwd: request.params.cwd } });
      }
      else if (request.method === 'thread/resume') send({ jsonrpc: '2.0', id: request.id, result: { thread: { id: request.params.threadId, status: { type: 'idle' } }, cwd: process.env.FAKE_CODEX_RESUME_CWD || process.cwd(), initialTurnsPage: { data: [] } } });
      else if (request.method === 'thread/turns/list') send({ jsonrpc: '2.0', id: request.id, result: { data: [] } });
      else if (request.method === 'turn/start') {
        const threadId = request.params.threadId;
        send({ jsonrpc: '2.0', method: 'turn/started', params: { threadId, turn: { id: 'turn-1' } } });
        send({ jsonrpc: '2.0', id: 900, method: 'item/commandExecution/requestApproval', params: { threadId, command: 'touch reviewed.txt', cwd: process.cwd(), availableDecisions: ['accept', 'decline'] } });
        send({ jsonrpc: '2.0', id: request.id, result: { turn: { id: 'turn-1' } } });
      } else if (request.id === 900 && request.result) {
        send({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: '11111111-1111-4111-8111-111111111111', turn: { id: 'turn-1', status: 'completed' } } });
      }
    }
    newline = buffer.indexOf('\n');
  }
});
`);
    await fs.chmod(codexPath, 0o755);
    process.env.LOCALATLAS_HOME = home;
    process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
    process.env.FAKE_CODEX_LOG = logPath;

    const projectA = await importProject(repoA, { key: 'CDA' });
    const projectB = await importProject(repoB, { key: 'CDB' });
    const beforeA = await snapshotDirectory(repoA);
    const beforeB = await snapshotDirectory(repoB);

    const threadA = await manager.start(projectA, 'A-only context marker');
    const threadB = await manager.start(projectB, 'B-only context marker');
    assert.notEqual(projectA.id, projectB.id);
    assert.equal(threadA.threadId, '11111111-1111-4111-8111-111111111111');
    assert.notEqual(threadB.threadId, threadA.threadId);

    const turn = await manager.startTurn(projectA, threadA.threadId, 'Review the project');
    assert.equal(turn.turnId, 'turn-1');
    const approval = manager.getRuntime(projectA, threadA.threadId).eventsAfter(0).find(event => event.type === 'approval-request');
    assert.equal(approval?.data.command, 'touch reviewed.txt');
    manager.approve(projectA, threadA.threadId, String(approval?.data.requestId), 'accept');

    const log = await waitForAcceptedApproval(logPath);
    const initializes = log.filter(item => item.method === 'initialize');
    assert.ok(initializes.length >= 2);
    assert.equal(initializes[0].params.capabilities.experimentalApi, true);
    const starts = log.filter(item => item.method === 'thread/start');
    assert.equal(starts.length, 2);
    assert.match(starts[0].params.developerInstructions, /A-only context marker/);
    assert.doesNotMatch(starts[0].params.developerInstructions, /B-only context marker/);
    assert.match(starts[1].params.developerInstructions, /B-only context marker/);
    assert.doesNotMatch(starts[1].params.developerInstructions, /A-only context marker/);
    assert.ok(log.some(item => item.id === 900 && item.result?.decision === 'accept'));

    process.env.FAKE_CODEX_RESUME_CWD = projectA.sourcePath;
    await assert.rejects(
      manager.resume(projectB, '22222222-2222-4222-8222-222222222222'),
      /different project folder/
    );
    assert.equal(await snapshotDirectory(repoA), beforeA);
    assert.equal(await snapshotDirectory(repoB), beforeB);
  } finally {
    manager.closeAll();
    if (previousHome === undefined) delete process.env.LOCALATLAS_HOME;
    else process.env.LOCALATLAS_HOME = previousHome;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    delete process.env.FAKE_CODEX_LOG;
    delete process.env.FAKE_CODEX_RESUME_CWD;
    await cleanupTestDirectory(root);
  }
});
