# novellist

Tracker extension for [Novellist](https://www.novellist.co/). Bind Dion entries
to Novellist novels and sync your reading progress, status, and rating — the
same way the anilist extension tracks anime/manga.

## How it works

- **Login**: the extension declares cookie auth for `www.novellist.co`
  (login page `/auth/login`, which redirects back to the home page when done).
  The site stores a Supabase session in chunked cookies (`novellist.0`,
  `novellist.1`, ...); the extension decodes them to call Novellist's backend
  API with a Bearer token, refreshing it via Supabase when it expires.
- **Bind**: on an entry's detail page, bind it to a Novellist novel via title
  search.
- **Sync**: reading a chapter pushes `chapter_count` to your Novellist reading
  list (the entry is created automatically if it doesn't exist yet) and marks
  it Completed when you finish. Status quick-set buttons and the current
  remote state (status/rating/progress) show in the entry UI.

## Development

```sh
bun install
bun run build
bun test            # unit tests + live-API checks when .env exists
```

### Cookies → .env

Tests that hit the live API read credentials from `.env`. Generate it from a
browser cookie export (JSON array, e.g. from a "EditThisCookie"-style export)
instead of pasting the base64 session by hand:

```sh
bun run sync-cookies                 # reads <repo-root>/cookies by default
bun run sync-cookies my-export.json  # or an explicit path
```

The script joins/decodes the `novellist.*` cookie chunks, verifies the session
against the API (refreshing it through Supabase if expired), and writes
`NOVELLIST_ACCESS_TOKEN`, `NOVELLIST_REFRESH_TOKEN`,
`NOVELLIST_SUPABASE_ANON_KEY`, `NOVELLIST_USER_ID`, and `NOVELLIST_EMAIL` into
`.env`. Both `cookies` and `.env` are gitignored — never commit them.
