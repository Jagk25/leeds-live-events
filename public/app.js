const $ = (s) => document.querySelector(s);
const fmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

const RIVALS = /chilled out|getsocial|leeds living|leeds nerds|so.?social|weroad|language exchange|meetup|mixer|speed dating|young professional|20s-40s|25-45/i;
const CATS = {
  social: /social|mixer|meetup|friends|network|chat|drinks|community|collective/i,
  tech: /tech|digital|dev|aws|python|javascript|data|ai|startup/i,
  music: /gig|dj|club|rave|concert|live music|karaoke/i,
  games: /game|board|nerd|rpg|dungeons|quiz/i,
  outdoors: /hike|walk|run|rambl|cycle|outdoor/i,
  dating: /dating|singles|speed date/i,
  arts: /art|theatre|gallery|film|comedy|poetry/i,
};

let all = [];
let view = 'board';
let month = new Date(2026, 8, 1);
let timer;

function esc(value = '') {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

function groupSlug(event) {
  const match = String(event.url || '').match(/meetup\.com\/([^/?#]+)/i);
  if (!match) return null;
  const slug = decodeURIComponent(match[1]).toLowerCase();
  if (['find', 'topics', 'events', 'cities', 'login'].includes(slug)) return null;
  return slug;
}

function groupName(slug) {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function enrich(event) {
  const hay = `${event.title} ${event.venue} ${event.description} ${event.source}`;
  const start = event.startAt ? new Date(event.startAt) : null;
  const hour = start && !Number.isNaN(start.getTime()) ? start.getHours() : null;
  const dow = start && !Number.isNaN(start.getTime()) ? start.getDay() : null;
  const categories = Object.entries(CATS).filter(([, re]) => re.test(hay)).map(([k]) => k);
  if (!categories.length) categories.push('social');
  const slug = event.source === 'meetup' ? groupSlug(event) : null;
  return {
    ...event,
    start,
    hour,
    dow,
    evening: hour === null || hour >= 17,
    thuSat: dow === 4 || dow === 5 || dow === 6,
    rival: RIVALS.test(hay) || event.source === 'meetup',
    categories,
    slug,
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
    const row = map.get(event.slug) || { slug: event.slug, name: groupName(event.slug), count: 0, next: null };
    row.count += 1;
    if (event.start && (!row.next || event.start < row.next.start)) row.next = event;
    map.set(event.slug, row);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || (a.next?.start || 0) - (b.next?.start || 0)).slice(0, 5);
}

function renderGroups(events) {
  const groups = topGroups(events.filter((e) => e.source === 'meetup' || e.slug));
  if (!groups.length) {
    $('#groups').innerHTML = '';
    return;
  }
  $('#groups').innerHTML = `<h2 class="block-title">Top 5 Leeds Meetup groups</h2>
    <div class="group-grid">
      ${groups.map((group, i) => `
        <article class="group-card">
          <p class="tag">#${i + 1}</p>
          <h3>${esc(group.name)}</h3>
          <p>${group.count} upcoming in this filter</p>
          <p class="when">${group.next?.start ? 'Next: ' + fmt.format(group.next.start) : 'Dates on Meetup'}</p>
          <p class="desc">${esc(group.next?.title || '')}</p>
          <a href="https://www.meetup.com/${esc(group.slug)}/" target="_blank" rel="noopener">Open group ↗</a>
        </article>`).join('')}
    </div>`;
}

function renderBoard(events) {
  const root = $('#board');
  root.innerHTML = '';
  for (const event of events.slice(0, 180)) {
    const node = $('#card').content.cloneNode(true);
    node.querySelector('.tag').textContent = `${event.source}${event.rival ? ' · rival' : ''}`;
    node.querySelector('h2').textContent = event.title;
    node.querySelector('.when').textContent = event.start ? fmt.format(event.start) : 'Date on listing';
    node.querySelector('.venue').textContent = [event.venue, event.address].filter(Boolean).join(' · ');
    node.querySelector('.desc').textContent = event.description?.slice(0, 180) || event.categories.join(', ');
    node.querySelector('a').href = event.url;
    if (event.rival && event.thuSat && event.evening) node.querySelector('article').classList.add('clash');
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
  $('#calendar').innerHTML = `
    <div class="cal-head">
      <button type="button" id="prevMonth">←</button>
      <h2>${esc(title)}</h2>
      <button type="button" id="nextMonth">→</button>
    </div>
    <div class="cal-grid">
      ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d) => `<p class="dow">${d}</p>`).join('')}
      ${days.map((day) => {
        if (!day) return '<div class="cell empty"></div>';
        const items = events.filter((e) => e.start && e.start.toDateString() === day.toDateString());
        const clashes = items.filter((e) => e.rival && e.evening);
        const heat = clashes.length >= 4 ? 'hot' : clashes.length ? 'warm' : items.length ? 'cool' : '';
        const mixer = [4,5,6].includes(day.getDay());
        return `<button type="button" class="cell ${heat} ${mixer ? 'mixer-day' : ''}" data-day="${day.toISOString()}">
          <strong>${day.getDate()}</strong>
          <span>${items.length} events</span>
          <em>${clashes.length ? clashes.length + ' rival evenings' : 'clear evening'}</em>
        </button>`;
      }).join('')}
    </div>
    <div id="dayList"></div>`;
  $('#prevMonth').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); paint(); };
  $('#nextMonth').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); paint(); };
  $('#calendar').querySelectorAll('[data-day]').forEach((btn) => {
    btn.onclick = () => showDay(new Date(btn.dataset.day), events);
  });
}

function showDay(day, events) {
  const items = events.filter((e) => e.start && e.start.toDateString() === day.toDateString());
  $('#dayList').innerHTML = `<h3>${esc(dayFmt.format(day))}</h3>` + (items.length ? items.map((e) => `
    <a class="row ${e.rival && e.evening ? 'clash' : ''}" href="${esc(e.url)}" target="_blank" rel="noopener">
      <strong>${esc(e.title)}</strong>
      <span>${e.start ? fmt.format(e.start) : ''} · ${esc(e.source)}${e.rival ? ' · rival' : ''}</span>
    </a>`).join('') : '<p>No filtered events this day. A clear Paradise Glitch slot.</p>');
}

function renderRadar(events) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const slots = [];
  for (let i = 0; i < 56; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    if (![4, 5, 6].includes(day.getDay())) continue;
    const items = events.filter((e) => e.start && e.start.toDateString() === day.toDateString() && e.evening);
    const rivals = items.filter((e) => e.rival);
    const status = rivals.length >= 3 ? 'Clash' : rivals.length ? 'Busy' : 'Clear';
    slots.push({ day, items, rivals, status });
  }
  $('#radar').innerHTML = `
    <p class="hint">Thursday–Saturday evenings for We Are Paradise Glitch mixers. Clear nights are the ones to book first.</p>
    <div class="slots">
      ${slots.map((slot) => `
        <article class="slot ${slot.status.toLowerCase()}">
          <p class="tag">${slot.status}</p>
          <h2>${esc(dayFmt.format(slot.day))}</h2>
          <p>${slot.rivals.length} rival evening events · ${slot.items.length} total after 5pm</p>
          <ul>${slot.rivals.slice(0, 4).map((e) => `<li><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a></li>`).join('') || '<li>No obvious social competitor</li>'}</ul>
        </article>`).join('')}
    </div>`;
}

function paint() {
  const events = selected();
  $('#legend').textContent = `${events.length} matching · Meetup stays first · gold cards are rival Thu–Sat evenings`;
  renderGroups(events);
  $('#board').classList.toggle('hidden', view !== 'board');
  $('#calendar').classList.toggle('hidden', view !== 'calendar');
  $('#radar').classList.toggle('hidden', view !== 'radar');
  if (view === 'board') renderBoard(events);
  if (view === 'calendar') renderCalendar(events);
  if (view === 'radar') renderRadar(events);
}

async function load() {
  let data;
  try {
    const params = new URLSearchParams();
    if ($('#q').value) params.set('q', $('#q').value);
    if ($('#source').value) params.set('source', $('#source').value);
    const res = await fetch(`/api/events?${params}`);
    data = await res.json();
  } catch (error) {
    $('#status').textContent = 'Could not reach the events API';
    $('#errors').innerHTML = `<p class="warn">${esc(error.message)}</p>`;
    return;
  }
  all = (data.events || []).map(enrich);
  $('#status').textContent = `Updated ${data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString('en-GB') : 'never'} · ${data.events.length} raw events`;
  $('#errors').innerHTML = data.errors?.length
    ? `<p class="warn">Some sources failed: ${data.errors.map((x) => esc(x.source)).join(', ')}</p>` : '';
  paint();
}

document.querySelectorAll('.views button').forEach((btn) => {
  btn.onclick = () => {
    view = btn.dataset.view;
    document.querySelectorAll('.views button').forEach((b) => b.classList.toggle('active', b === btn));
    paint();
  };
});
['q','source','category','when','evening','thuSat','rivals'].forEach((id) => {
  $('#' + id).addEventListener(id === 'q' ? 'input' : 'change', () => {
    clearTimeout(timer);
    timer = setTimeout(id === 'q' ? load : paint, id === 'q' ? 250 : 0);
  });
});
$('#refresh').onclick = async () => {
  const button = $('#refresh');
  button.disabled = true;
  button.textContent = 'Refreshing…';
  try { await fetch('/api/refresh', { method: 'POST' }); } catch {}
  button.disabled = false;
  button.textContent = 'Refresh now';
  load();
};

load();
setInterval(load, 120000);
