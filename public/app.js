const $ = (s) => document.querySelector(s);
const esc = (value = '') => { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; };
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- Theme engine ---
const THEME_KEY = 'pg_theme';
const CUSTOM_KEY = 'pg_custom_colors';
function loadJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } }
function saveJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
function applyCustomColors(map) {
  if (map.accent) document.documentElement.style.setProperty('--pink', map.accent);
  if (map.highlight) document.documentElement.style.setProperty('--gold', map.highlight);
  if (map.bg) document.documentElement.style.setProperty('--bg', map.bg);
}
function setTheme(name) {
  document.documentElement.setAttribute('data-theme', name === 'signal' ? '' : name);
  saveJson(THEME_KEY, name);
  document.querySelectorAll('.theme-swatch').forEach((b) => b.classList.toggle('active', b.dataset.theme === name));
}
try {
  const savedTheme = loadJson(THEME_KEY, 'signal');
  setTheme(savedTheme);
  const custom = loadJson(CUSTOM_KEY, {});
  applyCustomColors(custom);
  if (custom.accent) $('#colorAccent')?.setAttribute('value', custom.accent);
  if (custom.highlight) $('#colorHighlight')?.setAttribute('value', custom.highlight);
  if (custom.bg) $('#colorBg')?.setAttribute('value', custom.bg);
  document.querySelectorAll('.theme-swatch').forEach((btn) => { btn.onclick = () => setTheme(btn.dataset.theme); });
  function bindColor(id, key) {
    const input = $(id);
    if (!input) return;
    input.oninput = () => {
      const map = loadJson(CUSTOM_KEY, {});
      map[key] = input.value;
      saveJson(CUSTOM_KEY, map);
      applyCustomColors(map);
    };
  }
  bindColor('#colorAccent', 'accent');
  bindColor('#colorHighlight', 'highlight');
  bindColor('#colorBg', 'bg');
  $('#resetTheme')?.addEventListener('click', () => {
    saveJson(CUSTOM_KEY, {});
    document.documentElement.style.removeProperty('--pink');
    document.documentElement.style.removeProperty('--gold');
    document.documentElement.style.removeProperty('--bg');
    setTheme('signal');
  });
} catch (e) { console.error('Theme init failed', e); }

// --- Share widget + sidebar drawer (wired early, defensively) ---
try {
  const shareBtn = $('#shareBtn');
  const shareModal = $('#shareModal');
  const embedCode = $('#embedCode');
  const openWidget = $('#openWidget');
  const closeModal = $('#closeModal');
  const copyEmbed = $('#copyEmbed');
  const widgetUrl = `${location.origin}/widget.html`;
  if (shareBtn && shareModal) {
    shareBtn.onclick = () => {
      if (embedCode) embedCode.value = `<iframe src="${widgetUrl}" width="320" height="420" style="border:0;border-radius:14px;overflow:hidden" loading="lazy"></iframe>`;
      if (openWidget) openWidget.href = widgetUrl;
      shareModal.classList.remove('hidden');
    };
  }
  if (closeModal && shareModal) closeModal.onclick = () => shareModal.classList.add('hidden');
  if (shareModal) shareModal.addEventListener('click', (e) => { if (e.target === shareModal) shareModal.classList.add('hidden'); });
  if (copyEmbed && embedCode) {
    copyEmbed.onclick = async () => {
      embedCode.select();
      try { await navigator.clipboard.writeText(embedCode.value); } catch { try { document.execCommand('copy'); } catch {} }
      const original = copyEmbed.textContent;
      copyEmbed.textContent = 'Copied!';
      setTimeout(() => { copyEmbed.textContent = original; }, 1600);
    };
  }
  const sidebar = $('#sidebar');
  const scrim = $('#sidebarScrim');
  const toggle = $('#sidebarToggle');
  function closeSidebar() { sidebar?.classList.remove('open'); scrim?.classList.remove('visible'); }
  function openSidebar() { sidebar?.classList.add('open'); scrim?.classList.add('visible'); }
  if (toggle) toggle.onclick = () => (sidebar?.classList.contains('open') ? closeSidebar() : openSidebar());
  if (scrim) scrim.onclick = closeSidebar;
} catch (e) { console.error('UI wiring failed', e); }

const fmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const dateShortFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const RIVALS = /chilled out|getsocial|leeds living|leeds nerds|so.?social|weroad|language exchange|mixer|speed dating|young professional|20s-40s|25-45/i;
const CATS = {
  social: /social|mixer|meetup|friends|network|chat|drinks|community|collective/i,
  tech: /tech|digital|dev|aws|python|javascript|data|ai|startup/i,
  music: /gig|dj|club|rave|concert|live music|karaoke/i,
  games: /game|board|nerd|rpg|dungeons|quiz/i,
  outdoors: /hike|walk|run|rambl|cycle|outdoor/i,
  dating: /dating|singles|speed date/i,
  arts: /art|theatre|gallery|film|comedy|poetry/i,
};
const PALETTE = ['#ff3d7f', '#f0c36a', '#5ad1a6', '#5ab0ff', '#c792ea', '#ff8a5c'];
const GROUP_COLOR_KEY = 'pg_group_colors';
const CARD_COLOR_KEY = 'pg_card_colors';
const PINNED_KEY = 'pg_pinned_groups';
const VIEWS_KEY = 'pg_saved_views';
const PIN_COLOR = '#f0c36a';

let all = [];
let analytics = null;
let view = 'board';
let month = new Date(2026, 8, 1);
let timer;
let quickFilter = null;
let groupColors = loadJson(GROUP_COLOR_KEY, {});
let cardColors = loadJson(CARD_COLOR_KEY, {});
let pinnedGroups = new Set(loadJson(PINNED_KEY, []));
let savedViews = loadJson(VIEWS_KEY, []);

function setGroupColor(slug, color) { if (color) groupColors[slug] = color; else delete groupColors[slug]; saveJson(GROUP_COLOR_KEY, groupColors); paint(); }
function cycleCardColor(id) {
  const current = cardColors[id];
  const idx = current ? PALETTE.indexOf(current) : -1;
  const next = idx + 1 < PALETTE.length ? PALETTE[idx + 1] : null;
  if (next) cardColors[id] = next; else delete cardColors[id];
  saveJson(CARD_COLOR_KEY, cardColors);
  paint();
}
function togglePin(slug) {
  if (pinnedGroups.has(slug)) pinnedGroups.delete(slug); else pinnedGroups.add(slug);
  saveJson(PINNED_KEY, [...pinnedGroups]);
  paint();
}

function groupSlug(event) {
  const match = String(event.url || '').match(/meetup\.com\/([^/?#]+)/i);
  if (!match) return null;
  const slug = decodeURIComponent(match[1]).toLowerCase();
  return ['find', 'topics', 'events', 'cities', 'login'].includes(slug) ? null : slug;
}
function groupName(slug) { return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }
function normTitle(t) { return (t || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim(); }

function enrich(event) {
  const hay = `${event.title} ${event.venue} ${event.description} ${event.source}`;
  const start = event.startAt ? new Date(event.startAt) : null;
  const valid = start && !Number.isNaN(start.getTime());
  const hour = valid ? start.getHours() : null;
  const dow = valid ? start.getDay() : null;
  const categories = Object.entries(CATS).filter(([, re]) => re.test(hay)).map(([k]) => k);
  if (!categories.length) categories.push('social');
  const slug = groupSlug(event);
  const getsocial = event.watch === 'getsocial' || /getsocial/i.test(hay + (slug || ''));
  return {
    ...event, start, hour, dow,
    evening: hour === null || hour >= 17,
    thuSat: dow === 4 || dow === 5 || dow === 6,
    rival: RIVALS.test(hay) || event.source === 'meetup',
    categories, slug, getsocial,
    groupColor: slug ? groupColors[slug] : null,
    cardColor: cardColors[event.id] || null,
    pinned: slug ? pinnedGroups.has(slug) : false,
  };
}
function cardBorderColor(event) {
  if (event.cardColor) return event.cardColor;
  if (event.pinned) return PIN_COLOR;
  if (event.groupColor) return event.groupColor;
  return null;
}

function sameDay(a, b) { return a && b && a.toDateString() === b.toDateString(); }
function isWeekendDow(d) { return d === 5 || d === 6 || d === 0; }

function selected() {
  const q = $('#q').value.toLowerCase();
  const source = $('#source').value;
  const category = $('#category').value;
  const when = $('#when').value;
  const evening = $('#evening').checked;
  const thuSat = $('#thuSat').checked;
  const rivals = $('#rivals').checked;
  const taggedOnly = $('#tagged').checked;
  const now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + 7);
  let list = all.filter((event) => {
    const hay = `${event.title} ${event.venue} ${event.description}`.toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (source && event.source !== source) return false;
    if (category && !event.categories.includes(category)) return false;
    if (evening && event.hour !== null && !event.evening) return false;
    if (thuSat && event.dow !== null && !event.thuSat) return false;
    if (rivals && !event.rival) return false;
    if (taggedOnly && !event.groupColor && !event.cardColor) return false;
    if (when === 'week' && event.start && (event.start < now || event.start > weekEnd)) return false;
    if (when === 'weekend' && !isWeekendDow(event.dow)) return false;
    if (when === 'september' && (!event.start || event.start.getMonth() !== 8 || event.start.getFullYear() !== 2026)) return false;
    if (quickFilter === 'tonight' && !(sameDay(event.start, now) && event.evening)) return false;
    if (quickFilter === 'tomorrow' && !sameDay(event.start, tomorrow)) return false;
    if (quickFilter === 'weekend' && !isWeekendDow(event.dow)) return false;
    if (quickFilter === 'free' && event.price !== 0) return false;
    return true;
  });
  const sortOrder = $('#sortOrder')?.value || 'relevance';
  if (sortOrder === 'az') list = [...list].sort((a, b) => a.title.localeCompare(b.title));
  else if (sortOrder === 'soonest') list = [...list].sort((a, b) => (a.start?.getTime() || 9e15) - (b.start?.getTime() || 9e15));
  return list;
}

function topGroups(events) {
  const map = new Map();
  for (const event of events) {
    if (!event.slug) continue;
    const row = map.get(event.slug) || { slug: event.slug, name: groupName(event.slug), count: 0, next: null, getsocial: /getsocial/i.test(event.slug) };
    row.count += 1;
    if (event.start && (!row.next || event.start < row.next.start)) row.next = event;
    map.set(event.slug, row);
  }
  return [...map.values()].sort((a, b) => {
    const pinA = pinnedGroups.has(a.slug) ? 1 : 0;
    const pinB = pinnedGroups.has(b.slug) ? 1 : 0;
    if (pinA !== pinB) return pinB - pinA;
    return Number(b.getsocial) - Number(a.getsocial) || b.count - a.count;
  }).slice(0, 8);
}

// --- Departure board: real multi-row split-flap with per-character diff flip ---
const FLAP_ROWS = 8;
const COLW = { time: 11, event: 30, venue: 15, status: 6 };
let flapPage = 0;
let flapPrev = null;
let flapTimer = null;

function padCell(str, len) { return (str || '').toString().toUpperCase().slice(0, len).padEnd(len, ' '); }
function statusFor(e) {
  if (e.getsocial) return 'RIVAL';
  if (e.pinned) return 'PIN';
  if (!e.start) return 'TBA';
  const diffH = (e.start.getTime() - Date.now()) / 3_600_000;
  if (diffH < 0) return 'LIVE';
  if (diffH < 3) return 'SOON';
  if (diffH < 24) return 'TODAY';
  return 'OPEN';
}
function renderFlapBoard(events) {
  const container = $('#flapRows');
  const pageEl = $('#flapPage');
  if (!container) return;
  const dated = [...events].filter((e) => e.start).sort((a, b) => a.start - b.start);
  const totalPages = Math.max(1, Math.ceil(dated.length / FLAP_ROWS));
  flapPage = Math.min(flapPage, totalPages - 1);
  const pageEvents = dated.slice(flapPage * FLAP_ROWS, flapPage * FLAP_ROWS + FLAP_ROWS);
  if (!pageEvents.length) {
    container.innerHTML = '<div class="flap-empty">NO SCHEDULED DEPARTURES IN THIS FILTER</div>';
    flapPrev = null;
    if (pageEl) pageEl.textContent = '0/0';
    clearInterval(flapTimer);
    return;
  }
  const rows = pageEvents.map((e) => ({
    time: padCell(dateShortFmt.format(e.start), COLW.time),
    event: padCell(e.title, COLW.event),
    venue: padCell(e.venue || e.source, COLW.venue),
    status: padCell(statusFor(e), COLW.status),
    url: e.url,
  }));
  container.innerHTML = rows.map((r, ri) => {
    const prevRow = flapPrev && flapPrev[ri];
    const fieldsHtml = ['time', 'event', 'venue', 'status'].map((f) => {
      const str = r[f];
      const prevStr = prevRow ? prevRow[f] : null;
      const cells = [...str].map((ch, ci) => {
        const changed = prevStr ? prevStr[ci] !== ch : false;
        const display = ch === ' ' ? '&nbsp;' : esc(ch);
        return `<span class="flap-cell${changed && !reduceMotion ? ' flip' : ''}" style="animation-delay:${ci * 14}ms">${display}</span>`;
      }).join('');
      return `<div class="flap-field flap-${f}">${cells}</div>`;
    }).join('');
    return `<a class="flap-row" href="${esc(r.url)}" target="_blank" rel="noopener">${fieldsHtml}</a>`;
  }).join('');
  flapPrev = rows;
  if (pageEl) pageEl.textContent = `${flapPage + 1}/${totalPages}`;
  clearInterval(flapTimer);
  if (!reduceMotion && totalPages > 1) {
    flapTimer = setInterval(() => { flapPage = (flapPage + 1) % totalPages; paint(); }, 7000);
  }
}
try {
  $('.flap-controls .tk-prev')?.addEventListener('click', () => { flapPage = Math.max(0, flapPage - 1); paint(); });
  $('.flap-controls .tk-next')?.addEventListener('click', () => { flapPage += 1; paint(); });
} catch {}

function renderWatch(events) {
  const gs = events.filter((e) => e.getsocial).sort((a, b) => (a.start || 0) - (b.start || 0));
  if (!gs.length) { $('#watch').innerHTML = `<span class="tag">watch</span> GetSocial Leeds — no listings in this filter. Still ranks first when it appears.`; return; }
  const next = gs[0];
  $('#watch').innerHTML = `<span class="tag">watch · ${gs.length}</span> GetSocial Leeds — next ${next.start ? fmt.format(next.start) : 'date on listing'}: ${esc(next.title)} · <a href="${esc(next.url)}" target="_blank" rel="noopener">open ↗</a>`;
}
function swatchRow(slug, current) {
  return `<div class="swatches" data-slug="${esc(slug)}">` +
    `<button type="button" class="swatch none ${!current ? 'active' : ''}" data-color="" title="No tag"></button>` +
    PALETTE.map((c) => `<button type="button" class="swatch ${current === c ? 'active' : ''}" style="background:${c}" data-color="${c}" title="${c}"></button>`).join('') +
    `</div>`;
}
function renderGroups(events) {
  const groups = topGroups(events);
  $('#groups').innerHTML = groups.length ? groups.map((g, i) => {
    const color = groupColors[g.slug];
    const pinned = pinnedGroups.has(g.slug);
    return `<div class="group-row ${g.getsocial ? 'watch-hit' : ''} ${pinned ? 'pinned' : ''}" style="${color ? `border-left-color:${color}` : ''}">
      <div class="g-top"><span class="tag">#${i + 1}${g.getsocial ? ' · gs' : ''}</span><button type="button" class="pin-btn ${pinned ? 'active' : ''}" data-slug="${esc(g.slug)}" title="Pin to top">${pinned ? '★' : '☆'}</button></div>
      <h3>${esc(g.name)}</h3>
      <p class="desc">${g.count} in filter · ${g.next?.start ? fmt.format(g.next.start) : 'dates on Meetup'}</p>
      ${swatchRow(g.slug, color)}
      <a href="https://www.meetup.com/${esc(g.slug)}/" target="_blank" rel="noopener">Open ↗</a>
    </div>`;
  }).join('') : '<p class="hint">No Meetup groups in this filter yet.</p>';
  $('#groups').querySelectorAll('.swatch').forEach((btn) => {
    btn.onclick = (ev) => { ev.stopPropagation(); setGroupColor(btn.closest('.swatches').dataset.slug, btn.dataset.color || null); };
  });
  $('#groups').querySelectorAll('.pin-btn').forEach((btn) => { btn.onclick = () => togglePin(btn.dataset.slug); });
}

function seriesKey(e) { return `${e.source}::${normTitle(e.title)}::${(e.venue || '').toLowerCase()}`; }
function groupSeries(events) {
  const map = new Map();
  for (const e of events) {
    const key = seriesKey(e);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  }
  return [...map.values()].map((list) => {
    list.sort((a, b) => (a.start?.getTime() || 0) - (b.start?.getTime() || 0));
    return { primary: list[0], more: list.slice(1) };
  });
}
function renderBoard(events) {
  const root = $('#board'); root.innerHTML = '';
  for (const { primary: event, more } of groupSeries(events).slice(0, 200)) {
    const node = $('#row').content.cloneNode(true);
    node.querySelector('.col-time .tag').textContent = `${event.source}${event.getsocial ? ' · gs' : event.rival ? ' · rival' : ''}`;
    node.querySelector('.col-time .when').textContent = event.start ? fmt.format(event.start) : 'Date on listing';
    node.querySelector('h2').textContent = event.title;
    node.querySelector('.venue').textContent = [event.venue, event.address].filter(Boolean).join(' · ');
    node.querySelector('.col-open').href = event.url;
    const dot = node.querySelector('.card-color-dot');
    const border = cardBorderColor(event);
    if (event.cardColor) dot.style.background = event.cardColor;
    dot.onclick = () => cycleCardColor(event.id);
    const row = node.querySelector('.event-row');
    if (event.getsocial || (event.rival && event.thuSat && event.evening)) row.classList.add('clash');
    if (border) row.style.borderLeftColor = border;
    if (more.length) {
      const toggle = node.querySelector('.series-toggle');
      const moreEl = node.querySelector('.series-more');
      toggle.classList.remove('hidden');
      toggle.textContent = `+${more.length} more ▾`;
      toggle.onclick = () => {
        const open = !moreEl.classList.contains('hidden');
        moreEl.classList.toggle('hidden', open);
        toggle.textContent = open ? `+${more.length} more ▾` : `Hide extra dates ▴`;
      };
      moreEl.innerHTML = more.slice(0, 12).map((m) => `<a href="${esc(m.url)}" target="_blank" rel="noopener">${m.start ? esc(fmt.format(m.start)) : 'date on listing'}</a>`).join('');
    }
    root.append(node);
  }
}

function monthMatrix(base) {
  const start = new Date(base.getFullYear(), base.getMonth(), 1);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  const pad = (start.getDay() + 6) % 7;
  const days = [];
  for (let i = 0; i < pad; i += 1) days.push(null);
  for (let d = 1; d <= end.getDate(); d += 1) days.push(new Date(base.getFullYear(), base.getMonth(), d));
  return days;
}
function renderCalendar(events) {
  const days = monthMatrix(month);
  const title = month.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
  $('#calendar').innerHTML = `<div class="cal-head"><button type="button" id="prevMonth">←</button><h2>${esc(title)}</h2><button type="button" id="nextMonth">→</button></div><div class="cal-grid">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d) => `<p class="dow">${d}</p>`).join('')}${days.map((day) => {
    if (!day) return '<div class="cell empty"></div>';
    const items = events.filter((e) => e.start && e.start.toDateString() === day.toDateString());
    const clashes = items.filter((e) => e.rival && e.evening);
    const heat = clashes.length >= 4 ? 'hot' : clashes.length ? 'warm' : items.length ? 'cool' : '';
    return `<button type="button" class="cell ${heat} ${[4,5,6].includes(day.getDay()) ? 'mixer-day' : ''}" data-day="${day.toISOString()}"><strong>${day.getDate()}</strong><span>${items.length} ev</span><em>${clashes.length || ''}</em></button>`;
  }).join('')}</div><div id="dayList"></div>`;
  $('#prevMonth').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); paint(); };
  $('#nextMonth').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); paint(); };
  $('#calendar').querySelectorAll('[data-day]').forEach((btn) => { btn.onclick = () => showDay(new Date(btn.dataset.day), events); });
}
function showDay(day, events) {
  const items = events.filter((e) => e.start && e.start.toDateString() === day.toDateString());
  $('#dayList').innerHTML = `<h3>${esc(dayFmt.format(day))}</h3>` + (items.length ? items.map((e) => `<a class="row ${e.getsocial || (e.rival && e.evening) ? 'clash' : ''}" style="${cardBorderColor(e) ? `border-left:3px solid ${cardBorderColor(e)}` : ''}" href="${esc(e.url)}" target="_blank" rel="noopener"><strong>${esc(e.title)}</strong><span>${e.start ? fmt.format(e.start) : ''} · ${esc(e.source)}${e.getsocial ? ' · GetSocial' : ''}</span></a>`).join('') : '<p>Clear Paradise Glitch slot.</p>');
}
function renderRadar(events) {
  const start = new Date(); start.setHours(0,0,0,0);
  const slots = [];
  for (let i = 0; i < 56; i += 1) {
    const day = new Date(start); day.setDate(start.getDate() + i);
    if (![4,5,6].includes(day.getDay())) continue;
    const items = events.filter((e) => e.start && e.start.toDateString() === day.toDateString() && e.evening);
    const rivals = items.filter((e) => e.rival);
    const status = rivals.length >= 3 ? 'Clash' : rivals.length ? 'Busy' : 'Clear';
    slots.push({ day, items, rivals, status });
  }
  $('#radar').innerHTML = `<p class="hint">Thursday–Saturday evenings. Green nights first.</p><div class="slots">${slots.map((slot) => `<article class="slot ${slot.status.toLowerCase()}"><p class="tag">${slot.status}</p><h2>${esc(dayFmt.format(slot.day))}</h2><p class="desc">${slot.rivals.length} rival · ${slot.items.length} total</p><ul>${slot.rivals.slice(0,4).map((e) => `<li><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a></li>`).join('') || '<li>No obvious competitor</li>'}</ul></article>`).join('')}</div>`;
}
function renderAnalytics() {
  const a = analytics;
  if (!a) { $('#analytics').innerHTML = '<p class="hint">Analytics warming up…</p>'; return; }
  $('#analytics').innerHTML = `<div class="stats">
    <div class="stat"><p class="tag">Events</p><strong>${a.totals?.events || 0}</strong></div>
    <div class="stat"><p class="tag">Evenings</p><strong>${a.totals?.evening || 0}</strong></div>
    <div class="stat"><p class="tag">Thu–Sat</p><strong>${a.totals?.thuSat || 0}</strong></div>
    <div class="stat"><p class="tag">GetSocial</p><strong>${a.totals?.getsocial || 0}</strong></div>
    <div class="stat"><p class="tag">Undated (dropped)</p><strong>${a.totals?.undated || 0}</strong></div>
    <div class="stat"><p class="tag">Scrape</p><strong>${a.durationMs ? Math.round(a.durationMs / 100) / 10 + 's' : '—'}</strong></div>
  </div>
  <p class="hint">Sources: ${Object.entries(a.sources || {}).map(([k,v]) => k + ' ' + v).join(' · ') || 'none'}</p>
  <p class="hint">Undated per source: ${Object.entries(a.undated || {}).map(([k,v]) => k + ' ' + v).join(' · ') || 'none'}</p>
  <p class="hint">${(a.errors || []).length ? 'Soft errors: ' + a.errors.map((e) => e.source || e.scope).join(', ') : 'All sources answered.'}</p>
  <p class="tag" style="margin-top:14px;display:block">GetSocial next</p>
  <p>${a.getsocial?.next ? esc(a.getsocial.next.title) + ' · ' + (a.getsocial.next.startAt ? fmt.format(new Date(a.getsocial.next.startAt)) : '') : 'No dated GetSocial event in the current scrape.'}</p>`;
}

// --- Quick filter chips + saved views ---
function renderQuickChips() {
  document.querySelectorAll('#quickChips .chip').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.quick === quickFilter);
    btn.onclick = () => { quickFilter = quickFilter === btn.dataset.quick ? null : btn.dataset.quick; paint(); };
  });
}
function currentFilterSnapshot() {
  return {
    q: $('#q').value, source: $('#source').value, category: $('#category').value, when: $('#when').value,
    sortOrder: $('#sortOrder').value, evening: $('#evening').checked, thuSat: $('#thuSat').checked,
    rivals: $('#rivals').checked, tagged: $('#tagged').checked, quickFilter,
  };
}
function applyFilterSnapshot(snap) {
  $('#q').value = snap.q || ''; $('#source').value = snap.source || ''; $('#category').value = snap.category || '';
  $('#when').value = snap.when || ''; $('#sortOrder').value = snap.sortOrder || 'relevance';
  $('#evening').checked = !!snap.evening; $('#thuSat').checked = !!snap.thuSat;
  $('#rivals').checked = !!snap.rivals; $('#tagged').checked = !!snap.tagged;
  quickFilter = snap.quickFilter || null;
  load();
}
function renderPresetChips() {
  const wrap = $('#presetChips');
  if (!wrap) return;
  wrap.innerHTML = savedViews.map((v, i) => `<span class="chip preset-chip" data-idx="${i}">${esc(v.name)} <span class="del" data-del="${i}">×</span></span>`).join('');
  wrap.querySelectorAll('.preset-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      if (e.target.dataset.del !== undefined) {
        savedViews.splice(Number(e.target.dataset.del), 1);
        saveJson(VIEWS_KEY, savedViews);
        renderPresetChips();
        return;
      }
      applyFilterSnapshot(savedViews[Number(chip.dataset.idx)].filters);
    });
  });
}
try {
  $('#savePreset')?.addEventListener('click', () => {
    const name = $('#presetName')?.value.trim();
    if (!name) return;
    savedViews.push({ name, filters: currentFilterSnapshot() });
    saveJson(VIEWS_KEY, savedViews);
    $('#presetName').value = '';
    renderPresetChips();
  });
} catch {}

function paint() {
  renderQuickChips();
  const events = selected();
  $('#legend').textContent = `${events.length} matching · ★ pinned promotes to top · dot cycles a custom card color · gold border = pinned/clash risk`;
  renderFlapBoard(events);
  renderWatch(events);
  renderGroups(events);
  $('#board').classList.toggle('hidden', view !== 'board');
  $('#calendar').classList.toggle('hidden', view !== 'calendar');
  $('#radar').classList.toggle('hidden', view !== 'radar');
  $('#analytics').classList.toggle('hidden', view !== 'analytics');
  if (view === 'board') renderBoard(events);
  if (view === 'calendar') renderCalendar(events);
  if (view === 'radar') renderRadar(events);
  if (view === 'analytics') renderAnalytics();
}
async function load() {
  try {
    const params = new URLSearchParams();
    if ($('#q').value) params.set('q', $('#q').value);
    if ($('#source').value) params.set('source', $('#source').value);
    const [eventsRes, analyticsRes] = await Promise.all([
      fetch('/api/events?' + params),
      fetch('/api/analytics'),
    ]);
    const data = await eventsRes.json();
    analytics = analyticsRes.ok ? await analyticsRes.json() : null;
    all = (data.events || []).map(enrich);
    $('#status').textContent = `Updated ${data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString('en-GB') : 'never'} · ${data.events?.length || 0} listings`;
    $('#errors').innerHTML = data.errors?.length ? `<p class="warn">Soft source errors: ${data.errors.map((x) => esc(x.source || x.scope)).join(', ')}</p>` : '';
    paint();
  } catch (error) {
    $('#status').textContent = 'The room went quiet.';
    $('#errors').innerHTML = `<p class="warn">${esc(error.message)}. Retry refresh — the last good cache stays if we have one.</p>`;
  }
}
document.querySelectorAll('.views button').forEach((btn) => {
  btn.onclick = () => {
    view = btn.dataset.view;
    document.querySelectorAll('.views button').forEach((b) => b.classList.toggle('active', b === btn));
    paint();
  };
});
['q','source','category','when','sortOrder','evening','thuSat','rivals','tagged'].forEach((id) => {
  $('#' + id)?.addEventListener(id === 'q' ? 'input' : 'change', () => {
    clearTimeout(timer);
    timer = setTimeout(id === 'q' ? load : paint, id === 'q' ? 250 : 0);
  });
});
$('#refresh').onclick = async () => {
  const button = $('#refresh'); button.disabled = true; const original = button.textContent; button.textContent = '…';
  try { await fetch('/api/refresh', { method: 'POST' }); } catch {}
  button.disabled = false; button.textContent = original; load();
};

renderPresetChips();
load();
setInterval(load, 120000);
