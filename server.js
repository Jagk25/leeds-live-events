import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEvents, refresh, getAnalytics } from './lib/events.js';
import { fail, send } from './lib/core.js';

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');

app.use(express.static(publicDir));

function wrap(fn) {
  return async (req, res, next) => {
    try { await fn(req, res); } catch (err) { next(err); }
  };
}

app.get('/api/events', wrap(async (req, res) => send(res, 200, await getEvents(req.query))));
app.get('/api/analytics', wrap(async (_req, res) => send(res, 200, await getAnalytics())));
app.post('/api/refresh', wrap(async (_req, res) => send(res, 200, await refresh())));
app.get('/api/refresh', wrap(async (_req, res) => send(res, 200, await refresh())));
app.get('/api/calendar', wrap(async (req, res) => {
  const data = await getEvents(req.query || {});
  const toIcsDate = (v) => (v ? v.replace(/[-:]/g, '').split('.')[0] + 'Z' : null);
  const esc = (t = '') => String(t).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const now = toIcsDate(new Date().toISOString());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Paradise Glitch//Leeds Social Radar//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Leeds Social Radar'];
  for (const e of data.events || []) {
    if (!e.startAt) continue;
    const dtStart = toIcsDate(e.startAt);
    const dtEnd = toIcsDate(e.endAt) || dtStart;
    lines.push('BEGIN:VEVENT', `UID:${e.id}@paradise-glitch.co.uk`, `DTSTAMP:${now}`, `DTSTART:${dtStart}`, `DTEND:${dtEnd}`, `SUMMARY:${esc(e.title)}`, `LOCATION:${esc(e.venue || e.address || 'Leeds')}`, `DESCRIPTION:${esc(e.description || '')}`, `URL:${e.url}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="leeds-social-radar.ics"');
  res.status(200).send(lines.join('\r\n'));
}));
app.get('/api/cron', wrap(async (req, res) => {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return send(res, 401, fail('AUTH', 'Invalid cron secret'));
  }
  const result = await refresh({ force: true });
  send(res, 200, { ok: true, count: result.events.length, updatedAt: result.updatedAt, errors: result.errors });
}));
app.get('/api/health', wrap(async (_req, res) => {
  const data = await getEvents({});
  send(res, 200, { ok: true, events: data.events.length, updatedAt: data.updatedAt, sources: data.sources, errors: data.errors, durationMs: data.durationMs });
}));
app.get('/widget', (_req, res) => res.sendFile(path.join(publicDir, 'widget.html')));
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});
app.use((err, _req, res, _next) => send(res, 500, fail('INTERNAL', err.message || 'Unexpected error')));

export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Paradise Glitch Radar → http://localhost:${PORT}`);
    refresh().catch(console.error);
  });
}
