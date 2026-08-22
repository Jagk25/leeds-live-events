import { refresh } from '../lib/events.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false });
  }
  const result = await refresh();
  res.status(200).json({ ok: true, count: result.events.length, updatedAt: result.updatedAt, errors: result.errors });
}
