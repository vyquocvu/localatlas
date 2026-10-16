#!/usr/bin/env node
import { serve } from '@hono/node-server';
import { app } from './server.js';
import { importProject, projects, selectProject, listDocs, readDoc, writeDoc } from './core.js';
const args = process.argv.slice(2);
const command = args.shift() ?? 'help';
function option(key: string) { const at = args.indexOf(key); if (at < 0) return undefined; const value = args[at + 1]; if (!value) throw new Error('Missing value for ' + key); args.splice(at, 2); return value; }
async function main() {
  const selector = option('--project');
  const json = args.includes('--json'); if (json) args.splice(args.indexOf('--json'), 1);
  let result: unknown;
  switch (command) {
    case 'import': if (!args[0]) throw new Error('Usage: localatlas import <directory>'); result = await importProject(args[0]); break;
    case 'projects': result = await projects(); break;
    case 'status': result = await selectProject(selector); break;
    case 'docs': result = await listDocs(await selectProject(selector)); break;
    case 'read': if (!args[0]) throw new Error('Usage: localatlas read <document.md>'); result = await readDoc(await selectProject(selector), args[0]); break;
    case 'write': if (!args[0]) throw new Error('Usage: localatlas write <document.md> (reads stdin)'); {
      const chunks: Buffer[] = []; for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
      await writeDoc(await selectProject(selector), args[0], Buffer.concat(chunks).toString('utf8')); result = 'Saved ' + args[0]; break;
    }
    case 'serve': { const host = '127.0.0.1'; const port = Number(process.env.PORT ?? 3456); serve({ fetch: app.fetch, hostname: host, port }); console.log('LocalAtlas running at http://' + host + ':' + port); return; }
    default: console.log('LocalAtlas CLI\n  import <path> | projects | status | docs | read <file.md> | write <file.md> | serve\n  Options: --project <id|name> --json'); return;
  }
  console.log(json ? JSON.stringify(result, null, 2) : typeof result === 'string' ? result : JSON.stringify(result, null, 2));
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
