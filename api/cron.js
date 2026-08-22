import { refresh } from '../lib/events.js';
import { fail, send, withHandler } from '../lib/core.js';

export const config = { maxDuration: 30 };

export default withHandler(async (req, res) => {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return send(res, 401, fail('AUTH', 'Invalid cron secret'));
  }
  const result = await refresh();
  send(res, 200, {
    ok: true,
    count: result.events.length,
    updatedAt: result.updatedAt,
    errors: result.errors,
    durationMs: result.durationMs,
  });
});
