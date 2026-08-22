import { refresh } from '../lib/events.js';
import { fail, send, withHandler } from '../lib/core.js';

export const config = { maxDuration: 30 };

export default withHandler(async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') return send(res, 405, fail('METHOD', 'Use GET or POST'));
  send(res, 200, await refresh());
});
