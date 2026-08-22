import { getState } from '../lib/events.js';

export default async function handler(_req, res) {
  const state = getState();
  res.status(200).json({ ok: true, events: state.events.length, updatedAt: state.updatedAt, sources: state.sources, errors: state.errors });
}
