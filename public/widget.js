const fmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const params = new URLSearchParams(location.search);
const limit = Number(params.get('limit') || 6);

async function loadWidget() {
  const list = document.getElementById('list');
  try {
    const res = await fetch('/api/events');
    const data = await res.json();
    const events = (data.events || [])
      .filter((e) => e.startAt)
      .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))
      .slice(0, limit);
    list.innerHTML = events.length
      ? events.map((e) => `<li><a href="${e.url}" target="_top"><span class="time">${fmt.format(new Date(e.startAt))}</span><div class="title">${e.title.replace(/</g, '&lt;')}</div><div class="meta">${(e.venue || e.source || '').replace(/</g, '&lt;')}</div></a></li>`).join('')
      : '<li class="empty">No scheduled events right now.</li>';
  } catch {
    list.innerHTML = '<li class="empty">Widget offline — try again shortly.</li>';
  }
}
loadWidget();
setInterval(loadWidget, 120000);
