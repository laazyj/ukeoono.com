# Gallery page — design options and technical plan

_Status: proposal. Nothing here is built yet._

_Settled: photos are self-hosted, video goes on YouTube (§3, §6). Outstanding:
pick a design (§2), and the rest follows._

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
| Cheap to reach people         | The gallery should feed the band's channels, not be a cul-de-sac        |

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

**Photos in a second S3 bucket, served by the existing CloudFront distribution
under a `/media/*` cache behaviour. Video on YouTube.**

```
uke-o-ono.com  ──▶  CloudFront (existing distribution, existing cert)
                      ├─ default behaviour  ──▶ site bucket   (Eleventy dist/, pruned on deploy)
                      └─ /media/*           ──▶ media bucket  (photos + video posters)

youtube.com/@ukeoono ──▶ every video, streamed by Google.
                         Nothing is requested from them until a viewer
                         presses play on a tile (§6).
```

Why this and not the alternatives:

| Option                           | Verdict                                                                                                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Media in `packages/site/static/` | **No.** Pruned-deploy and Lambda-staging problems above, plus hundreds of MB of binaries in git forever.                                                                                                                        |
| Second bucket, same distribution | **Yes.** Same origin so no CORS and no extra DNS round trip, and the existing apex cert already covers it. One new behaviour in `system.ts`.                                                                                    |
| `media.uke-o-ono.com` subdomain  | Works, but needs a new ACM cert, a new Cloudflare record, and a cross-origin hop. No upside.                                                                                                                                    |
| Cloudinary / Cloudflare Images   | Excellent tooling, on-the-fly resizing. But it adds a third-party dependency, a monthly bill, and a privacy-policy entry, for photos we can serve perfectly well ourselves. Revisit only if the ingest script becomes a burden. |
| Video in the media bucket        | **No.** It works, but we would pay every byte of egress, maintain an ffmpeg pipeline, cap clip length to control the bill, and get nothing back for it. See below.                                                              |
| Video on YouTube                 | **Yes.** Google pays the bandwidth, the player is one every viewer already knows, and the channel is a marketing surface an MP4 in a bucket will never be (§6).                                                                 |

### Why video goes to YouTube and photos do not

The two file types pull in opposite directions, so they get opposite answers.

Photos are small, we want them art-directed (the greyscale-and-red treatment is
half the design), and serving them ourselves costs pennies. Keep them.

Video is the exact inverse:

- **Bandwidth stops being ours.** Video was the only real cost risk in this
  plan. It disappears.
- **The ffmpeg pipeline disappears with it.** No transcode ladder, no poster
  extraction, no `+faststart`, no 45-second cap invented purely to control a
  bill. A phone clip gets uploaded from the phone, in the YouTube app, at the
  bar. That is a much better odds of actually happening than "wait for someone
  to run the ingest script".
- **The player is better than ours would be.** Adaptive bitrate on a bad 4G
  connection, quality selection, captions, playback speed, casting to a TV,
  and an interface nobody has to learn.
- **It is a second front door.** A video in an S3 bucket is invisible. A video
  on a channel is searchable, suggestable, and subscribable, and vertical phone
  clips become Shorts, which is currently the cheapest reach on the internet.
- **It is an offsite backup** of the one media type we would otherwise hold in
  exactly one place.

What we give up, honestly: some control of presentation (YouTube's chrome, and
YouTube may run ads on our videos whether or not we monetise them), and a
dependency on a platform that could take a video down. §6 covers the second
one, which for a covers band is not hypothetical.

Cost, at a realistic five years of gigging:

- ~1,200 photos × 5 derivatives ≈ 2.5 GB, plus ~150 video posters ≈ 0.1 GB.
  Call it **2.6 GB** stored, about **$0.06/month** in S3.
- Transfer is photos only now. CloudFront `PRICE_CLASS_100` egress is roughly
  $0.085/GB, and a full page of thumbs is under 1 MB, so a busy month is well
  under a dollar.
- **The $4 budget alarm can stay where it is.** Raising it was only ever
  protection against a video bill. Worth watching for the first season rather
  than pre-emptively raising.

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

A clip is the same record with a `youtube` id instead of image derivatives,
and a `base` that points at its **self-hosted** poster:

```json
{
  "id": "2026-08-22-bowlers-rest/v2",
  "type": "video",
  "gig": "2026-08-22-bowlers-rest",
  "date": "2026-08-22",
  "youtube": "aBcDeFgHiJk",
  "base": "/media/2026/08/bowlers-22-v2-poster.7c1e04",
  "w": 1920,
  "h": 1080,
  "seconds": 214,
  "lqip": "data:image/webp;base64,UklGR…",
  "songs": ["valerie"],
  "caption": "The one where the fire alarm went off."
}
```

The poster being ours, not a hot-linked `i.ytimg.com` thumbnail, is the load
bearing detail. It is what keeps the grid first-party until someone presses
play (§6), it lets a video tile take the same greyscale-and-red treatment as
every photo, and it means the tile still renders if the video ever goes away.
`w`/`h` carry the clip's real shape, so a vertical phone clip sizes correctly
next to a landscape one without a special case.

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

### Video, via YouTube

There is no transcode step. The clip is already on YouTube; what the gallery
builds is its **poster**, which goes through the identical sharp ladder as a
photo, so a video tile and a photo tile are the same object to the renderer and
to the CSS.

Ingest takes the poster from `https://i.ytimg.com/vi/<id>/maxresdefault.jpg`
once, at build time, and a local file overrides it when YouTube's auto-picked
frame is the one where everybody blinked.

A video tile therefore costs exactly what a photo tile costs: one AVIF
thumbnail, 10-18 KB. **No iframe, no player script, and no request to Google
until the tile is clicked.** On click we inject:

```
https://www.youtube-nocookie.com/embed/<id>?autoplay=1&rel=0&playsinline=1
```

`rel=0` no longer removes suggested videos (YouTube changed that), it restricts
them to the same channel, which for us is the right answer anyway: the thing
that comes up after a clip is another one of ours.

This facade pattern is not a nicety. An iframe per tile on a page with thirty
clips is thirty connections to Google and a tracking cookie for every visitor
who never pressed play. The facade is what lets §8 stay true.

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

## 6. The YouTube channel

Since the channel is now load-bearing infrastructure rather than an overflow
bucket, it is worth being deliberate about it.

**Videos are public, not unlisted.** Unlisted video does not appear on the
channel, in search, or in suggestions, which forfeits the entire marketing
argument for being there. If a particular clip should not be public, it should
probably not be in the gallery either.

**Shoot landscape for the gallery, and do not fight vertical.** A vertical clip
under three minutes becomes a Short, which is the single best reach YouTube
currently offers an unknown band. The media record carries the clip's real
aspect ratio, so both sit in the grid without a special case. Landscape reads
better in the lightbox; vertical travels further. Post both.

### The thing that could actually bite

Uke O Ono play covers. YouTube's Content ID will match some of them, and the
realistic outcomes, roughly in order of likelihood, are:

1. **Claimed and monetised by the rights holder.** The video stays up, ads run
   on it, someone else gets the money. Annoying, survivable, and by far the
   most common.
2. **Blocked in some countries.** The gallery tile plays for most visitors and
   not for others, with no warning on our side.
3. **Muted audio.** Rare for live performance, more likely if a studio
   recording is audible in the background.
4. **Removed.** Uncommon for a live cover; likelier if a video uses someone
   else's recording.

Three mitigations, none of them expensive:

- **Keep the originals.** They should be kept anyway, and they are the whole
  escape hatch.
- **The poster is ours (§5)**, so a dead video degrades to a still frame rather
  than a broken tile.
- **The self-hosted path stays available for one-offs.** If a clip we care
  about gets blocked, transcode that single file by hand and serve it from the
  media bucket. That is a manual fallback for a handful of items, deliberately
  not a pipeline: building the automation for a case that may never arrive is
  how we end up maintaining ffmpeg for nothing.

**Instagram is still not embedded.** Its embed script is heavy and it breaks
whenever Meta feels like it. The existing "Instagram has the latest" link stays
as-is. Cross-posting clips to Instagram is a content decision, not a build one.

## 7. Getting media in

The band take photos on phones. The workflow has to survive that.

### Phase 1 — a CLI, run by a developer

```sh
# photos: drop files into media-inbox/2026-08-22-bowlers-rest/ then
npm run gallery:add -- 2026-08-22-bowlers-rest

# video: upload from the phone first, then hand the script the link
npm run gallery:video -- 2026-08-22-bowlers-rest https://youtu.be/aBcDeFgHiJk
```

`packages/site/scripts/media-ingest.mjs`:

1. Reads EXIF `DateTimeOriginal` to order items and sanity-check the date
   against the gig, then strips all EXIF from the output.
2. Generates every derivative with `sharp`, content-hashing each stem.
3. Writes or updates `_data/media/<gig-slug>.json`, preserving captions and
   song tags already written there.
4. `aws s3 sync`s derivatives to the media bucket with the immutable header.
5. Prints what changed. The JSON is then committed by hand, so every gallery
   change is a reviewable diff.

The video command is the same script with a different front door: it reads
title and thumbnail from YouTube's oEmbed endpoint (no API key, no
authentication), pulls the poster frame, and pushes it through steps 2 to 5
unchanged. The only thing oEmbed does not return is duration, so the `0:41`
badge on a tile either gets typed in with `--seconds`, or fetched with a free
YouTube Data API key kept in the already-gitignored `.env`. The badge is
cosmetic; the key is optional and never ships to the browser.

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
- `privacy.md` gains one line for YouTube, in the same shape as the existing
  analytics paragraph: nothing is sent to Google until you press play, and
  pressing play loads the player from `youtube-nocookie.com`. That claim is
  only true because the posters are self-hosted (§5), so the two decisions have
  to stay married.

## 9. Build order

| Step | Work                                                                   | Ships                             |
| ---- | ---------------------------------------------------------------------- | --------------------------------- |
| 1    | Media bucket + `/media/*` behaviour in `system.ts`                     | Infrastructure, no visible change |
| 2    | `_data/gigs.js`, `gigs-archive.json`, `songs.json`, media JSON schema  | Data model                        |
| 3    | `media-ingest.mjs` with sharp/sync, plus the YouTube poster front door | One gig's media live in S3        |
| 4    | `/gallery/` page, chosen design, server-rendered first two gigs        | **A usable gallery**              |
| 5    | Chunk loading, `IntersectionObserver`, lightbox                        | Scales past one screen            |
| 6    | Filter chips, URL state, deep links                                    | Browsable                         |
| 7    | YouTube facade on click, `privacy.md` line, nav link from the flyer    | Complete                          |

Steps 1-4 are the minimum that is worth deploying. Everything after is additive
and can land a gig at a time.

## 10. Open questions

1. **Design A, B, or C?** §2 recommends B.
2. **How much old material is there?** A back catalogue of 300 photos from
   previous years changes the Phase 2 priority considerably.
3. **Is the channel set up, and under whose account?** It wants to be a band
   account nobody loses access to when a phone is replaced, not one member's
   personal login. This is now infrastructure.
4. **Should the gallery link from the flyer's main nav**, or stay a footer link
   until it has enough in it to be worth the click?
