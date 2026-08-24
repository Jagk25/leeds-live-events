(function () {
  const BOARD_FEED_KEY = 'pg_board_feed';
  const ALL_FEEDS = ['meetup', 'eventbrite', 'fatsoma', 'skiddle', 'visit-leeds', 'leeds-uni'];
  const GATE_ABBR = { meetup: 'MEET', eventbrite: 'EVBR', fatsoma: 'FATS', skiddle: 'SKID', 'visit-leeds': 'VLDS', 'leeds-uni': 'LDSU' };
  let boardSources = new Set(loadJson(BOARD_FEED_KEY, ALL_FEEDS));

  function paintBoardFeedChips() {
    document.querySelectorAll('#boardFeed .chip').forEach((btn) => {
      btn.classList.toggle('active', boardSources.has(btn.dataset.feed));
      btn.onclick = () => {
        if (boardSources.has(btn.dataset.feed)) boardSources.delete(btn.dataset.feed);
        else boardSources.add(btn.dataset.feed);
        saveJson(BOARD_FEED_KEY, [...boardSources]);
        paintBoardFeedChips();
        if (typeof paint === 'function') paint();
      };
    });
  }
  paintBoardFeedChips();

  if (typeof renderFlapBoard === 'function' && typeof FLAP_ROWS !== 'undefined') {
    const _origRenderFlapBoard = renderFlapBoard;
    renderFlapBoard = function (events) {
      const filtered = boardSources.size ? events.filter((e) => boardSources.has(e.source)) : events;
      _origRenderFlapBoard(filtered);
      try {
        const dated = [...filtered].filter((e) => e.start).sort((a, b) => a.start - b.start);
        const pageEvents = dated.slice(flapPage * FLAP_ROWS, flapPage * FLAP_ROWS + FLAP_ROWS);
        const rows = document.querySelectorAll('#flapRows .flap-row');
        rows.forEach((row, i) => {
          const ev = pageEvents[i];
          if (!ev) return;
          row.classList.toggle('alt', i % 2 === 1);
          if (row.querySelector('.flap-gate')) return;
          const gate = document.createElement('div');
          gate.className = 'flap-field flap-gate';
          const code = GATE_ABBR[ev.source] || (ev.source || '----').slice(0, 4).toUpperCase().padEnd(4, ' ');
          gate.innerHTML = [...code].map((ch) => `<span class="flap-cell">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join('');
          const statusField = row.querySelector('.flap-status');
          if (statusField) row.insertBefore(gate, statusField);
          else row.appendChild(gate);
        });
      } catch (e) { console.error('Gate column render failed', e); }
    };
  }

  function tickClock() {
    const el = document.getElementById('boardClock');
    if (el) el.textContent = new Date().toLocaleTimeString('en-GB');
  }
  tickClock();
  setInterval(tickClock, 1000);
})();
