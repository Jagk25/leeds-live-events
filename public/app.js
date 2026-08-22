const $ = (s) => document.querySelector(s);
const fmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
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
const COLOR_KEY = 'pg_group_colors';

let all = [];
let analytics = null;
let view = 'board';
let month = new Date(2026, 8, 1);
let timer;

function esc(value = '') {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}
function loadColors() {
  try { return JSON.parse(localStorage.getItem(COLOR_KEY) || '{}'); } catch { return {}; }
}
function saveColors(map) {
  try { localStorage.setItem(COLOR_KEY, JSON.stringify(map)); } catch {}
}
let groupColors = loadColors();
function setGroupColor(slug, color) {
  if (color) groupColors[slug] = color; else delete groupColors[slug];
  saveColors(groupColors);
  paint();
}
function groupSlug(event) {
  const match = String(event.url || '').match(/meetup\.com\/([^/?#]+)/i);
  if (!match) return null;
  const slug = decodeURIComponent(match[1]).toLowerCase();
  return ['find', 'topics', 'events', 'cities', 'login'].includes(slug) ? null : slug;
}
function groupName(slug) { return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }
function enrich(event) {
  const hay = `${event.title} ${event.venue} ${event.description} ${event.source}`;
  const start = event.startAt ? new Date(event.startAt) : null;
  const valid = start && !Number.isNaN(start.getTime());
  const hour = valid ? start.getHours() : null;
  const dow = valid ? start.getDay() : null;
  const categories = Object.entries(CATS).filter(([, re]) => re.test(hay)).map(([k]) => k);
  if (!categories.length) categories.push('social');
  const slug = groupSlug(event);
  return {
    ...event, start, hour, dow,
    evening: hour === null || hour >= 17,
    thuSat: dow === 4 || dow === 5 || dow === 6,
    rival: RIVALS.test(hay) || event.source === 'meetup',
    categories,
    slug,
    color: slug ? groupColors[slug] : null,
    getsocial: event.watch === 'getsocial' || /getsocial/i.test(hay + (slug || '')),
  };
}
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
  const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + 7);
  return all.filter((event) => {
    const hay = `${event.title} ${event.venue} ${event.description}`.toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (source && event.source !== source) return false;
    if (category && !event.categories.includes(category)) return false;
    if (evening && event.hour !== null && !event.evening) return false;
    if (thuSat && event.dow !== null && !event.thuSat) return false;
    if (rivals && !event.rival) return false;
    if (taggedOnly && !event.color) return false;
    if (when === 'week' && event.start && (event.start < now || event.start > weekEnd)) return false;
    if (when === 'weekend' && event.dow !== 5 && event.dow !== 6 && event.dow !== 0) return false;
    if (when === 'september' && (!event.start || event.start.getMonth() !== 8 || event.start.getFullYear() !== 2026)) return false;
    return true;
  });
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
  return [...map.values()].sort((a, b) => Number(b.getsocial) - Number(a.getsocial) || b.count - a.count).slice(0, 6);
}
function renderTicker(events) {
  const upcoming = [...events].filter((e) => e.start).sort((a, b) => a.start - b.start).slice(0, 14);
  const track = $('#ticker');
  if (!upcoming.length) { track.innerHTML = '<div class="ticker-track">NO SCHEDULED DEPARTURES IN THIS FILTER ···</div>'; return; }
  const cells = upcoming.map((e, i) => `<span class="flight-no">${String(i + 1).padStart(2, '0')}</span>${esc(timeFmt.format(e.start))} — ${esc(e.title.toUpperCase())} · ${esc((e.venue || e.source).toUpperCase())}<span class="sep">//</span>`).join(' ');
  track.innerHTML = `<div class="ticker-track">${cells}${cells}</div>`;
}
function renderWatch(events) {
  const gs = events.filter((e) => e.getsocial).sort((a, b) => (a.start || 0) - (b.start || 0));
  if (!gs.length) {
    $('#watch').innerHTML = `<p class="tag">01 // watch</p><h2>GetSocial Leeds</h2><p>No GetSocial listings in this filter. They still rank first when they appear.</p>`;
    return;
  }
  const next = gs[0];
  $('#watch').innerHTML = `<p class="tag">01 // watch</p><h2>GetSocial Leeds · ${gs.length} upcoming</h2><p class="when">Next: ${next.start ? fmt.format(next.start) : 'date on listing'}</p><p>${esc(next.title)}</p><a href="${esc(next.url)}" target="_blank" rel="noopener">Open their next night ↗</a>`;
}
function swatchRow(slug, current) {
  return `<div class="swatches" data-slug="${esc(slug)}">` +
    `<button type="button" class="swatch none ${!current ? 'active' : ''}" data-color="" title="No tag"></button>` +
    PALETTE.map((c) => `<button type="button" class="swatch ${current === c ? 'active' : ''}" style="background:${c}" data-color="${c}" title="${c}"></button>`).join('') +
    `</div>`;
}
function renderGroups(events) {
  const groups = topGroups(events);
  if (!groups.length) { $('#groups').innerHTML = '<p class="hint">No Meetup groups in this filter yet.</p>'; return; }
  $('#groups').innerHTML = groups.map((g, i) => {
    const color = groupColors[g.slug];
    return `<article class="group-card ${g.getsocial ? 'watch-hit' : ''}" style="${color ? `border-left-color:${color}` : ''}">
      <p class="tag">#${i + 1}${g.getsocial ? ' · getsocial' : ''}</p>
      <h3>${esc(g.name)}</h3>
      <p>${g.count} in this filter</p>
      <p class="when">${g.next?.start ? 'Next: ' + fmt.format(g.next.start) : 'Dates on Meetup'}</p>
      <p class="desc">${esc(g.next?.title || '')}</p>
      ${swatchRow(g.slug, color)}
      <a href="https://www.meetup.com/${esc(g.slug)}/" target="_blank" rel="noopener">Open group ↗</a>
    </article>`;
  }).join('');
  $('#groups').querySelectorAll('.swatch').forEach((btn) => {
    btn.onclick = () => setGroupColor(btn.closest('.swatches').dataset.slug, btn.dataset.color || null);
  });
}
function renderBoard(events) {
  const root = $('#board'); root.innerHTML = '';
  for (const event of events.slice(0, 180)) {
    const node = $('#card').content.cloneNode(true);
    node.querySelector('.tag').textContent = `${event.source}${event.getsocial ? ' · getsocial' : event.rival ? ' · rival' : ''}`;
    node.querySelector('h2').textContent = event.title;
    node.querySelector('.when').textContent = event.start ? fmt.format(event.start) : 'Date on listing';
    node.querySelector('.venue').textContent = [event.venue, event.address].filter(Boolean).join(' · ');
    node.querySelector('.desc').textContent = event.description?.slice(0, 180) || event.categories.join(', ');
    node.querySelector('a').href = event.url;
    const art = node.querySelector('article');
    if (event.getsocial || (event.rival && event.thuSat && event.evening)) art.classList.add('clash');
    if (event.color) art.style.borderLeftColor = event.color;
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
    return `<button type="button" class="cell ${heat} ${[4,5,6].includes(day.getDay()) ? 'mixer-day' : ''}" data-day="${day.toISOString()}"><strong>${day.getDate()}</strong><span>${items.length} events</span><em>${clashes.length ? clashes.length + ' rival evenings' : 'clear evening'}</em></button>`;
  }).join('')}</div><div id="dayList"></div>`;
  $('#prevMonth').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); paint(); };
  $('#nextMonth').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); paint(); };
  $('#calendar').querySelectorAll('[data-day]').forEach((btn) => { btn.onclick = () => showDay(new Date(btn.dataset.day), events); });
}
function showDay(day, events) {
  const items = events.filter((e) => e.start && e.start.toDateString() === day.toDateString());
  $('#dayList').innerHTML = `<h3>${esc(dayFmt.format(day))}</h3>` + (items.length ? items.map((e) => `<a class="row ${e.getsocial || (e.rival && e.evening) ? 'clash' : ''}" style="${e.color ? `border-left:3px solid ${e.color}` : ''}" href="${esc(e.url)}" target="_blank" rel="noopener"><strong>${esc(e.title)}</strong><span>${e.start ? fmt.format(e.start) : ''} · ${esc(e.source)}${e.getsocial ? ' · GetSocial' : ''}</span></a>`).join('') : '<p>Clear Paradise Glitch slot.</p>');
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
  $('#radar').innerHTML = `<p class="hint">Thursday–Saturday evenings for Core Socials. Green nights first.</p><div class="slots">${slots.map((slot) => `<article class="slot ${slot.status.toLowerCase()}"><p class="tag">${slot.status}</p><h2>${esc(dayFmt.format(slot.day))}</h2><p>${slot.rivals.length} rival evenings · ${slot.items.length} after 5pm</p><ul>${slot.rivals.slice(0,4).map((e) => `<li><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}${e.getsocial ? ' · GetSocial' : ''}</a></li>`).join('') || '<li>No obvious social competitor</li>'}</ul></article>`).join('')}</div>`;
}
function renderAnalytics() {
  const a = analytics;
  if (!a) { $('#analytics').innerHTML = '<p>Analytics warming up…</p>'; return; }
  $('#analytics').innerHTML = `<div class="stats">
    <div class="stat"><p class="tag">Events</p><strong>${a.totals?.events || 0}</strong></div>
    <div class="stat"><p class="tag">Evenings</p><strong>${a.totals?.evening || 0}</strong></div>
    <div class="stat"><p class="tag">Thu–Sat</p><strong>${a.totals?.thuSat || 0}</strong></div>
    <div class="stat"><p class="tag">GetSocial</p><strong>${a.totals?.getsocial || 0}</strong></div>
    <div class="stat"><p class="tag">Scrape</p><strong>${a.durationMs ? Math.round(a.durationMs / 100) / 10 + 's' : '—'}</strong></div>
  </div>
  <p class="hint">Sources: ${Object.entries(a.sources || {}).map(([k,v]) => k + ' ' + v).join(' · ') || 'none'}</p>
  <p class="hint">${(a.errors || []).length ? 'Soft errors: ' + a.errors.map((e) => e.source || e.scope).join(', ') : 'All sources answered.'}</p>
  <h2 class="block-title">GetSocial next</h2>
  <p>${a.getsocial?.next ? esc(a.getsocial.next.title) + ' · ' + (a.getsocial.next.startAt ? fmt.format(new Date(a.getsocial.next.startAt)) : '') : 'No dated GetSocial event in the current scrape.'}</p>`;
}
function paint() {
  const events = selected();
  $('#legend').textContent = `${events.length} matching · GetSocial pinned · gold = clash risk · coloured groups you tagged`;
  renderTicker(events);
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
['q','source','category','when','evening','thuSat','rivals','tagged'].forEach((id) => {
  $('#' + id).addEventListener(id === 'q' ? 'input' : 'change', () => {
    clearTimeout(timer);
    timer = setTimeout(id === 'q' ? load : paint, id === 'q' ? 250 : 0);
  });
});
$('#refresh').onclick = async () => {
  const button = $('#refresh'); button.disabled = true; button.textContent = 'Refreshing…';
  try { await fetch('/api/refresh', { method: 'POST' }); } catch {}
  button.disabled = false; button.textContent = 'Refresh now'; load();
};
load();
setInterval(load, 120000);
