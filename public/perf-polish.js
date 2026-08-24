(function () {
  const CACHE_KEY = 'pg_events_cache';
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached && Array.isArray(cached.events) && typeof enrich === 'function' && typeof paint === 'function') {
      all = cached.events.map(enrich);
      paint();
      const statusEl = document.getElementById('status');
      if (statusEl) statusEl.textContent = 'Showing cached listings · refreshing…';
    }
  } catch (e) {}

  const bar = document.createElement('div');
  bar.id = 'pgProgressBar';
  bar.style.cssText = 'position:fixed;top:0;left:0;height:2px;width:0;background:var(--pink,#ff4d88);z-index:999;transition:width .2s ease, opacity .3s ease;opacity:0;border-radius:2px;';
  document.body.appendChild(bar);
  function showBar() { bar.style.opacity = '1'; bar.style.width = '70%'; }
  function hideBar() { bar.style.width = '100%'; setTimeout(() => { bar.style.opacity = '0'; bar.style.width = '0'; }, 250); }

  if (typeof load === 'function') {
    const _origLoad = load;
    load = async function (...args) {
      showBar();
      const result = await _origLoad(...args);
      try {
        if (Array.isArray(all)) localStorage.setItem(CACHE_KEY, JSON.stringify({ events: all, cachedAt: Date.now() }));
      } catch (e) {}
      hideBar();
      return result;
    };
  }

  const style = document.createElement('style');
  style.textContent = '#board,#flapRows{transition:opacity .18s ease}.event-row{animation:pgFadeIn .2s ease both}@keyframes pgFadeIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}';
  document.head.appendChild(style);
})();
