# Gallery page — design options and technical plan

_Status: proposal. Nothing here is built yet. Pick a design (§2), confirm the
hosting decision (§3), and the rest follows._

## 1. What we're solving

One page at `/gallery/` that carries photos and video clips from every Uke O Ono
show, and keeps carrying them as the count grows past several hundred over
several years.

That combination is the whole problem. A one-off gallery of forty photos is
trivial. A page that is still fast on a phone at item eight hundred, that
someone can add to after a gig without a developer, and that doesn't quietly
turn a $4/month site into a $40/month one, needs a bit of structure up front.

Constraints we're designing inside:

| Constraint                    | Where it comes from                                                     |
| ----------------------------- | ----------------------------------------------------------------------- |
| One page, no blog             | `AGENTS.md` — the site stays a flyer, the gallery is the second page    |
| Static, no build-time fetches | Eleventy output uploaded to S3; there is no server at request time      |
| Cheap                         | `packages/cdk/src/system.ts` sets a $4/month budget alarm               |
| No framework                  | The site ships zero JS today beyond a 12-line email decoder             |
| Poster aesthetic              | Vermillion red, cream ticket stubs, Anton caps, grain and erosion masks |
| Non-developer upload path     | The band should be able to add a gig's photos without touching Eleventy |

### The blocker nobody would guess

`system.ts` deploys the site with `createBucketDeploymentBuilder()` and
`.prune(true)`. Two consequences:

1. **Everything in the site bucket that isn't in `dist/` gets deleted.** Media
   cannot be `aws s3 sync`'d into the site bucket alongside the built site; the
   next deploy would prune it.
2. **The CDK bucket deployment stages assets through a Lambda.** Hundreds of
   megabytes of media in `dist/` will slow deploys badly and eventually fail on
   the Lambda's ephemeral storage.

So media **must not** live in `packages/site/static/`. That decision is forced,
and §3 is built around it.

## 2. Three designs

All three share the same data model and the same media pipeline. They differ in
layout, browsing model, and how much new CSS they need. Mockups of all three,
built in the site's own palette, type and textures, accompany this document.

### Design A — "Contact Sheet"

A dense, uniform grid of 4:5 crops, like a photographer's contact sheet or
the B&W collage already running down the right of the home page. Greyscale by
default with a red duotone wash on hover, reusing the exact
`grayscale(1)` + red-multiply treatment on `.photos` in `styles.css`. Video
tiles get a cream play badge in the corner. A sticky filter strip, styled as a
torn ticket edge, runs across the top: **All / Photos / Video**, then gig,
venue, and song chips.

Browsing is flat and search-like. You scan, you filter, you click into a
lightbox.

- **Scales best of the three.** A uniform grid of fixed-aspect tiles is the
  cheapest thing a browser can lay out, and `content-visibility: auto` on each
  row is trivially applied. Two thousand items is not a problem.
- **Most on-brand for the least new CSS.** The visual treatment already exists.
- **Loses the story.** Every photo weighs the same. A great shot from the
  Parliament gig sits in the same 200px square as a blurry one from a Monday.
- Effort: **small**.

### Design B — "Gig Stubs" _(recommended)_

The page is a reverse-chronological run of gigs. Each gig gets a cream ticket
stub header — the existing `.ticket` component, same perforated mask, same
dashed rules — carrying the venue, date, time, and a one-line note. Under each
stub sits that gig's media as a horizontally scrolling filmstrip on mobile and a
3-4 up grid on desktop, with a "see all 34" link that expands the gig in place.

Above it all: a year selector and the same filter chips as Design A.

- **The chunking falls out of the design.** A gig is 10-40 items. That is
  exactly one JSON chunk and one lazy-load boundary. The page never needs to
  think about "items 400-460"; it thinks about "the Bowlers Rest gig on the
  22nd", which is also how the band thinks.
- **Time is the primary axis**, which matches "our shows over the months".
  Scrolling the page is scrolling the band's year.
- **Largest component reuse.** The ticket stub, the session row, the venue name
  with its red underline, all already exist and already work on mobile.
- **Each gig can carry a caption**, so the page reads as a diary rather than a
  dump.
- Costs one extra tap to see everything from one night. That is a fair trade.
- Effort: **small-medium**.

### Design C — "Flyposted"

A masonry wall of mixed-size items, each tile rotated a degree or two and
layered like bills pasted over each other on an Edinburgh hoarding, with torn
edges and tape corners. Featured shots and videos get double-width tiles.
Filters live in a rail of ink tag chips.

- **By far the most distinctive.** It is the strongest extension of the
  "Ballads & Bangers" gig-poster energy, and it would look genuinely great in a
  screenshot.
- **The most expensive, in every sense.** Masonry with mixed aspect ratios means
  either CSS columns (which reorder items, breaking chronology) or a JS layout
  pass (which costs CLS and a resize observer). Rotation plus overlap makes
  `content-visibility` unreliable, and hit targets get fiddly on a phone.
- **Degrades as it grows.** A wall of forty overlapping bills is charming. A
  wall of eight hundred is soup, and the layout cost is superlinear.
- Effort: **medium-large**, and it is the option most likely to need revisiting
  in a year.

### Recommendation

**Design B**, with Design A available as a view toggle ("Gigs / Everything") if
we want it later. B gives the best story, the best reuse, and a chunking
strategy that is correct by construction. A is the safe fallback if we want
something shipped in an afternoon. C is worth prototyping only if the visual
statement matters more than the archive holding up at scale, and even then it
would want a hard cap of one year per page view.

## 3. Where the media lives

**A second S3 bucket, served by the existing CloudFront distribution under a
`/media/*` cache behaviour.**

```
uke-o-ono.com  ──▶  CloudFront (existing distribution, existing cert)
                      ├─ default behaviour  ──▶ site bucket   (Eleventy dist/, pruned on deploy)
                      └─ /media/*           ──▶ media bucket  (never pruned, never in git)
```

Why this and not the alternatives:

| Option                           | Verdict                                                                                                                                                                                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Media in `packages/site/static/` | **No.** Pruned-deploy and Lambda-staging problems above, plus hundreds of MB of binaries in git forever.                                                                                                                                                         |
| Second bucket, same distribution | **Yes.** Same origin so no CORS and no extra DNS round trip, and the existing apex cert already covers it. One new behaviour in `system.ts`.                                                                                                                     |
| `media.uke-o-ono.com` subdomain  | Works, but needs a new ACM cert, a new Cloudflare record, and a cross-origin hop. No upside.                                                                                                                                                                     |
| Cloudinary / Cloudflare Images   | Excellent tooling, on-the-fly resizing, no ffmpeg to babysit. But it adds a third-party dependency, a monthly bill, and a privacy-policy entry for a site whose whole pitch is that it doesn't phone anyone. Revisit only if the ingest script becomes a burden. |
| YouTube / Instagram embeds only  | Free and zero-ops, but we don't own the presentation, the embeds are heavy trackers, and the page becomes a list of other people's players. Keep as the escape hatch for **long** video only (§6).                                                               |

Cost, at a realistic five years of gigging:

- ~1,200 photos × 5 derivatives ≈ 2.5 GB, ~150 clips ≈ 3 GB. Call it **6 GB**
  stored, about **$0.14/month** in S3.
- Transfer is the variable. CloudFront `PRICE_CLASS_100` egress is roughly
  $0.085/GB. Photo-only browsing is cheap: a full page of thumbs is under 1 MB.
  Video is where a bill appears, which is why §6 caps clip size.
- **Action:** raise the budget alarm in `system.ts` from $4 to $10 before this
  ships, so the first busy month doesn't page anyone at 3am.

## 4. The data model

Binaries never enter git. **Metadata always does**, because it is small, it is
the thing worth reviewing in a PR, and it is the thing we'd cry about losing.

### Gig identity

Gigs are already modelled: `_data/site.json` holds `lineup` and `specials`, and
`_data/eventList.js` flattens them into one dated event per gig. The gallery
reuses that, it does not invent a parallel list.

Introduce `_data/gigs.js`, which returns `eventList()` plus an archive file for
gigs from seasons no longer in `site.json`, each keyed by a stable slug:

```
2026-08-22-bowlers-rest
2026-08-27-scottish-parliament
2026-11-14-portobello-town-hall
```

`site.json` stays the "what's on" source of truth. `_data/gigs-archive.json`
accumulates past seasons so slugs never break when August 2026 drops off the
flyer.

### A media item

One entry per photo or clip, in `_data/media/<gig-slug>.json`:

```json
{
  "id": "2026-08-22-bowlers-rest/014",
  "type": "photo",
  "gig": "2026-08-22-bowlers-rest",
  "date": "2026-08-22",
  "base": "/media/2026/08/bowlers-22-014.a3f91c",
  "w": 4000,
  "h": 2667,
  "lqip": "data:image/webp;base64,UklGR…",
  "songs": ["valerie", "rainbow-connection"],
  "caption": "Front row singing louder than we were.",
  "credit": "Jane Bloggs",
  "featured": true
}
```

- `base` is the derivative stem. The renderer appends `-640.avif`, `-1440.webp`,
  `.jpg` and so on. The `a3f91c` is a content hash, which is what makes a
  one-year immutable cache header safe (§5).
- `lqip` is a 16px-wide WebP, about 400 bytes, inlined for a blur-up placeholder
  so tiles have something to show instantly and never reflow.
- `w`/`h` are the original dimensions, used for `aspect-ratio` so there is zero
  layout shift.

### Tags

Three axes, all closed vocabularies so we don't end up with "Valerie",
"valerie" and "Valerie (Winehouse)" as three different tags.

- **Gig** — the slug. Implies date, venue, and festival for free. This is the
  primary axis and it is free, because the gig data already exists.
- **Song** — `_data/media/songs.json`, a small catalogue of
  `{ slug, title, artist }`. The ingest script only accepts known slugs and
  errors on a typo.
- **Type** — `photo` | `video`. Derived, never hand-entered.

Derived-for-free filters: **venue** and **year** both come from the gig, so the
UI can offer them without anyone tagging anything.

Deliberately **not** tagged: people's faces. Tagging band members is tempting
and tagging audience members is a privacy problem we don't need. Captions can
name whoever wants naming.

## 5. Keeping it fast

The target is a page that is interactive in under a second on a mid-range phone
on 4G, at item eight hundred, and stays that way.

### Derivatives, generated once at ingest

Photos, via `sharp`:

| Purpose          | Widths              | Formats                       |
| ---------------- | ------------------- | ----------------------------- |
| Grid thumbnail   | 400, 800 (4:5 crop) | AVIF, WebP, JPEG fallback     |
| Lightbox         | 960, 1440, 2048     | AVIF, WebP, JPEG fallback     |
| Blur placeholder | 16                  | WebP, inlined in the manifest |

Rendered as `<picture>` with AVIF first, WebP second, JPEG in the `<img>`, plus
`srcset`/`sizes`, explicit `width`/`height`, `loading="lazy"` and
`decoding="async"`. A 400px AVIF thumb is 10-18 KB, so a first screen of 12
tiles is roughly 180 KB.

EXIF is stripped on output. Phone photos carry GPS coordinates, and a public
gallery is not the place for the band's home addresses.

### Video, via ffmpeg

H.264 High / yuv420p / AAC 128k / `+faststart`, capped at 720p and CRF 23, plus
a JPEG poster pulled at the one-second mark.

**Clips are capped at 45 seconds.** That keeps a clip around 15-20 MB, which is
the difference between a video tile costing a tenth of a penny to serve and
costing real money. Anything longer belongs on YouTube (§6).

Video tiles render as a poster image with a play badge and **no `<video>` tag at
all** until clicked. A `<video preload="none">` still costs a connection and a
range request per tile; a poster with a click handler costs nothing. On click we
swap in the real element and autoplay it.

### Progressive loading

1. Eleventy renders the **first two gigs inline in the HTML**. That is the
   first screen, server-rendered, no JS needed to see it.
2. Every gig also gets a JSON chunk at `/media-index/<gig-slug>.json`, emitted
   at build time. A slim `/media-index/gigs.json` lists every gig with its date,
   venue, count, and cover item.
3. An `IntersectionObserver` watching a sentinel near the page bottom fetches
   the next gig's chunk and renders it. No framework, roughly 4 KB of vanilla
   JS, matching the site's existing zero-dependency front end.
4. Each rendered gig section carries `content-visibility: auto` and
   `contain-intrinsic-size`, so off-screen gigs cost nothing to lay out even
   once they're in the DOM.

Net effect: the HTML stays around 40-60 KB gzipped no matter how many gigs
exist, because the tail is JSON fetched on demand.

### Caching

| Path                  | `Cache-Control`                       | Why                                     |
| --------------------- | ------------------------------------- | --------------------------------------- |
| `/media/**`           | `public, max-age=31536000, immutable` | Content-hashed filenames. Safe forever. |
| `/media-index/*.json` | `public, max-age=300, s-maxage=86400` | Changes only when a gig gains media.    |
| `/gallery/`           | existing site default                 | Deploys already invalidate `/*`.        |

The media bucket is synced out-of-band and its objects are immutable, so it
never needs an invalidation.

### No-JS and reduced-motion

Without JS the first two gigs render fully and a plain link points at the rest.
Filters are URL-driven (`/gallery/?gig=…&song=…`), so they are shareable and
work on back/forward. The lightbox is a native `<dialog>` with a `#m/<id>` hash,
so individual photos are linkable. `prefers-reduced-motion` disables the
blur-up transition, as the home page already does for its `rise` animation.

## 6. Long video

Clips over 45 seconds (a full song, a whole set) go to YouTube, and the gallery
embeds them with a **facade**: our own poster image and play button, with the
YouTube iframe injected only on click. That is one line in `privacy.md` ("if you
press play on a YouTube clip, your browser contacts Google") rather than the
tracking-iframe-on-every-page-load problem, and it keeps our egress bill flat.

Instagram is **not** embedded. Its embed script is heavy and it breaks whenever
Meta feels like it. The existing "Instagram has the latest" link stays as-is.

## 7. Getting media in

The band take photos on phones. The workflow has to survive that.

### Phase 1 — a CLI, run by a developer

```sh
# drop files into media-inbox/2026-08-22-bowlers-rest/ then:
npm run gallery:add -- 2026-08-22-bowlers-rest
```

`packages/site/scripts/media-ingest.mjs`:

1. Reads EXIF `DateTimeOriginal` to order items and sanity-check the date
   against the gig, then strips all EXIF from the output.
2. Generates every derivative with `sharp` / `ffmpeg`, content-hashing each stem.
3. Writes or updates `_data/media/<gig-slug>.json`, preserving captions and
   song tags already written there.
4. `aws s3 sync`s derivatives to the media bucket with the immutable header.
5. Prints what changed. The JSON is then committed by hand, so every gallery
   change is a reviewable diff.

`media-inbox/` is gitignored. Originals stay in the band's own cloud storage.
The repo holds the metadata, S3 holds the derivatives, and neither holds a
4000px original.

### Phase 2 — no developer required

A `workflow_dispatch` GitHub Action that takes a gig slug, reads originals from
an `inbox/` prefix on the media bucket (which anyone can drag files into via the
S3 console or a shared link), runs the same script, and opens a PR with the
metadata diff. Same code path, different trigger. Worth building once the CLI
has proved itself over a season, not before.

### Captions and song tags

The ingest script writes entries with empty `caption` and `songs`. Someone edits
the JSON afterwards, or not. An untagged photo still shows up under its gig; the
tags are an enhancement, never a requirement. This matters: a workflow that
demands metadata is a workflow that stops getting used in October.

## 8. Rights, privacy, moderation

- `LICENSE-content.md` already reserves photographs. The `credit` field means
  the photographer is named on the item, in the lightbox.
- Audience photos: no face tagging, and `privacy.md` gains a line pointing at
  the existing contact address for takedowns. Removing an item is deleting one
  JSON entry and re-deploying. The S3 object can be deleted independently.
- EXIF stripping (§5) is the non-obvious one. It is easy to forget and hard to
  undo once published.

## 9. Build order

| Step | Work                                                                    | Ships                             |
| ---- | ----------------------------------------------------------------------- | --------------------------------- |
| 1    | Media bucket + `/media/*` behaviour in `system.ts`; raise budget to $10 | Infrastructure, no visible change |
| 2    | `_data/gigs.js`, `gigs-archive.json`, `songs.json`, media JSON schema   | Data model                        |
| 3    | `media-ingest.mjs` with sharp/ffmpeg/sync                               | One gig's media live in S3        |
| 4    | `/gallery/` page, chosen design, server-rendered first two gigs         | **A usable gallery**              |
| 5    | Chunk loading, `IntersectionObserver`, lightbox                         | Scales past one screen            |
| 6    | Filter chips, URL state, deep links                                     | Browsable                         |
| 7    | YouTube facade for long video; nav link from the flyer                  | Complete                          |

Steps 1-4 are the minimum that is worth deploying. Everything after is additive
and can land a gig at a time.

## 10. Open questions

1. **Design A, B, or C?** §2 recommends B.
2. **How much old material is there?** A back catalogue of 300 photos from
   previous years changes the Phase 2 priority considerably.
3. **Is 45 seconds the right clip cap?** It is a cost decision, not a technical
   one, and it is easy to change later.
4. **Should the gallery link from the flyer's main nav**, or stay a footer link
   until it has enough in it to be worth the click?
