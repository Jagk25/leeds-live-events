import * as cheerio from 'cheerio';

const CACHE_MS = Math.max(5, Number(process.env.CACHE_MINUTES || 15)) * 60_000;
const BUDGET_MS = 8000;
const enabled = new Set(
  (process.env.ENABLED_SOURCES || 'meetup,visit-leeds,eventbrite,fatsoma,skiddle,leeds-uni')
    .split(',').map((s) => s.trim()).filter(Boolean),
);

let state = { events: [], updatedAt: null, errors: [], refreshing: false, sources: {} };

const MEETUP_GROUPS = [
  'leeds-nerds', 'chilled-out-meetups-leeds', 'leeds-living', 'leeds-digital',
  'leeds-digital-health', 'yorkshire-devops', 'leedsjs', 'leeds-js',
  'ladies-of-code-leeds', 'aws-leeds', 'west-yorkshire-25-45s-hiking-group',
  'terrible-football-leeds', 'horsforth-board-games', 'leeds-tabletop-rpg',
  'leeds-active', 'getsocial-leeds', 'leeds-international-language-exchange',
  'leeds-pool-squad', 'the-bad-mittens',
];
const MEETUP_LISTINGS = 'https://www.meetup.com/find/gb--45--leeds/';

const SOURCES = {
  'visit-leeds': 'https://www.visitleeds.co.uk/whats-on/all-events/',
  eventbrite: 'https://www.eventbrite.co.uk/d/united-kingdom--leeds/events/',
  fatsoma: 'https://www.fatsoma.com/l/gb/leeds',
  skiddle: 'https://www.skiddle.com/whats-on/Leeds/',
  'leeds-uni': 'https://www.leeds.ac.uk/events',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const SKIP = /^(home|events?|tickets?|view event|check ticket|explore more|see more|learn more|log in|sign up|search|menu|whats? on|leeds|discover|categories)$/i;
const DATE_RE = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+\d{1,2}\s+[A-Z][a-z]+(?:\s+\d{4})?(?:\s+[\d:]{4,5}\s*(?:AM|PM)?)?|\b\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+(?:\s+\d{4})?(?:,\s*[\d:]{4,5}(?:am|pm)?)?/i;

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const iso = (d) => {
  if (!d) return null;
  const raw = String(d).trim();
  if (/^\d{8}T\d{6}/.test(raw)) {
    const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
    if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`).toISOString();
  }
  const x = new Date(raw);
  return Number.isNaN(x.getTime()) ? null : x.toISOString();
};
const idFor = (e) => Buffer.from(`${e.source}|${e.url || ''}|${e.title}`).toString('base64url');
const rank = (e) => (e.source === 'meetup' ? 0 : 1);
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

async function page(url, ms = 4500) {
  const res = await fetch(url, {
    headers: {
      'user-agent': UA,
      accept: 'text/calendar, application/rss+xml, application/xml, text/xml, text/html;q=0.9,*/*;q=0.8',
      'accept-language': 'en-GB,en;q=0.9',
    },
    signal: AbortSignal.timeout(ms),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function unfoldIcs(text) {
  return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

function parseIcs(text, source) {
  const out = [];
  const blocks = unfoldIcs(text).split(/BEGIN:VEVENT/i).slice(1);
  for (const block of blocks) {
    const field = (name) => block.match(new RegExp(`^${name}[^:]*:(.+)$`, 'im'))?.[1]?.replace(/\\n/g, ' ').replace(/\\,/g, ',');
    pushEvent(out, {
      source,
      title: field('SUMMARY'),
      url: field('URL') || field('UID'),
      startAt: field('DTSTART'),
      endAt: field('DTEND'),
      venue: field('LOCATION'),
      description: field('DESCRIPTION'),
    });
  }
  return out;
}

function parseRss(text, source) {
  const out = [];
  const $ = cheerio.load(text, { xmlMode: true });
  $('item').each((_, item) => {
    const title = clean($(item).find('title').first().text());
    const url = clean($(item).find('link').first().text() || $(item).find('guid').first().text());
    const stamp = $(item).find('pubDate, dc\\:date, ev\\:startdate').first().text();
    const desc = clean($(item).find('description').first().text());
    const date = stamp || desc.match(DATE_RE)?.[0];
    pushEvent(out, { source, title, url, startAt: date, description: desc, venue: 'Leeds Meetup' });
  });
  return out;
}

function walkJson(node, source, out, depth = 0) {
  if (!node || depth > 7) return;
  if (Array.isArray(node)) return node.forEach((item) => walkJson(item, source, out, depth + 1));
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
    if (source === 'meetup') return /meetup\.com\/[^/]+\/events\//.test(url);
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
    const heading = clean($(a).find('h1,h2,h3,h4,[class*="title"]').first().text());
    const title = heading || clean($(a).attr('aria-label') || '') || clean($(a).text()).split(/\n|\u00b7/).map(clean).find((t) => t.length > 6 && t.length < 140 && !SKIP.test(t));
    const date = clean($(a).closest('article,li,section,div').text()).match(DATE_RE)?.[0];
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
    pushEvent(out, { source, title, url, startAt: clean(block.text()).match(DATE_RE)?.[0] });
  });
  return out;
}

async function parsePage(name, url, ms) {
  const html = await page(url, ms);
  if (/BEGIN:VCALENDAR/i.test(html)) return parseIcs(html, name);
  if (/<rss|<feed/i.test(html)) return parseRss(html, name);
  const merged = [...embeddedJson(html, name), ...cards(html, name, url)];
  const keys = new Set();
  return merged.filter((e) => !keys.has(idFor(e)) && keys.add(idFor(e)));
}

async function meetupFeeds(slug) {
  const urls = [
    `https://www.meetup.com/${slug}/events/ical/`,
    `https://www.meetup.com/${slug}/events/rss/`,
  ];
  const bags = await Promise.allSettled(urls.map((url) => parsePage('meetup', url, 3500)));
  return bags.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

async function scrapeMeetup() {
  const jobs = [
    parsePage('meetup', MEETUP_LISTINGS, 6000),
    ...MEETUP_GROUPS.map((slug) => meetupFeeds(slug)),
  ];
  const bags = await Promise.allSettled(jobs);
  const events = bags.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const keys = new Set();
  const unique = events.filter((e) => !keys.has(idFor(e)) && keys.add(idFor(e)));
  if (!unique.length) throw new Error('Meetup iCal/RSS/listings returned no events');
  return unique;
}

function sortEvents(events) {
  return [...events].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    return (a.startAt || '9999').localeCompare(b.startAt || '9999');
  }).map((event) => ({ ...event, id: idFor(event) }));
}

function finalize(events, errors, sources) {
  const keys = new Set();
  const unique = sortEvents(events.filter((event) => !keys.has(idFor(event)) && keys.add(idFor(event))));
  state = { events: unique.length ? unique : state.events, updatedAt: new Date().toISOString(), errors, refreshing: false, sources };
  return state;
}

export async function refresh() {
  if (state.refreshing) return state;
  state.refreshing = true;
  const errors = [];
  const sources = {};
  const events = [];

  if (enabled.has('meetup')) {
    try {
      const found = await scrapeMeetup();
      sources.meetup = found.length;
      events.push(...found);
    } catch (error) {
      sources.meetup = 0;
      errors.push({ source: 'meetup', message: String(error.message || error) });
    }
  }

  const others = Object.entries(SOURCES).filter(([name]) => enabled.has(name));
  await Promise.race([
    Promise.all(others.map(async ([name, url]) => {
      try {
        const found = await parsePage(name, url, 4000);
        sources[name] = found.length;
        events.push(...found);
        if (!found.length) errors.push({ source: name, message: 'Fetched page but found no event cards' });
      } catch (error) {
        sources[name] = 0;
        errors.push({ source: name, message: String(error.message || error) });
      }
    })),
    new Promise((resolve) => setTimeout(resolve, BUDGET_MS)),
  ]);
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
    events: sortEvents(state.events.filter((event) => {
      const hay = `${event.title} ${event.venue} ${event.description}`.toLowerCase();
      return (!q || hay.includes(q)) && (!sourceName || event.source === sourceName);
    })),
  };
}
