import { App, Stack } from "aws-cdk-lib";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { templateTextPolicy } from "@composurecdk/cloudformation";
import { topicPolicyConflictPolicy } from "@composurecdk/sns";

import { addCiOidc } from "./stacks/ci-oidc-stack.js";
import { applyAlarmActions, createSystem } from "./system.js";

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
  /** AWS account ID. Required, so every stack has an explicit environment. */
  readonly account: string;
  /** Directory whose contents are uploaded to the site bucket. */
  readonly siteContentPath: string;
  /** Email address subscribed to both alarm topics. */
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

  // Standalone — bootstrapped once from a workstation, then GitHub Actions
  // assumes the role for all subsequent deploys. No wiring through createSystem.
  const ciOidcStack = new Stack(app, "UkeOOnoCiOidcStack", {
    ...stackProps(CONFIG.primaryRegion),
    description: "GitHub Actions OIDC provider + deploy role for laazyj/ukeoono.com.",
  });
  addCiOidc(ciOidcStack, { githubOwner: "laazyj", githubRepo: "ukeoono.com" });

  const siteStacks = { usEast1AlertsStack, siteStack, cdnAlarmsStack };
  const site = createSystem(siteStacks, {
    domain: CONFIG.domain,
    siteContentPath,
    alertEmail,
    certArn,
  }).build(app, CONFIG.domain);
  applyAlarmActions(siteStacks, site);

  return app;
}

// Synth only when invoked as the cdk app entry. Importing from tests doesn't
// trigger synth — keeps the wiring in one file without side-effecting on import.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const requireEnv = (name: string, hint: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required: ${hint}`);
    return value;
  };
  buildApp({
    // The cdk CLI sets this from the active credentials. Fail here rather than
    // silently synthesise an env-agnostic app nobody intended to deploy.
    account: requireEnv("CDK_DEFAULT_ACCOUNT", "log in to the target account first."),
    siteContentPath: resolve(import.meta.dirname, "..", "..", "site", "dist"),
    alertEmail: requireEnv("ALERT_EMAIL", "e.g. `export ALERT_EMAIL=you@example.com`."),
    certArn: requireEnv("CERT_ARN", "the ARN of the us-east-1 ACM cert (validated in Cloudflare)."),
  }).synth();
}
