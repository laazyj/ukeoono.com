import { describe, expect, it } from "vitest";

import { buildCacheControlFunctionCode, CACHE_CONTROL } from "../src/cache-control-function.js";

interface Header {
  value: string;
}
interface CfResponse {
  statusCode: number;
  headers: Record<string, Header>;
}
type Handler = (event: {
  request: { uri: string; querystring: Record<string, Header> };
  response: CfResponse;
}) => CfResponse;

// Evaluate the exact source that ships to CloudFront and pull out its handler.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const load = new Function(`${buildCacheControlFunctionCode()}\nreturn handler;`) as () => Handler;
const handler = load();

function cacheControl(uri: string, { v, status = 200 }: { v?: string; status?: number } = {}) {
  const res = handler({
    request: { uri, querystring: v ? { v: { value: v } } : {} },
    response: { statusCode: status, headers: {} },
  });
  return res.headers["cache-control"].value;
}

describe("cache-control function", () => {
  it.each([
    "/",
    "/privacy/",
    "/privacy",
    "/privacy/index.html",
    "/sitemap.xml",
    "/robots.txt",
    "/site.webmanifest",
  ])("revalidates page %s on every visit", (uri) => {
    expect(cacheControl(uri)).toBe(CACHE_CONTROL.revalidate);
  });

  it("keeps content-versioned assets for a year", () => {
    expect(cacheControl("/assets/styles.css", { v: "0df208eb56" })).toBe(CACHE_CONTROL.immutable);
    expect(cacheControl("/band/1.jpg", { v: "36de6bf14a" })).toBe(CACHE_CONTROL.immutable);
  });

  it("keeps unversioned assets for a day", () => {
    expect(cacheControl("/assets/styles.css")).toBe(CACHE_CONTROL.day);
    expect(cacheControl("/favicon.svg")).toBe(CACHE_CONTROL.day);
    expect(cacheControl("/grunge.png")).toBe(CACHE_CONTROL.day);
  });

  it("never lets an error response stick", () => {
    expect(cacheControl("/missing.png", { status: 404 })).toBe(CACHE_CONTROL.revalidate);
    expect(cacheControl("/assets/styles.css", { v: "x", status: 403 })).toBe(
      CACHE_CONTROL.revalidate,
    );
  });

  it("keeps 304 Not Modified responses on the same policy", () => {
    expect(cacheControl("/", { status: 304 })).toBe(CACHE_CONTROL.revalidate);
    expect(cacheControl("/assets/styles.css", { v: "x", status: 304 })).toBe(
      CACHE_CONTROL.immutable,
    );
  });
});
