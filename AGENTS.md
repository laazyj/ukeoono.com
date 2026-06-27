# Project Instructions

## After making changes

Always run lint and format checks after each task, before presenting work for review:

```sh
npm run lint
npm run format:check
```

Fix any issues before moving on. Use npm run lint:fix and npm run format to auto-fix.

## Committing (gitleaks pre-commit hook)

The Husky `pre-commit` hook runs a gitleaks secret scan (see the README's
"Pre-commit secret scan"). gitleaks is a standalone binary, deliberately not an
npm dependency, so it will not be on PATH in a fresh clone or in CI. When it is
missing the hook prints `pre-commit: gitleaks not found in PATH.` and exits
non-zero. That is expected, not a failure to debug.

If your staged changes contain no secrets, bypass the hook with:

```sh
git commit --no-verify -m "..."
```

GitHub's server-side secret scanning still covers anything pushed, so skipping
the local scan for secret-free changes is safe.

## Build system

Use npx nx to run build/test scripts — this is an nx monorepo with two
packages: `@uke-o-ono/site` (Eleventy) and `@uke-o-ono/cdk` (composureCDK).

## What this site is

uke-o-ono.com is a single-page online flyer for Uke O Ono, an Edinburgh
ukulele band playing PBH's Free Fringe 2026 ("Ballads & Bangers"). It is not a
blog. Content is a fixed list of August 2026 gigs plus an Instagram link for
up-to-date info. Keep it minimal: one page, fast, no build-time data fetching.

## Voice & copy

Site copy is short, witty, and irreverent, Edinburgh-proud, and leans into the
"Ballads & Bangers" gig-poster energy.

- Avoid em-dashes in prose. Use full stops, commas, or parentheses.
  (Conventional title/aria-label separators are fine.)
- The gig list is the hero: venues, dates, times, free entry (Free Fringe).
- Point people at Instagram for anything that might change.
