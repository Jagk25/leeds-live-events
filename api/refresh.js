import { refresh } from '../lib/events.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ ok: false });
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(await refresh());
}
