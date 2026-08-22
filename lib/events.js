import * as cheerio from 'cheerio';

const CACHE_MS = Math.max(5, Number(process.env.CACHE_MINUTES || 15)) * 60_000;
const enabled = new Set(
  (process.env.ENABLED_SOURCES || 'visit-leeds,eventbrite,fatsoma,meetup,skiddle')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

let state = { events: [], updatedAt: null, errors: [], refreshing: false, sources: {} };

const SOURCES = {
  'visit-leeds': 'https://www.visitleeds.co.uk/whats-on/all-events/',
  eventbrite: 'https://www.eventbrite.co.uk/d/united-kingdom--leeds/events/',
  fatsoma: 'https://www.fatsoma.com/l/gb/leeds',
  meetup: 'https://www.meetup.com/find/?location=gb--leeds&source=EVENTS',
  skiddle: 'https://www.skiddle.com/whats-on/Leeds/',
};

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const iso = (d) => {
  if (!d) return null;
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? null : x.toISOString();
};
const idFor = (e) => Buffer.from(`${e.source}|${e.url || ''}|${e.title}`).toString('base64url');
export const stale = () => !state.updatedAt || Date.now() - Date.parse(state.updatedAt) > CACHE_MS;
export const getState = () => state;

const SKIP = /^(home|events?|tickets?|view event|check ticket|explore more|see more|learn more|log in|sign up|search|menu|whats? on|leeds)$/i;

function isEventUrl(url, source) {
  try {
    const u = new URL(url);
    const p = u.pathname.toLowerCase();
    if (source === 'eventbrite') return /\/e\/|\/events?\//.test(p);
    if (source === 'fatsoma') return /\/e\//.test(p);
    if (source === 'meetup') return /\/events\//.test(p);
    if (source === 'visit-leeds') return /whats-on|\/event/.test(p);
    if (source === 'skiddle') return /whats-on|\/e\//.test(p);
    return /event|\/e\/|tickets|gig/.test(p);
  } catch {
    return false;
  }
}

async function page(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; LeedsLiveEvents/1.2; +https://github.com/Jagk25/leeds-live-events)',
      'accept-language': 'en-GB,en;q=0.9',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(9000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function pushEvent(out, event) {
  const title = clean(event.title);
  if (!title || title.length < 4 || SKIP.test(title)) return;
  if (!event.url) return;
  out.push({
    source: event.source,
    title: title.slice(0, 180),
    url: event.url,
    image: event.image || null,
    startAt: iso(event.startAt),
    endAt: iso(event.endAt),
    venue: clean(event.venue),
    address: clean(event.address) || 'Leeds',
    description: clean(event.description).slice(0, 280),
    price: event.price ?? null,
    currency: event.currency || 'GBP',
  });
}

function walkJson(node, source, out, depth = 0) {
  if (!node || depth > 8) return;
  if (Array.isArray(node)) return node.forEach((item) => walkJson(item, source, out, depth + 1));
  if (typeof node !== 'object') return;
  const types = [].concat(node['@type'] || []);
  const title = node.name || node.title || node.eventName;
  const url = node.url || node.eventUrl || node.link || node.vanityUrl;
  const start = node.startDate || node.start_date || node.startTime || node.dateTime || node.start;
  if ((types.includes('Event') || (title && url && start)) && title && url) {
    const loc = node.location || node.venue || {};
    pushEvent(out, {
      source,
      title,
      url: typeof url === 'string' ? url : url.url,
      image: node.image?.url || node.image || node.logo?.url,
      startAt: start,
      endAt: node.endDate || node.end_date,
      venue: loc.name || loc.venue,
      address: loc.address?.addressLocality || loc.address?.city || loc.city || loc.address,
      description: node.description,
      price: node.offers?.price ?? node.price,
    });
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') walkJson(value, source, out, depth + 1);
  }
}

function embeddedJson(html, source) {
  const out = [];
  const $ = cheerio.load(html);
  $('script[type="application/ld+json"], script#__NEXT_DATA__, script[id*="__NEXT_DATA__"]').each((_, el) => {
    try { walkJson(JSON.parse($(el).text()), source, out); } catch {}
  });
  const blobs = html.match(/window\.__SERVER_DATA__\s*=\s*(\{[\s\S]*?\});/);
  if (blobs?.[1]) {
    try { walkJson(JSON.parse(blobs[1]), source, out); } catch {}
  }
  return out;
}

function cards(html, source, base) {
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    if (!href) return;
    let url;
    try { url = new URL(href, base).href; } catch { return; }
    if (!isEventUrl(url, source) || seen.has(url)) return;
    seen.add(url);
    const $a = $(a);
    const heading = clean($a.find('h1,h2,h3,h4,[class*="title"],[class*="name"],[data-testid*="title"]').first().text());
    const labelled = clean($a.attr('aria-label') || $a.attr('title') || '');
    const title = heading || labelled || clean($a.text()).split(/\n|\u00b7|\|/).map(clean).find((t) => t.length > 4 && t.length < 140 && !SKIP.test(t));
    const box = clean($a.closest('article,li,section,div').text());
    const date = box.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+\d{1,2}\s+[A-Z][a-z]+(?:\s+\d{4})?(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?|\b\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\s+\d{4}|Tomorrow at \d{1,2}:\d{2}|Today at \d{1,2}:\d{2}/i)?.[0];
    pushEvent(out, { source, title, url, startAt: date, venue: null, address: 'Leeds' });
  });
  return out;
}

async function source(name, url) {
  const html = await page(url);
  const structured = embeddedJson(html, name);
  const loose = cards(html, name, url);
  const merged = [...structured, ...loose];
  if (!merged.length) throw new Error(`${name} returned HTML (${html.length} bytes) but no events`);
  return { events: merged, bytes: html.length };
}

export async function refresh() {
  if (state.refreshing) return state;
  state.refreshing = true;
  const jobs = Object.entries(SOURCES).filter(([name]) => enabled.has(name));
  const results = await Promise.allSettled(jobs.map(([name, url]) => source(name, url)));
  const errors = [];
  const sources = {};
  let events = [];
  results.forEach((result, i) => {
    const name = jobs[i][0];
    if (result.status === 'fulfilled') {
      sources[name] = result.value.events.length;
      events.push(...result.value.events);
    } else {
      sources[name] = 0;
      errors.push({ source: name, message: String(result.reason?.message || result.reason) });
    }
  });

  const keys = new Set();
  events = events.filter((event) => {
    const id = idFor(event);
    if (keys.has(id)) return false;
    keys.add(id);
    return true;
  }).map((event) => ({ ...event, id: idFor(event) }))
    .sort((a, b) => (a.startAt || '9999').localeCompare(b.startAt || '9999'));

  if (events.length || !state.events.length) {
    state = { events, updatedAt: new Date().toISOString(), errors, refreshing: false, sources };
  } else {
    state = { ...state, errors, refreshing: false, sources };
  }
  return state;
}

export async function getEvents(query = {}) {
  if (stale()) {
    try { await refresh(); } catch (error) {
      if (!state.events.length) state.errors = [{ source: 'refresh', message: String(error.message || error) }];
    }
  }
  const q = String(query.q || '').toLowerCase();
  const sourceName = String(query.source || '');
  const events = state.events.filter((event) => {
    const hay = `${event.title} ${event.venue} ${event.description}`.toLowerCase();
    return (!q || hay.includes(q)) && (!sourceName || event.source === sourceName);
  });
  return { ...state, events };
}
