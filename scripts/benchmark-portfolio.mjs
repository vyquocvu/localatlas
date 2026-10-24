import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const originalPath = process.env.PATH || '';
const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
async function runScenario(projectCount, largeDocs = 0) {
  const root = await mkdtemp(path.join(tmpdir(), 'localatlas-portfolio-bench-'));
  const home = path.join(root, 'localatlas-home');
  const sources = path.join(root, 'sources');
  const wrapper = path.join(root, 'bin');
  await mkdir(sources, { recursive: true }); await mkdir(wrapper, { recursive: true });
  const gitLog = path.join(root, 'git-runs.log');
  await writeFile(path.join(wrapper, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$LOCALATLAS_GIT_LOG"\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
  process.env.LOCALATLAS_HOME = home; process.env.LOCALATLAS_GIT_LOG = gitLog; process.env.PATH = `${wrapper}:${originalPath}`;
  const core = await import(pathToFileURL(path.join(repoRoot, 'src/core.ts')).href);
  const projects = [];
  for (let i=0;i<projectCount;i++) {
    const source = path.join(sources, `project-${String(i+1).padStart(3,'0')}`); await mkdir(source, { recursive: true });
    projects.push(await core.importProject(source, { key: `B${String(i+1).padStart(3,'0')}`, name: `Benchmark ${i+1}` }));
  }
  if (largeDocs && projects[0]) {
    const docsDir = path.join(home, 'projects', projects[0].id, 'docs'); await mkdir(docsDir, { recursive: true });
    for(let i=0;i<largeDocs;i++) await writeFile(path.join(docsDir, `page-${String(i+1).padStart(4,'0')}.md`), `---\ntitle: Page ${i+1}\ntype: note\n---\n\n# Page ${i+1}\n\nSynthetic benchmark content.\n`);
    await core.reindexProject(projects[0]);
  }
  try {
    const samples=[]; let gitRuns=0; let summary;
    for(let i=0;i<3;i++) {
      await writeFile(gitLog, ''); const start=performance.now(); summary=await core.getPortfolioSummary(); samples.push(Math.round((performance.now()-start)*100)/100);
      gitRuns = (await readFile(gitLog,'utf8')).trim().split('\n').filter(Boolean).length;
      if(summary.totals.projectsCount!==projectCount) throw new Error('Project count mismatch');
    }
    const sorted=[...samples].sort((a,b)=>a-b);
    console.log(JSON.stringify({ scenario:`${projectCount}-projects${largeDocs?`-${largeDocs}-docs`:''}`, projectCount, largeDocs, samplesMs:samples, medianMs:sorted[1], gitCommandsLastRun:gitRuns, metrics:summary.metrics }));
  } finally {
    process.env.PATH=originalPath; delete process.env.LOCALATLAS_HOME; delete process.env.LOCALATLAS_GIT_LOG;
    await rm(root,{recursive:true,force:true});
  }
}
await runScenario(10);
await runScenario(50);
await runScenario(1,1000);
