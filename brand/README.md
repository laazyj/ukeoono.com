# Brand assets

## Roundel (`uke-o-ono-roundel-800.png`)

The stacked "UKE O / ONO!" mark for circular avatars (YouTube, Instagram,
Facebook). 800 x 800 PNG; the lettering sits inside the circle those sites
crop to and stays legible down to 48px.

Source: `roundel.html`, the same recipe as the site's share image (Anton,
cream lettering with an ink shadow, the eroded-stencil mask and grain from
`packages/site/static/`, on `#e02d23`). To re-render, serve the repo root
over HTTP (the masks won't load from `file://`) and screenshot the page at
800 x 800, for example:

```sh
python3 -m http.server 8000   # from the repo root
npx playwright screenshot --viewport-size=800,800 \
  http://localhost:8000/brand/roundel.html brand/uke-o-ono-roundel-800.png
```

## YouTube banner (`uke-o-ono-banner-2560x1440.png`)

2560 x 1440 PNG. The wordmark and tagline sit inside the 1546 x 423 safe area
every device shows; the two photo prints sit in the side zones that only
desktop and TV show. Source: `banner.html`. It uses gallery photos 19 and 16
from `packages/site/static/back-catalogue/fringe-2026/photos/`. Re-render at
2560 x 1440 the same way as the roundel.

## Share card (`packages/site/static/share-card.jpg`)

The image link previews show (`og:image` / `twitter:image`), 1200 x 630.
Wordmark, "Ballads & Bangers", the blurb and the web address on the left, a
pinned-up print of the band (gallery photo 19) on the right. Source:
`share-card.html`; re-render at 1200 x 630 the same way as the roundel and save
as JPEG.

Platforms cache share images by URL for weeks, so when the design changes,
save it under a **new file name** and update `defaultOgImage` in
`packages/site/_data/site.json`. Then ask each platform to re-scrape (for
example the Facebook Sharing Debugger).
