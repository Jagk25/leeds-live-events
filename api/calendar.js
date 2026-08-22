import { getEvents } from '../lib/events.js';
import { withHandler } from '../lib/core.js';

export const config = { maxDuration: 30 };

function toIcsDate(iso) {
  return iso ? iso.replace(/[-:]/g, '').split('.')[0] + 'Z' : null;
}
function escapeIcs(text = '') {
  return String(text).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

export default withHandler(async (req, res) => {
  const data = await getEvents(req.query || {});
  const now = toIcsDate(new Date().toISOString());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Paradise Glitch//Leeds Social Radar//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Leeds Social Radar',
  ];
  for (const event of data.events || []) {
    if (!event.startAt) continue;
    const dtStart = toIcsDate(event.startAt);
    const dtEnd = toIcsDate(event.endAt) || dtStart;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@paradise-glitch.co.uk`,
      `DTSTAMP:${now}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${escapeIcs(event.title)}`,
      `LOCATION:${escapeIcs(event.venue || event.address || 'Leeds')}`,
      `DESCRIPTION:${escapeIcs(event.description || '')}`,
      `URL:${event.url}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="leeds-social-radar.ics"');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800');
  res.status(200).send(lines.join('\r\n'));
});
