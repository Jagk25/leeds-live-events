const $ = (s) => document.querySelector(s);
const fmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

let timer;

function esc(value = '') {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

async function load() {
  const params = new URLSearchParams();
  if ($('#q').value) params.set('q', $('#q').value);
  if ($('#source').value) params.set('source', $('#source').value);
  let data;
  try {
    const res = await fetch(`/api/events?${params}`);
    data = await res.json();
  } catch (error) {
    $('#status').textContent = 'Could not reach the events API';
    $('#errors').innerHTML = `<p class="warn">${esc(error.message)}</p>`;
    return;
  }
  $('#status').textContent = `Updated ${data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString('en-GB') : 'never'} · ${data.events.length} events`;
  const bits = [];
  if (data.errors?.length) bits.push(`Some sources failed: ${data.errors.map((x) => esc(x.source)).join(', ')}`);
  if (!data.events.length) bits.push('No events parsed yet. Hit Refresh now, then open /api/health if it stays empty.');
  $('#errors').innerHTML = bits.map((b) => `<p class="warn">${b}</p>`).join('');
  const root = $('#events');
  root.innerHTML = '';
  for (const event of data.events) {
    const node = $('#card').content.cloneNode(true);
    node.querySelector('.tag').textContent = event.source;
    node.querySelector('h2').textContent = event.title;
    node.querySelector('.when').textContent = event.startAt ? fmt.format(new Date(event.startAt)) : 'Date on listing';
    node.querySelector('.venue').textContent = [event.venue, event.address].filter(Boolean).join(' · ');
    node.querySelector('.desc').textContent = event.description?.slice(0, 180) || '';
    node.querySelector('a').href = event.url;
    root.append(node);
  }
}

$('#q').oninput = () => {
  clearTimeout(timer);
  timer = setTimeout(load, 250);
};
$('#source').onchange = load;
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
setInterval(load, 60_000);
