import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEvents, refresh, getState } from './lib/events.js';

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');

app.use(express.static(publicDir));

app.get('/api/events', async (req, res) => {
  const data = await getEvents(req.query);
  res.set('Cache-Control', 'no-store');
  res.json(data);
});

app.post('/api/refresh', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await refresh());
});

app.get('/api/cron', async (req, res) => {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false });
  }
  const result = await refresh();
  res.json({ ok: true, count: result.events.length, updatedAt: result.updatedAt, errors: result.errors });
});

app.get('/api/health', async (_req, res) => {
  const data = await getEvents({});
  res.json({
    ok: true,
    events: data.events.length,
    updatedAt: data.updatedAt,
    sources: data.sources,
    errors: data.errors,
  });
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Leeds Live Events → http://localhost:${PORT}`);
    refresh().catch(console.error);
  });
}
