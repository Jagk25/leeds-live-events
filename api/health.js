import { getEvents } from '../lib/events.js';

export const config = { maxDuration: 30 };

export default async function handler(_req, res) {
  const data = await getEvents({});
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    events: data.events.length,
    updatedAt: data.updatedAt,
    sources: data.sources,
    errors: data.errors,
  });
}
