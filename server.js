import express from 'express';
import { getEvents, refresh, getState } from './lib/events.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/api/events', async (req, res) => {
  const data = await getEvents(req.query);
  res.set('Cache-Control', data.events.length ? 's-maxage=300, stale-while-revalidate=1800' : 'no-store');
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

app.get('/api/health', (_req, res) => {
  const state = getState();
  res.json({ ok: true, events: state.events.length, updatedAt: state.updatedAt, sources: state.sources, errors: state.errors });
});

export default app;

if (!process.env.VERCEL) {
  app.use(express.static('public'));
  app.listen(PORT, () => {
    console.log(`Leeds Live Events → http://localhost:${PORT}`);
    refresh().catch(console.error);
  });
}
