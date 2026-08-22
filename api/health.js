import { getEvents } from '../lib/events.js';
import { send, withHandler } from '../lib/core.js';

export const config = { maxDuration: 30 };

export default withHandler(async (_req, res) => {
  const data = await getEvents({});
  send(res, 200, {
    ok: true,
    events: data.events.length,
    updatedAt: data.updatedAt,
    sources: data.sources,
    errors: data.errors,
    durationMs: data.durationMs,
  });
});
