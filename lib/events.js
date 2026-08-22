import * as cheerio from 'cheerio';

const CACHE_MS = Math.max(5, Number(process.env.CACHE_MINUTES || 15)) * 60_000;
const BUDGET_MS = 8000;
const enabled = new Set(
  (process.env.ENABLED_SOURCES || 'visit-leeds,eventbrite,fatsoma,meetup,skiddle,leeds-uni')
    .split(',').map((s) => s.trim()).filter(Boolean),
);

let state = { events: [], updatedAt: null, errors: [], refreshing: false, sources: {} };

const SOURCES = {
  'visit-leeds': 'https://www.visitleeds.co.uk/whats-on/all-events/',
  eventbrite: 'https://www.eventbrite.co.uk/d/united-kingdom--leeds/events/',
  fatsoma: 'https://www.fatsoma.com/l/gb/leeds',
  meetup: 'https://www.meetup.com/find/?location=gb--leeds&source=EVENTS',
  skiddle: 'https://www.skiddle.com/whats-on/Leeds/',
  'leeds-uni': 'https://www.leeds.ac.uk/events',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const SKIP = /^(home|events?|tickets?|view event|check ticket|explore more|see more|learn more|log in|sign up|search|menu|whats? on|leeds|discover|categories)$/i;
const DATE_RE = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+\d{1,2}\s+[A-Z][a-z]+(?:\s+\d{4})?(?:\s+[\d:]{4,5}\s*(?:AM|PM)?)?|\b\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+(?:\s+\d{4})?(?:,\s*[\d:]{4,5}(?:am|pm)?)?/i;

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const iso = (d) => {
  if (!d) return null;
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? null : x.toISOString();
};
const idFor = (e) => Buffer.from(`${e.source}|${e.url || ''}|${e.title}`).toString('base64url');
export const getState = () => state;
const stale = () => !state.updatedAt || Date.now() - Date.parse(state.updatedAt) > CACHE_MS;

function pushEvent(out, event) {
  const title = clean(event.title);
  if (!title || title.length < 6 || title.length > 180 || SKIP.test(title)) return;
  if (!event.url) return;
  out.push({
    source: event.source,
    title,
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

async function page(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'accept-language': 'en-GB,en;q=0.9',
      'cache-control': 'no-cache',
    },
    signal: AbortSignal.timeout(4500),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function walkJson(node, source, out, depth = 0) {
  if (!node || depth > 7) return;
  if (Array.isArray(node)) return node.forEach((item) => walkJson(item, source, out, depth + 1));
  if (typeof node !== 'object') return;
  const types = [].concat(node['@type'] || []);
  const title = node.name || node.title || node.eventName;
  const url = typeof node.url === 'string' ? node.url : node.url?.url || node.eventUrl || node.link;
  const start = node.startDate || node.start_date || node.startTime || node.dateTime || node.start;
  if (title && url && (types.includes('Event') || start)) {
    const loc = node.location || node.venue || {};
    pushEvent(out, {
      source, title, url, startAt: start,
      endAt: node.endDate || node.end_date,
      venue: loc.name || loc.venue,
      address: loc.address?.addressLocality || loc.city || loc.address,
      description: node.description,
      image: node.image?.url || node.image,
      price: node.offers?.price ?? node.price,
    });
  }
  for (const value of Object.values(node)) if (value && typeof value === 'object') walkJson(value, source, out, depth + 1);
}

function embeddedJson(html, source) {
  const out = [];
  const $ = cheerio.load(html);
  $('script[type="application/ld+json"], script#__NEXT_DATA__').each((_, el) => {
    try { walkJson(JSON.parse($(el).text()), source, out); } catch {}
  });
  return out;
}

function isEventUrl(url, source) {
  try {
    const p = new URL(url).pathname.toLowerCase();
    if (source === 'eventbrite') return /\/e\//.test(p);
    if (source === 'fatsoma') return /\/e\//.test(p);
    if (source === 'meetup') return /\/events\//.test(p);
    if (source === 'skiddle') return /whats-on\/.+\/\d+/.test(p);
    if (source === 'leeds-uni') return /\/events?\//.test(p);
    return /whats-on|\/event|\/e\//.test(p);
  } catch { return false; }
}

function cards(html, source, base) {
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    if (!href) return;
    let url; try { url = new URL(href, base).href; } catch { return; }
    if (!isEventUrl(url, source) || seen.has(url)) return;
    seen.add(url);
    const $a = $(a);
    const heading = clean($a.find('h1,h2,h3,h4,[class*="title"]').first().text());
    const title = heading || clean($a.attr('aria-label') || '') || clean($a.text()).split(/\n|\u00b7/).map(clean).find((t) => t.length > 6 && t.length < 140 && !SKIP.test(t));
    const date = clean($a.closest('article,li,section,div').text()).match(DATE_RE)?.[0];
    pushEvent(out, { source, title, url, startAt: date });
  });
  $('h2,h3,h4').each((_, el) => {
    const title = clean($(el).text());
    const block = $(el).parent();
    const href = $(el).closest('a').attr('href') || block.find('a[href]').first().attr('href');
    if (!href) return;
    let url; try { url = new URL(href, base).href; } catch { return; }
    if (seen.has(url)) return;
    seen.add(url);
    const date = clean(block.text()).match(DATE_RE)?.[0];
    pushEvent(out, { source, title, url, startAt: date, venue: clean(block.find('p').eq(1).text()) });
  });
  return out;
}

async function source(name, url) {
  const html = await page(url);
  const merged = [...embeddedJson(html, name), ...cards(html, name, url)];
  const keys = new Set();
  return merged.filter((e) => {
    const id = idFor(e);
    if (keys.has(id)) return false;
    keys.add(id);
    return true;
  });
}

function finalize(events, errors, sources) {
  const keys = new Set();
  const unique = events.filter((event) => {
    const id = idFor(event);
    if (keys.has(id)) return false;
    keys.add(id);
    return true;
  }).map((event) => ({ ...event, id: idFor(event) }))
    .sort((a, b) => (a.startAt || '9999').localeCompare(b.startAt || '9999'));
  state = {
    events: unique.length || state.events,
    updatedAt: new Date().toISOString(),
    errors,
    refreshing: false,
    sources,
  };
  if (unique.length) state.events = unique;
  return state;
}

export async function refresh() {
  if (state.refreshing) return state;
  state.refreshing = true;
  const jobs = Object.entries(SOURCES).filter(([name]) => enabled.has(name));
  const errors = [];
  const sources = {};
  const events = [];
  const work = Promise.all(jobs.map(async ([name, url]) => {
    try {
      const found = await source(name, url);
      sources[name] = found.length;
      events.push(...found);
      if (!found.length) errors.push({ source: name, message: 'Fetched page but found no event cards' });
    } catch (error) {
      sources[name] = 0;
      errors.push({ source: name, message: String(error.message || error) });
    }
  }));
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, BUDGET_MS))]);
  return finalize(events, errors, sources);
}

export async function getEvents(query = {}) {
  if (stale()) {
    try { await refresh(); } catch (error) {
      state.refreshing = false;
      state.updatedAt = state.updatedAt || new Date().toISOString();
      state.errors = [{ source: 'refresh', message: String(error.message || error) }];
    }
  }
  const q = String(query.q || '').toLowerCase();
  const sourceName = String(query.source || '');
  return {
    ...state,
    events: state.events.filter((event) => {
      const hay = `${event.title} ${event.venue} ${event.description}`.toLowerCase();
      return (!q || hay.includes(q)) && (!sourceName || event.source === sourceName);
    }),
  };
}
