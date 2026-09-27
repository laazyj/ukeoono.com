/**
 * Builds the source for a CloudFront Function (viewer-response stage) that
 * sets `Cache-Control` for browsers by kind of file. Nothing in S3 carries
 * cache metadata, and without it browsers guess how long to keep a file, which
 * paired new pages with a stale stylesheet after a deploy.
 *
 * - Content-versioned assets (`?v=<hash>`, added to every local file a page
 *   links to by the site's `version-assets` transform): cache for a year. A
 *   change means a new URL.
 * - Pages (`/`, `/path/`, extensionless paths, `.html`, `.xml`, `.txt`,
 *   `.webmanifest`) and every error response: revalidate on each visit (a
 *   cheap 304), so new gigs and new asset URLs show up straight away.
 * - Everything else (favicons, textures, unversioned images): one day.
 *
 * CloudFront's own edge caching is unaffected: it still follows the cache
 * policy, and each deploy invalidates `/*`.
 *
 * **Runtime:** requires `cloudfront-js-2.0`.
 *
 * **Deploy boundary:** only the string between the backticks below ships to
 * CloudFront. Everything else in this file runs at synth time.
 */
export const CACHE_CONTROL = {
  immutable: "public, max-age=31536000, immutable",
  revalidate: "public, max-age=0, must-revalidate",
  day: "public, max-age=86400",
} as const;

export function buildCacheControlFunctionCode(): string {
  return `
var CC = ${JSON.stringify(CACHE_CONTROL)};
var PAGE = /\\.(html|xml|txt|webmanifest)$/;

function handler(event) {
  var req = event.request;
  var res = event.response;
  var uri = req.uri;
  var value;

  var lastSlash = uri.lastIndexOf("/");
  var hasExtension = uri.lastIndexOf(".") > lastSlash;

  if (res.statusCode >= 400) {
    // Never let a 404 (or any error) stick in a browser.
    value = CC.revalidate;
  } else if (req.querystring && req.querystring.v) {
    value = CC.immutable;
  } else if (!hasExtension || PAGE.test(uri)) {
    value = CC.revalidate;
  } else {
    value = CC.day;
  }

  res.headers["cache-control"] = { value: value };
  return res;
}
`.trim();
}
