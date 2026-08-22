import { getEvents } from '../lib/events.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const data = await getEvents(req.query || {});
  res.setHeader('Cache-Control', data.events.length ? 's-maxage=300, stale-while-revalidate=1800' : 'no-store');
  res.status(200).json(data);
}
