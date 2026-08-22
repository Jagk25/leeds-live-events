export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export function ok(data = {}) {
  return { ok: true, ...data };
}

export function fail(code, message, extra = {}) {
  return { ok: false, error: { code, message }, ...extra };
}

export function logError(scope, err) {
  const message = err?.message || String(err);
  console.error(`[${scope}]`, message);
  return { scope, message, status: err?.status || null };
}

export async function safeFetch(url, { timeout = 4000, retries = 1 } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': UA,
          accept: 'text/calendar, application/rss+xml, application/xml, text/html;q=0.9,*/*;q=0.8',
          'accept-language': 'en-GB,en;q=0.9',
        },
        signal: AbortSignal.timeout(timeout),
        redirect: 'follow',
      });
      if (res.status >= 500 && attempt < retries) {
        last = Object.assign(new Error(`${res.status} ${url}`), { status: res.status, url });
        continue;
      }
      if (!res.ok) throw Object.assign(new Error(`${res.status} ${url}`), { status: res.status, url });
      return await res.text();
    } catch (err) {
      last = err.name === 'TimeoutError' || err.name === 'AbortError'
        ? Object.assign(new Error(`timeout ${url}`), { status: 408, url, code: 'TIMEOUT' })
        : err;
    }
  }
  throw last;
}

export function send(res, status, body, cache = 'no-store') {
  res.status(status);
  res.setHeader('Cache-Control', cache);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.json(body);
}

export function withCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export function withHandler(fn, { cors = false } = {}) {
  return async (req, res) => {
    try {
      if (cors) withCors(res);
      if (cors && req.method === 'OPTIONS') return res.status(204).end();
      await fn(req, res);
    } catch (err) {
      send(res, err.status && err.status < 500 ? err.status : 500, fail('INTERNAL', err.message || 'Unexpected error'));
    }
  };
}
