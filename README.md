# uke-o-ono.com

[![Built with ComposureCDK](https://img.shields.io/badge/built%20with-ComposureCDK-0f0d0c?labelColor=b85416)](https://github.com/laazyj/composureCDK)
[![Code: MIT](https://img.shields.io/badge/code-MIT-blue.svg)](LICENSE)
[![Content: © Uke O Ono](https://img.shields.io/badge/content-%C2%A9%20Uke%20O%20Ono-lightgrey.svg)](LICENSE-content.md)

[![uke-o-ono.com](packages/site/static/share-card.jpg)](https://uke-o-ono.com)

Monorepo for **uke-o-ono.com** — the online gig poster for Uke O Ono, an
Edinburgh ukulele band playing "Ballads & Bangers".

Built the same way as [ukehoot.net](https://ukehoot.net): an Nx monorepo with an
Eleventy static site and a [composureCDK](https://github.com/laazyj/composureCDK)
AWS deployment (S3 + CloudFront + ACM). DNS is hosted at Cloudflare — see the
[CDK README](packages/cdk/README.md#dns--certificate).

## Packages

| Package           | What it is                                      |
| ----------------- | ----------------------------------------------- |
| `@uke-o-ono/site` | Eleventy static site (the gig poster).          |
| `@uke-o-ono/cdk`  | composureCDK app — S3/CloudFront/ACM + CI OIDC. |

## Common commands

```sh
npm install          # install workspace deps
npm run site:start   # serve the site locally (Eleventy --serve)
npm run verify       # format:check + build + lint + test (the CI gate)
npm run cdk:diff     # diff infrastructure against AWS
npm run cdk:deploy   # deploy (CI does this on push to main)
```

## Adding a gig

Add an entry to `gigs` in `packages/site/_data/site.json`: `name`, `url` (the
gig's own page, which its name links to), `blurb`, `venue`, `address`,
`mapUrl`, `date` (`YYYY-MM-DD`), `startTime`, optional `endTime`, optional
`ticketsUrl`/`ticketsLabel` (no tickets means "free in"), and an optional
`festival` (`name`, `url`) when it's part of one. Gigs are sorted by date and
stay on the home page until you remove them; nothing expires automatically.

## Adding to the back catalogue

Past gigs worth remembering (a festival run or a big one-off) each get a
Markdown file in `packages/site/content/back-catalogue/`, published at
`/back-catalogue/<file-name>/` and listed newest first by `date`. Nothing is
added automatically; see `fringe-2026.md` for the full shape:

- `title`, `date` (the last show), `when` (the ticket's date bar),
  optional `shows` (shown when more than one), `dates`, `venues`, `summary`
  (card blurb and meta description), optional `logo` (`src`, `alt`)
- `setlist`: the running order, each `{ song, artist }`
- `extras`: songs played off the list, same shape
- `video` on any `setlist` or `extras` song: its YouTube video ID. The song
  links to it (within `playlist`) with a thumbnail. After adding one, run
  `npm run thumbs -w @uke-o-ono/site` and commit the fetched image; the site
  serves thumbnails itself, so visitors never load anything from YouTube.
- `playlist`: the entry's YouTube playlist ID, linked under the set list
- `photos`: each `{ n, where, alt }`, in gallery order, shown as a film strip
  with a lightbox. `n` names `static/back-catalogue/<slug>/photos/<n>.jpg`
  (at most 1600px and 300KB) and `<n>-thumb.jpg` (a 400px square crop);
  `where` captions it. Export them black and white with metadata stripped
  (phone photos carry GPS).
- `cover`: the `n` of the photo shown on the entry's ticket
- the body: the intro paragraph under the title

Each section only renders when the entry has content for it.

## Caching

Browsers are told how long to keep each file by a CloudFront Function
(`packages/cdk/src/cache-control-function.ts`, viewer-response):

- **Pages** (and any error) revalidate on every visit, so changes show at once.
- **Versioned assets** (`?v=<hash>`) are kept for a year. The site build adds
  a hash of each file's contents to every local file a page links to (the
  `version-assets` transform), so a changed file always gets a new URL.
- **Everything else** is kept for a day.

Each deploy also invalidates CloudFront's own cache (`/*`).

## Configuration

- **Domain** is centralised in `packages/cdk/src/app.ts` (`CONFIG.domain`).
- **Google Analytics** is opt-in: set `GA_MEASUREMENT_ID` at build time to emit
  the GA4 tag and the cookie-consent banner. Unset = no analytics, no banner.

## Pre-commit secret scan

A Husky `pre-commit` hook runs [gitleaks](https://github.com/gitleaks/gitleaks)
over staged changes to catch credentials. It's required: install it with
`brew install gitleaks`, or skip a single commit with `git commit --no-verify`.

## GitHub Actions audit

[zizmor](https://docs.zizmor.sh/) checks the workflows and `dependabot.yml` for
security issues (unpinned actions, credential persistence, template injection,
missing update cooldowns and so on). The `zizmor` job in `pr.yml` runs it on
every PR and fails on any finding.

Locally, `npm run lint` runs it too (via `npm run lint:actions`) if zizmor is
on `PATH`, and skips it with a note if not. Install it with `brew install
zizmor` (or `pipx install zizmor`).

## Contributions

This is a personal project for one band and is not accepting contributions.
You're welcome to read the code and reuse the parts the licence permits.

## Licence

The source code is MIT licensed (see [`LICENSE`](LICENSE)). The site copy, gig
data, photographs, and branding are not licensed for reuse (see
[`LICENSE-content.md`](LICENSE-content.md)).

Found a security issue? See [`SECURITY.md`](SECURITY.md).
