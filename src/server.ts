import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { projects, importProject, selectProject, listDocs, readDoc, writeDoc } from './core.js';
export const app = new Hono();
app.get('/api/projects', async c => c.json(await projects()));
app.post('/api/projects', async c => {
  const body = await c.req.json<{ path?: string }>();
  if (typeof body.path !== 'string') return c.json({ error: 'path required' }, 400);
  try { return c.json(await importProject(body.path), 201); } catch (e) { return c.json({ error: String(e) }, 400); }
});
app.get('/api/projects/:id/docs', async c => {
  try { return c.json(await listDocs(await selectProject(c.req.param('id')))); } catch (e) { return c.json({ error: String(e) }, 404); }
});
app.get('/api/projects/:id/docs/*', async c => {
  try { return c.text(await readDoc(await selectProject(c.req.param('id')), c.req.path.split('/docs/').slice(1).join('/docs/'))); } catch (e) { return c.json({ error: String(e) }, 404); }
});
app.put('/api/projects/:id/docs/*', async c => {
  try { await writeDoc(await selectProject(c.req.param('id')), c.req.path.split('/docs/').slice(1).join('/docs/'), await c.req.text()); return c.json({ ok: true }); }
  catch (e) { return c.json({ error: String(e) }, 400); }
});
app.use('/*', serveStatic({ root: './public' }));
