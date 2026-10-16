import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importProject, projects, listDocs, readDoc, writeDoc, documentPath, selectProject } from '../src/core.js';
test('multi-project import and Markdown persistence', async () => {
 const root = await mkdtemp(join(tmpdir(), 'localatlas-test-')); process.env.LOCALATLAS_HOME = join(root, 'app');
 try {
   const aDir=join(root,'project-a'), bDir=join(root,'project-b');
   const { mkdir } = await import('node:fs/promises'); await mkdir(aDir); await mkdir(bDir);
   const a=await importProject(aDir),b=await importProject(bDir);
   assert.equal((await projects()).length,2); assert.equal((await importProject(aDir)).id,a.id);
   assert.equal((await selectProject(undefined,join(aDir,'src'))).id,a.id);
   await writeDoc(a,'spec/PRD.md','# PRD'); assert.equal(await readDoc(a,'spec/PRD.md'),'# PRD');
   assert.deepEqual(await listDocs(a),['spec/PRD.md']); assert.deepEqual(await listDocs(b),[]);
   await assert.rejects(documentPath(a,'../escape.md'));
 } finally { await rm(root,{recursive:true,force:true}); }
});
