import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";

export default function (eleventyConfig) {
  eleventyConfig.amendLibrary("md", (md) => {
    md.set({ typographer: true });
    md.enable(["replacements", "smartquotes"]);
  });

  eleventyConfig.addPassthroughCopy({ assets: "assets" });
  eleventyConfig.addPassthroughCopy({ static: "/" });

  // Past gigs, one Markdown file each, newest first by their `date`.
  eleventyConfig.addCollection("backCatalogue", (api) =>
    api.getFilteredByGlob("./content/back-catalogue/*.md").reverse(),
  );

  eleventyConfig.addGlobalData("currentYear", () => new Date().getFullYear());
  eleventyConfig.addGlobalData("analytics", () => ({
    measurementId: process.env.GA_MEASUREMENT_ID || null,
  }));
  eleventyConfig.addGlobalData("build", () => ({
    sha: process.env.GITHUB_SHA || "dev",
  }));

  // Convert a root-absolute path ("/assets/x.css") into a path relative to the
  // current page. Lets the site render under any URL prefix without a
  // build-time pathPrefix flag.
  eleventyConfig.addFilter("rel", function (target) {
    if (typeof target !== "string" || !target.startsWith("/")) return target;
    const pageUrl =
      (this.page && this.page.url) || (this.ctx && this.ctx.page && this.ctx.page.url) || "/";
    const depth = pageUrl.split("/").filter(Boolean).length;
    const prefix = depth === 0 ? "./" : "../".repeat(depth);
    return prefix + target.replace(/^\//, "");
  });

  // Version every local file a page links to by a hash of its contents
  // (`src="./band/1.jpg"` -> `src="./band/1.jpg?v=36de6bf14a"`). The URL only
  // changes when the file does, so browsers can keep it for a year (the CDN
  // marks ?v= responses immutable) yet never pair a new page with an old copy.
  // Runs on every HTML page, so templates don't need to opt in. /assets/*
  // comes from assets/, everything else from static/ (the passthrough copies
  // above). Pages (.html, pretty URLs) and external links are left alone.
  const hashes = new Map();
  eleventyConfig.on("eleventy.before", () => hashes.clear());
  const versionOf = (sitePath) => {
    if (!hashes.has(sitePath)) {
      const dir = sitePath.startsWith("/assets/") ? "" : "static";
      const source = path.join(import.meta.dirname, dir, sitePath);
      hashes.set(
        sitePath,
        existsSync(source)
          ? createHash("sha256").update(readFileSync(source)).digest("hex").slice(0, 10)
          : null,
      );
    }
    return hashes.get(sitePath);
  };
  eleventyConfig.addTransform("version-assets", function (content) {
    if (!this.page.outputPath?.endsWith(".html")) return content;
    const pageUrl = new URL(this.page.url, "https://site.invalid");
    return content.replace(/\b(src|href)="([^"?#:]+\.[a-z0-9]+)"/gi, (match, attr, ref) => {
      if (ref.endsWith(".html")) return match;
      const hash = versionOf(decodeURIComponent(new URL(ref, pageUrl).pathname));
      return hash ? `${attr}="${ref}?v=${hash}"` : match;
    });
  });

  // Base64-encode a string. Used to keep the contact email out of the page
  // source as scrapeable plaintext — the email-link partial ships the encoded
  // address and the decoder in base.njk turns it back into a mailto client-side.
  eleventyConfig.addFilter("base64", (s) => Buffer.from(String(s), "utf8").toString("base64"));

  // Drop falsy entries. Used to build the JSON-LD sameAs list from the
  // (optionally empty) social links in site.json.
  eleventyConfig.addFilter("compact", (arr) => (Array.isArray(arr) ? arr.filter(Boolean) : arr));

  // A schema.org Person node for the JSON-LD @graph. site.json `team` is a list
  // of people, each with a `roles` list ("builder" | "maintainer").
  eleventyConfig.addFilter("personNode", (p) => {
    const node = { "@type": "Person", "@id": p.url, name: p.name, url: p.url };
    if (p.sameAs && p.sameAs.length) node.sameAs = p.sameAs;
    return node;
  });

  return {
    dir: {
      input: "content",
      output: "dist",
      includes: "../_includes",
      data: "../_data",
    },
    templateFormats: ["njk", "md", "html"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
