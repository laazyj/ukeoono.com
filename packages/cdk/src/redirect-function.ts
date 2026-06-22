/**
 * Builds the source for a CloudFront Function (viewer-request stage) that
 * canonicalises `www.{domain}` → apex and rewrites pretty URLs to their
 * `index.html` so S3 can serve them.
 *
 * **Runtime:** requires `cloudfront-js-2.0`.
 *
 * **Deploy boundary:** only the string between the backticks below ships to
 * CloudFront. Everything else in this file (and any module it imports) runs
 * at synth time on the build host.
 */
export function buildRedirectFunctionCode(domain: string): string {
  const wwwHost = JSON.stringify(`www.${domain}`);
  const apexOrigin = JSON.stringify(`https://${domain}`);

  return `
var WWW_HOST = ${wwwHost};
var APEX_ORIGIN = ${apexOrigin};

function handler(event) {
  var req = event.request;
  var host = req.headers.host && req.headers.host.value;
  var uri = req.uri;

  if (host === WWW_HOST) {
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: {
        location: { value: APEX_ORIGIN + uri }
      }
    };
  }

  var lastSlash = uri.lastIndexOf("/");
  var lastDot = uri.lastIndexOf(".");
  var hasExtension = lastDot > lastSlash;

  // Eleventy emits pretty URLs as <path>/index.html. CloudFront's
  // defaultRootObject only rewrites "/" → "/index.html", so map directory-
  // style requests onto their index file before the S3 origin sees them.
  if (uri.endsWith("/")) {
    req.uri = uri + "index.html";
  } else if (!hasExtension) {
    req.uri = uri + "/index.html";
  }

  return req;
}
`.trim();
}
