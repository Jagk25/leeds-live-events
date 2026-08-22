# Leeds Live Events

Zero-paid-API dashboard for public Leeds listings from Visit Leeds, Eventbrite, Fatsoma and Meetup.

It is built to run locally **and** on Vercel Hobby: no database, no vendor API keys, and no 15-minute cron (Hobby only allows one cron per day).

## Live behaviour on Vercel

- `/api/events` refreshes public listing pages only when the in-memory cache is older than 15 minutes.
- Responses are CDN-cached with `s-maxage=900`.
- `/api/cron` warms the cache once a day at 06:00 UTC.
- `/api/refresh` still lets you force a scrape from the UI.

## Local

```bash
cp .env.example .env
npm install
npm run dev
```

Open http://localhost:3000

## Deploy

Connected to Vercel from this GitHub repo. Push to `main` to ship.

Optional env vars in the Vercel project:

- `ENABLED_SOURCES` — comma list, default `visit-leeds,eventbrite,fatsoma,meetup`
- `CACHE_MINUTES` — default `15`
- `CRON_SECRET` — if set, `/api/cron` requires `Authorization: Bearer <secret>`

## Compliance

Adapters read only public HTML / JSON-LD. They do not bypass logins, CAPTCHAs or paywalls. Review each platform's terms before promoting this as a public product, and disable a source with `ENABLED_SOURCES` if needed. Cards always link back to the original listing.
