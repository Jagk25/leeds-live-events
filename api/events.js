import { getEvents } from '../lib/events.js';
import { send, withHandler } from '../lib/core.js';

export const config = { maxDuration: 30 };

export default withHandler(async (req, res) => {
  send(res, 200, await getEvents(req.query || {}), 's-maxage=60, stale-while-revalidate=600');
}, { cors: true });
