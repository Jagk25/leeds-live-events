import express from 'express';
import * as cheerio from 'cheerio';

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_MS = Math.max(5, Number(process.env.CACHE_MINUTES || 15)) * 60_000;
const enabled = new Set(
  (process.env.ENABLED_SOURCES || 'visit-leeds,eventbrite,fatsoma,meetup').split(',').map((s) => s.trim()).filter(Boolean),
);

let state = { events: [], updatedAt: null, errors: [], refreshing: false };

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const iso = (d) => {
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? null : x.toISOString();
};
const idFor = (e) => Buffer.from(`${e.source}|${e.url || ''}|${e.title}|${e.startAt || ''}`).toString('base64url');
const stale = () => !state.updatedAt || Date.now() - Date.parse(state.updatedAt) > CACHE_MS;

async function page(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'LeedsLiveEvents/1.1 (+https://github.com/Jagk25/leeds-live-events)',
      'accept-language': 'en-GB,en;q=0.8',
      accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function jsonldEvents(html, source) {
  const $ = cheerio.load(html);
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node['@graph']) return walk(node['@graph']);
    const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    if (types.includes('Event')) {
      const place = node.location || {};
      const address = place.address || {};
      out.push({
        source,
        title: clean(node.name),
        url: node.url || null,
        image: node.image?.url || node.image || null,
        startAt: iso(node.startDate),
        endAt: iso(node.endDate),
        venue: clean(place.name),
        address: clean([address.streetAddress, address.addressLocality || 'Leeds'].filter(Boolean).join(', ')),
        description: clean(node.description),
        price: node.offers?.price ?? null,
        currency: node.offers?.priceCurrency || 'GBP',
      });
    }
    if (node && typeof node === 'object') Object.values(node).forEach((value) => {
      if (value && typeof value === 'object') walk(value);
    });
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try { walk(JSON.parse($(el).text())); } catch {}
  });
  return out;
}

function cards(html, source, base) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const out = [];
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    const title = clean($(a).text());
    if (!href || title.length < 6 || title.length > 160) return;
    let url;
    try { url = new URL(href, base).href; } catch { return; }
    if (!/event|\/e\/|tickets|gig|meetup\.com\/.+\/events/i.test(url) || seen.has(url)) return;
    seen.add(url);
    const box = $(a).closest('article,li,section,div').text();
    const date = box.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.?\s+\d{1,2}\s+[A-Z][a-z]+(?:\s+\d{4})?|\b\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\s+\d{4}/i)?.[0];
    out.push({
      source,
      title,
      url,
      image: null,
      startAt: iso(date),
      endAt: null,
      venue: null,
      address: 'Leeds',
      description: '',
      price: null,
      currency: 'GBP',
    });
  });
  return out.slice(0, 80);
}

async function source(name, url) {
  const html = await page(url);
  const structured = jsonldEvents(html, name);
  return structured.length ? structured : cards(html, name, url);
}

async function refresh() {
  if (state.refreshing) return state;
  state.refreshing = true;
  const jobs = [];
  if (enabled.has('visit-leeds')) jobs.push(['visit-leeds', 'https://www.visitleeds.co.uk/whats-on/all-events/']);
  if (enabled.has('eventbrite')) jobs.push(['eventbrite', 'https://www.eventbrite.co.uk/d/united-kingdom--leeds/events/']);
  if (enabled.has('fatsoma')) jobs.push(['fatsoma', 'https://www.fatsoma.com/l/gb/leeds']);
  if (enabled.has('meetup')) jobs.push(['meetup', 'https://www.meetup.com/find/?location=gb--leeds&source=EVENTS']);

  const results = await Promise.allSettled(jobs.map(([, url]) => source(...)));
  const errors = [];
  let events = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') events.push(...result.value);
    else errors.push({ source: jobs[i][0], message: String(result.reason?.message || result.reason) });
  });

  const keys = new Set();
  events = events
    .filter((event) => event.title && event.url)
    .filter((event) => {
      const id = idFor(event);
      if (keys.has(id)) return false;
      keys.add(id);
      return true;
    })
    .map((event) => ({ ...event, id: idFor(event) }))
    .sort((a, b) => (a.startAt || '9999').localeCompare(b.startAt || '9999'));

  state = { events, updatedAt: new Date().toISOString(), errors, refreshing: false };
  return state;
}

function authorizeCron(req) {
  if (!process.env.CRON_SECRET) return true;
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

function payload(req) {
  const q = String(req.query.q || '').toLowerCase();
  const sourceName = String(req.query.source || '');
  const events = state.events.filter((event) => {
    const hay = `${event.title} ${event.venue} ${event.description}`.toLowerCase();
    return (!q || hay.includes(q)) && (!sourceName || event.source === sourceName);
  });
  return { ...state, events };
}

app.get('/api/events', async (req, res) => {
  try {
    if (stale()) await refresh();
  } catch (error) {
    if (!state.events.length) state.errors = [{ source: 'refresh', message: String(error.message || error) }];
  }
  res.set('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
  res.json(payload(req));
});

app.post('/api/refresh', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await refresh());
});

app.get('/api/cron', async (req, res) => {
  if (!authorizeCron(req)) return res.status(401).json({ ok: false });
  const result = await refresh();
  res.json({ ok: true, count: result.events.length, updatedAt: result.updatedAt, errors: result.errors });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, events: state.events.length, updatedAt: state.updatedAt });
});

export default app;

if (!process.env.VERCEL) {
  app.use(express.static('public'));
  app.listen(PORT, () => {
    console.log(`Leeds Live Events → http://localhost:${PORT}`);
    refresh().catch((error) => console.error(error));
  });
}
