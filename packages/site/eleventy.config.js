import { Buffer } from "node:buffer";
import process from "node:process";

export default function (eleventyConfig) {
  eleventyConfig.amendLibrary("md", (md) => {
    md.set({ typographer: true });
    md.enable(["replacements", "smartquotes"]);
  });

  eleventyConfig.addPassthroughCopy({ assets: "assets" });
  eleventyConfig.addPassthroughCopy({ static: "/" });

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
