import * as cheerio from 'cheerio';
import { safeFetch, logError } from './core.js';

const CACHE_MS = Math.max(5, Number(process.env.CACHE_MINUTES || 15)) * 60_000;
const BUDGET_MS = 8000;
const MIN_REFRESH_GAP_MS = 3 * 60_000;
const enabled = new Set(
  (process.env.ENABLED_SOURCES || 'meetup,visit-leeds,eventbrite,fatsoma,skiddle,leeds-uni')
    .split(',').map((s) => s.trim()).filter(Boolean),
);

let state = {
  events: [],
  updatedAt: null,
  errors: [],
  refreshing: false,
  sources: {},
  durationMs: null,
  throttled: false,
  undated: {},
};
let lastAttempt = 0;

const MEETUP_GROUPS = [
  'getsocial-leeds', 'get-social-leeds', 'leeds-nerds', 'chilled-out-meetups-leeds',
  'leeds-living', 'leeds-digital', 'leeds-digital-health', 'yorkshire-devops',
  'leedsjs', 'leeds-js', 'ladies-of-code-leeds', 'aws-leeds',
  'west-yorkshire-25-45s-hiking-group', 'terrible-football-leeds',
  'horsforth-board-games', 'leeds-tabletop-rpg', 'leeds-active',
  'leeds-international-language-exchange', 'leeds-pool-squad', 'the-bad-mittens',
];
const MEETUP_LISTINGS = 'https://www.meetup.com/find/gb--45--leeds/';
const SOURCES = {
  'visit-leeds': 'https://www.visitleeds.co.uk/whats-on/all-events/',
  eventbrite: 'https://www.eventbrite.co.uk/d/united-kingdom--leeds/events/',
  fatsoma: 'https://www.fatsoma.com/l/gb/leeds',
  skiddle: 'https://www.skiddle.com/whats-on/Leeds/',
  'leeds-uni': 'https://www.leeds.ac.uk/events',
};

const REGIONAL_SOURCES = new Set(['skiddle', 'eventbrite', 'fatsoma']);
const OTHER_YORKSHIRE_CITIES = /\b(doncaster|sheffield|rochdale|bradford|wakefield|huddersfield|halifax|harrogate|holmfirth|barnsley|rotherham|castleford|pontefract|dewsbury|batley|keighley|scarborough|hull|kingston upon hull)\b/i;
const LEEDS_HINT = /\bleeds\b|\bls\d{1,2}\b/i;

const SKIP = /^(home|events?|tickets?|view event|check ticket|explore more|see more|learn more|log in|sign up|search|menu|whats? on|leeds|discover|categories)$/i;
const DATE_RE = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}(?:\s+\d{4})?(?:[, ]+[\d:]{4,5}\s*(?:AM|PM|am|pm)?)?|\b\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}(?:\s+\d{4})?(?:[, ]+[\d:]{4,5}(?:am|pm)?)?/;

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

// Explicit UK-format human date parser. JS `new Date()` is unreliable for
// strings like "Sat 22 Aug, 10:00" (day-before-month, no year) and silently
// returns Invalid Date on many engines instead of throwing.
export function parseHumanDate(raw, now = new Date()) {
  if (!raw) return null;
  const str = String(raw).trim();
  const m = str.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})(?:\s+(\d{4}))?(?:[, ]+(\d{1,2}):(\d{2})\s*(am|pm)?)?/i);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (month === undefined || day < 1 || day > 31) return null;
  let year = m[3] ? parseInt(m[3], 10) : now.getFullYear();
  let hour = m[4] ? parseInt(m[4], 10) : 19;
  const minute = m[5] ? parseInt(m[5], 10) : 0;
  const ampm = m[6]?.toLowerCase();
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  let dt = new Date(Date.UTC(year, month, day, hour, minute));
  if (!m[3] && dt.getTime() < now.getTime() - 86_400_000) {
    dt = new Date(Date.UTC(year + 1, month, day, hour, minute));
  }
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

export const iso = (d) => {
  if (!d) return null;
  const raw = String(d).trim();
  if (/^\d{8}T\d{6}/.test(raw)) {
    const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
    if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const x = new Date(raw);
    if (!Number.isNaN(x.getTime())) return x.toISOString();
  }
  return parseHumanDate(raw);
};

function canonicalUrl(url) {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch { return url; }
}
const normTitle = (t) => clean(t).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const idFor = (e) => Buffer.from(`${e.source}|${canonicalUrl(e.url || '')}|${normTitle(e.title)}|${(e.startAt || '').slice(0, 10)}`).toString('base64url');
const rank = (e) => {
  if (/getsocial/i.test(`${e.url} ${e.title} ${e.venue}`)) return 0;
  if (e.source === 'meetup') return 1;
  return 2;
};
export const getState = () => state;
const stale = () => !state.updatedAt || Date.now() - Date.parse(state.updatedAt) > CACHE_MS;

function isLikelyLeeds(event) {
  if (!REGIONAL_SOURCES.has(event.source)) return true;
  const place = `${event.venue || ''} ${event.address || ''}`;
  if (OTHER_YORKSHIRE_CITIES.test(place) && !LEEDS_HINT.test(place) && !LEEDS_HINT.test(event.title || '')) return false;
  return true;
}

function pushEvent(out, event, undatedCounter) {
  const title = clean(event.title);
  if (!title || title.length < 6 || title.length > 180 || SKIP.test(title)) return;
  if (!event.url) return;
  const startAt = iso(event.startAt);
  if (!startAt) {
    if (undatedCounter) undatedCounter.count += 1;
    return; // drop undated listings from the board per spec
  }
  const candidate = {
    source: event.source,
    title,
    url: canonicalUrl(event.url),
    image: event.image || null,
    startAt,
    endAt: iso(event.endAt),
    venue: clean(event.venue),
    address: clean(event.address) || 'Leeds',
    description: clean(event.description).slice(0, 280),
    price: event.price ?? null,
    currency: event.currency || 'GBP',
    watch: /getsocial/i.test(`${event.url} ${title} ${event.venue || ''}`) ? 'getsocial' : null,
  };
  if (!isLikelyLeeds(candidate)) return;
  out.push(candidate);
}

function unfoldIcs(text) {
  return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

function parseIcs(text, source, undatedCounter) {
  const out = [];
  const blocks = unfoldIcs(text).split(/BEGIN:VEVENT/i).slice(1);
  for (const block of blocks) {
    const field = (name) => block.match(new RegExp(`^${name}[^:]*:(.+)$`, 'im'))?.[1]?.replace(/\\n/g, ' ').replace(/\\,/g, ',');
    pushEvent(out, {
      source, title: field('SUMMARY'), url: field('URL') || field('UID'),
      startAt: field('DTSTART'), endAt: field('DTEND'), venue: field('LOCATION'), description: field('DESCRIPTION'),
    }, undatedCounter);
  }
  return out;
}

function parseRss(text, source, undatedCounter) {
  const out = [];
  const $ = cheerio.load(text, { xmlMode: true });
  $('item').each((_, item) => {
    const title = clean($(item).find('title').first().text());
    const url = clean($(item).find('link').first().text() || $(item).find('guid').first().text());
    const stamp = $(item).find('pubDate, dc\\:date, ev\\:startdate').first().text();
    const desc = clean($(item).find('description').first().text());
    pushEvent(out, { source, title, url, startAt: stamp || desc.match(DATE_RE)?.[0], description: desc, venue: 'Leeds Meetup' }, undatedCounter);
  });
  return out;
}

function walkJson(node, source, out, undatedCounter, depth = 0) {
  if (!node || depth > 7) return;
  if (Array.isArray(node)) return node.forEach((item) => walkJson(item, source, out, undatedCounter, depth + 1));
  if (typeof node !== 'object') return;
  const types = [].concat(node['@type'] || []);
  const title = node.name || node.title || node.eventName;
  const url = typeof node.url === 'string' ? node.url : node.url?.url || node.eventUrl || node.link;
  const start = node.startDate || node.start_date || node.startTime || node.dateTime || node.start;
  if (title && url && (types.includes('Event') || start || source === 'meetup')) {
    const loc = node.location || node.venue || {};
    pushEvent(out, {
      source, title, url, startAt: start,
      endAt: node.endDate || node.end_date,
      venue: loc.name || loc.venue,
      address: loc.address?.addressLocality || loc.city || loc.address || 'Leeds',
      description: node.description,
      image: node.image?.url || node.image,
    }, undatedCounter);
  }
  for (const value of Object.values(node)) if (value && typeof value === 'object') walkJson(value, source, out, undatedCounter, depth + 1);
}

function embeddedJson(html, source, undatedCounter) {
  const out = [];
  const $ = cheerio.load(html);
  $('script[type="application/ld+json"], script#__NEXT_DATA__').each((_, el) => {
    try { walkJson(JSON.parse($(el).text()), source, out, undatedCounter); } catch {}
  });
  return out;
}

function isEventUrl(url, source, base) {
  try {
    const u = new URL(url);
    const p = u.pathname.toLowerCase();
    if (source === 'eventbrite') return /\/e\//.test(p);
    if (source === 'fatsoma') return /\/e\//.test(p);
    if (source === 'meetup') return /meetup\.com\/[^/]+\/events\//.test(url);
    if (source === 'skiddle') return /whats-on\/.+\/\d+/.test(p);
    if (source === 'leeds-uni') {
      const baseHost = new URL(base).hostname;
      if (u.hostname !== baseHost) return false;
      return p !== '/' && p !== '/events' && p !== '/events/' && !/\.(png|jpg|jpeg|svg|css|js|pdf)$/.test(p);
    }
    return /whats-on|\/event|\/e\//.test(p);
  } catch { return false; }
}

function cards(html, source, base, undatedCounter) {
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    if (!href) return;
    let url; try { url = new URL(href, base).href; } catch { return; }
    if (!isEventUrl(url, source, base) || seen.has(url)) return;
    seen.add(url);
    const heading = clean($(a).find('h1,h2,h3,h4,[class*="title"]').first().text());
    const title = heading || clean($(a).attr('aria-label') || '') || clean($(a).text()).split(/\n|\u00b7/).map(clean).find((t) => t.length > 6 && t.length < 140 && !SKIP.test(t));
    if (!title) return;
    pushEvent(out, { source, title, url, startAt: clean($(a).closest('article,li,section,div').text()).match(DATE_RE)?.[0] }, undatedCounter);
  });
  return out;
}

async function parsePage(name, url, ms) {
  const html = await safeFetch(url, { timeout: ms, retries: 1 });
  const undatedCounter = { count: 0 };
  let events;
  if (/BEGIN:VCALENDAR/i.test(html)) events = parseIcs(html, name, undatedCounter);
  else if (/<rss|<feed/i.test(html)) events = parseRss(html, name, undatedCounter);
  else events = [...embeddedJson(html, name, undatedCounter), ...cards(html, name, url, undatedCounter)];
  const keys = new Set();
  const unique = events.filter((e) => !keys.has(idFor(e)) && keys.add(idFor(e)));
  return { events: unique, undated: undatedCounter.count };
}

async function meetupFeeds(slug) {
  const urls = [`https://www.meetup.com/${slug}/events/ical/`, `https://www.meetup.com/${slug}/events/rss/`];
  const bags = await Promise.allSettled(urls.map((url) => parsePage('meetup', url, 3500)));
  return bags.flatMap((r) => (r.status === 'fulfilled' ? r.value.events : []));
}

async function scrapeMeetup() {
  const jobs = [parsePage('meetup', MEETUP_LISTINGS, 6000).then((r) => r.events), ...MEETUP_GROUPS.map((slug) => meetupFeeds(slug))];
  const bags = await Promise.allSettled(jobs);
  const events = bags.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const keys = new Set();
  return events.filter((e) => !keys.has(idFor(e)) && keys.add(idFor(e)));
}

function sortEvents(events) {
  return [...events].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    return (a.startAt || '9999').localeCompare(b.startAt || '9999');
  }).map((event) => ({ ...event, id: idFor(event) }));
}

function finalize(events, errors, sources, started, undated) {
  const keys = new Set();
  const unique = sortEvents(events.filter((event) => !keys.has(idFor(event)) && keys.add(idFor(event))));
  state = {
    events: unique.length ? unique : state.events,
    updatedAt: new Date().toISOString(),
    errors,
    refreshing: false,
    sources,
    durationMs: Date.now() - started,
    throttled: false,
    undated,
  };
  return state;
}

export async function refresh({ force = false } = {}) {
  if (state.refreshing) return state;
  if (!force && lastAttempt && Date.now() - lastAttempt < MIN_REFRESH_GAP_MS && state.updatedAt) {
    return { ...state, throttled: true, retryInMs: MIN_REFRESH_GAP_MS - (Date.now() - lastAttempt) };
  }
  lastAttempt = Date.now();
  state.refreshing = true;
  const started = Date.now();
  const errors = [];
  const sources = {};
  const undated = {};
  const events = [];
  try {
    if (enabled.has('meetup')) {
      try {
        const found = await scrapeMeetup();
        sources.meetup = found.length;
        events.push(...found);
        if (!found.length) errors.push({ source: 'meetup', message: 'Meetup feeds returned no events' });
      } catch (error) {
        sources.meetup = 0;
        errors.push(logError('meetup', error));
      }
    }
    const others = Object.entries(SOURCES).filter(([name]) => enabled.has(name));
    await Promise.race([
      Promise.all(others.map(async ([name, url]) => {
        try {
          const result = await parsePage(name, url, 4000);
          sources[name] = result.events.length;
          undated[name] = result.undated;
          events.push(...result.events);
          if (!result.events.length) errors.push({ source: name, message: 'Fetched page but found no dated event cards' });
        } catch (error) {
          sources[name] = 0;
          errors.push(logError(name, error));
        }
      })),
      new Promise((resolve) => setTimeout(resolve, BUDGET_MS)),
    ]);
    return finalize(events, errors, sources, started, undated);
  } catch (error) {
    state.refreshing = false;
    state.errors = [logError('refresh', error)];
    state.updatedAt = state.updatedAt || new Date().toISOString();
    state.durationMs = Date.now() - started;
    return state;
  }
}

export async function getEvents(query = {}) {
  if (stale()) {
    try { await refresh(); } catch (error) {
      state.refreshing = false;
      state.updatedAt = state.updatedAt || new Date().toISOString();
      state.errors = [logError('refresh', error)];
    }
  }
  const q = String(query.q || '').toLowerCase();
  const sourceName = String(query.source || '');
  return {
    ...state,
    events: sortEvents(state.events.filter((event) => {
      const hay = `${event.title} ${event.venue} ${event.description}`.toLowerCase();
      return (!q || hay.includes(q)) && (!sourceName || event.source === sourceName);
    })),
  };
}

export async function getAnalytics() {
  const data = await getEvents({});
  const events = data.events || [];
  const groups = new Map();
  let evening = 0;
  let thuSat = 0;
  const getsocial = [];
  for (const event of events) {
    const start = event.startAt ? new Date(event.startAt) : null;
    const hour = start && !Number.isNaN(start) ? start.getHours() : null;
    const dow = start && !Number.isNaN(start) ? start.getDay() : null;
    if (hour === null || hour >= 17) evening += 1;
    if (dow === 4 || dow === 5 || dow === 6) thuSat += 1;
    if (event.watch === 'getsocial' || /getsocial/i.test(`${event.url} ${event.title}`)) getsocial.push(event);
    const slug = String(event.url || '').match(/meetup\.com\/([^/?#]+)/i)?.[1];
    if (slug && !['find', 'topics', 'events'].includes(slug.toLowerCase())) {
      const key = slug.toLowerCase();
      groups.set(key, (groups.get(key) || 0) + 1);
    }
  }
  const topGroups = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([slug, count]) => ({ slug, count, name: slug.replace(/-/g, ' ') }));
  const undatedTotal = Object.values(data.undated || {}).reduce((a, b) => a + b, 0);
  return {
    ok: true,
    updatedAt: data.updatedAt,
    durationMs: data.durationMs,
    totals: { events: events.length, evening, thuSat, getsocial: getsocial.length, undated: undatedTotal },
    sources: data.sources || {},
    undated: data.undated || {},
    errors: data.errors || [],
    topGroups,
    getsocial: {
      count: getsocial.length,
      next: getsocial.find((e) => e.startAt) || null,
      events: getsocial.slice(0, 8),
    },
  };
}
