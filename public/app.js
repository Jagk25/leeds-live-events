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
  const data = await fetch(`/api/events?${params}`).then((res) => res.json());
  $('#status').textContent = `Updated ${data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString('en-GB') : 'never'} · ${data.events.length} events`;
  $('#errors').innerHTML = data.errors?.length
    ? `<p class="warn">Some sources are temporarily unavailable: ${data.errors.map((x) => esc(x.source)).join(', ')}</p>`
    : '';
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
  await fetch('/api/refresh', { method: 'POST' });
  button.disabled = false;
  button.textContent = 'Refresh now';
  load();
};

load();
setInterval(load, 60_000);
