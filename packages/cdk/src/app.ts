import { App, Stack } from "aws-cdk-lib";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { templateTextPolicy } from "@composurecdk/cloudformation";
import { at, compose } from "@composurecdk/core";
import { topicPolicyConflictPolicy } from "@composurecdk/sns";

import { createPipeline } from "./pipeline.js";
import { createSystem } from "./system.js";

/**
 * Edit-points for forking this app to a different domain. Everything domain-
 * specific lives here; the rest of the code reads from the values passed
 * through `createSystem()`.
 *
 * `edgeRegion` is fixed to `us-east-1` because that's where CloudFront and
 * Route 53 health-check metrics emit, so the alarms watching them must live
 * there. `primaryRegion` is otherwise free. (The ACM cert is created by hand
 * in us-east-1 and imported by ARN — see `certArn` — so it needs no stack.)
 */
const CONFIG = {
  domain: "uke-o-ono.com",
  primaryRegion: "eu-west-2",
  edgeRegion: "us-east-1",
} as const;

export interface BuildAppOptions {
  /** AWS account ID. `undefined` produces an env-agnostic synth (cdk's default). */
  readonly account: string | undefined;
  /** Directory whose contents are uploaded to the site bucket. */
  readonly siteContentPath: string;
  /** Email address subscribed to the alarm topic. */
  readonly alertEmail: string;
  /** ARN of the pre-validated us-east-1 ACM cert (validated in Cloudflare). */
  readonly certArn: string;
}

/**
 * Constructs the App + stacks but does not call `synth()`. Tests import this
 * to snapshot the same wiring CDK actually deploys.
 */
export function buildApp({ account, siteContentPath, alertEmail, certArn }: BuildAppOptions): App {
  const app = new App();

  // Fail synth on template text CloudFormation would transliterate, rather than
  // live with the `cdk diff` noise it causes forever after. `functionCode` is
  // not in the policy's default registry, and the redirect function's inline JS
  // carries prose comments.
  templateTextPolicy(app, { fields: { "AWS::CloudFront::Function": ["functionCode"] } });

  // An SNS topic holds one access policy and each TopicPolicy replaces it
  // outright, so two policy resources on one topic silently race. Fail synth on
  // that, rather than find out when an alert never arrives.
  topicPolicyConflictPolicy(app);

  // Both ends of a cross-region ref must opt in, so every stack sets the flag.
  const stackProps = (region: string) => ({
    env: { account, region },
    crossRegionReferences: true,
  });

  // Dedicated topic stack so it has no downstream deps and every us-east-1
  // stack (cdnAlarms, future) can target the same topic without cycles.
  const usEast1AlertsStack = new Stack(app, "UkeOOnoUsEast1AlertsStack", {
    ...stackProps(CONFIG.edgeRegion),
    description: "Notification topic + budget for us-east-1 alarms (CloudFront, health check).",
  });

  const siteStack = new Stack(app, "UkeOOnoSiteStack", {
    ...stackProps(CONFIG.primaryRegion),
    description: `Static site for ${CONFIG.domain} on CloudFront + S3.`,
  });

  // CloudFront and Route 53 health-check metrics emit only in us-east-1, so
  // their alarms must live there. Reads the distribution id from siteStack.
  const cdnAlarmsStack = new Stack(app, "UkeOOnoCdnAlarmsStack", {
    ...stackProps(CONFIG.edgeRegion),
    description: "CloudWatch alarms for site metrics that AWS only emits in us-east-1.",
  });

  // Deployed once from a workstation, then GitHub Actions assumes its role for
  // every later deploy.
  const ciStack = new Stack(app, "UkeOOnoCiOidcStack", {
    ...stackProps(CONFIG.primaryRegion),
    description: "GitHub Actions OIDC provider + deploy role for laazyj/ukeoono.com.",
  });

  // The app is two sibling systems with no edges between them: the site, and
  // the pipeline that deploys it. `at(CONFIG.domain, ...)` keeps the site's
  // components at `uke-o-ono.com/<key>`; changing that path replaces every
  // site resource.
  compose(
    {
      site: at(
        CONFIG.domain,
        createSystem(
          { usEast1AlertsStack, siteStack, cdnAlarmsStack },
          { domain: CONFIG.domain, siteContentPath, alertEmail, certArn },
        ),
      ),
      pipeline: createPipeline({ ciStack }, { githubOwner: "laazyj", githubRepo: "ukeoono.com" }),
    },
    { site: [], pipeline: [] },
  ).build(app, CONFIG.domain);

  return app;
}

// Synth only when invoked as the cdk app entry. Importing from tests doesn't
// trigger synth — keeps the wiring in one file without side-effecting on import.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const alertEmail = process.env.ALERT_EMAIL;
  if (!alertEmail) {
    throw new Error("ALERT_EMAIL is required, e.g. `export ALERT_EMAIL=you@example.com`.");
  }
  const certArn = process.env.CERT_ARN;
  if (!certArn) {
    throw new Error(
      "CERT_ARN is required — the ARN of the us-east-1 ACM cert (validated in Cloudflare).",
    );
  }
  buildApp({
    account: process.env.CDK_DEFAULT_ACCOUNT,
    siteContentPath: resolve(import.meta.dirname, "..", "..", "site", "dist"),
    alertEmail,
    certArn,
  }).synth();
}
