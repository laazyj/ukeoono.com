# Project Instructions

## After making changes

Always run lint and format checks after each task, before presenting work for review:

```sh
npm run lint
npm run format:check
```

Fix any issues before moving on. Use npm run lint:fix and npm run format to auto-fix.

## Committing (pre-commit hook)

The Husky `pre-commit` hook runs a gitleaks secret scan (see the README's
"Pre-commit checks"). gitleaks is a standalone binary, deliberately not an
npm dependency, so it will not be on PATH in a fresh clone or in CI. When it is
missing the hook prints `pre-commit: gitleaks not found in PATH.` and exits
non-zero. That is expected, not a failure to debug.

If gitleaks is on PATH, just commit; the scan passes for secret-free changes.
Only when it is missing, and your changes contain no secrets, bypass it with:

```sh
git commit --no-verify -m "..."
```

GitHub's server-side secret scanning still covers anything pushed, so skipping
the local scan for secret-free changes is safe.

The hook also runs zizmor if it's installed (skipped otherwise; the `zizmor`
PR job is the gate). Fix its findings rather than suppressing them.

## Build system

Use npx nx to run build/test scripts — this is an nx monorepo with two
packages: `@uke-o-ono/site` (Eleventy) and `@uke-o-ono/cdk` (composureCDK).

## Asset URLs

The build appends a content hash (`?v=…`) to every local file a page links to
(`version-assets` transform in `eleventy.config.js`), and the CDN caches those
URLs for a year. Link static files with plain `src`/`href` attributes so the
transform can see them; files referenced from CSS `url()` aren't versioned and
are cached for a day.

## What this site is

uke-o-ono.com is the online gig poster for Uke O Ono, an Edinburgh ukulele
band ("Ballads & Bangers"). It is not a blog. The home page lists upcoming
gigs from `site.json` (`gigs`). Gigs never expire automatically: the band
decides when one comes off, so don't add date-based filtering or scheduled
rebuilds. "The back catalogue" (`content/back-catalogue/*.md`) keeps set lists
from past gigs the band chooses to add. Instagram is the place for anything
that might change.
Keep it minimal: fast, no build-time data fetching.

## Voice & copy

Site copy is short, witty, and irreverent, Edinburgh-proud, and leans into the
"Ballads & Bangers" gig-poster energy.

- Avoid em-dashes in prose. Use full stops, commas, or parentheses.
  (Conventional title/aria-label separators are fine.)
- The gig list is the hero: venues, dates, times, free entry or tickets.
- Point people at Instagram for anything that might change.
