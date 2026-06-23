import { type App, type Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

// A fixed dummy ARN so snapshots stay stable; shape matches a real us-east-1
// ACM cert ARN (the kind you'd validate in Cloudflare and import).
const CERT_ARN =
  "arn:aws:acm:us-east-1:111111111111:certificate/11111111-1111-1111-1111-111111111111";

const STACK_NAMES = [
  "UkeOOnoUsEast1AlertsStack",
  "UkeOOnoSiteStack",
  "UkeOOnoCdnAlarmsStack",
  "UkeOOnoCiOidcStack",
] as const;

const stackTemplate = (app: App, name: (typeof STACK_NAMES)[number]) =>
  Template.fromStack(app.node.findChild(name) as Stack);

describe("app synthesis", () => {
  let app: App;
  let templates: Record<(typeof STACK_NAMES)[number], unknown>;

  beforeAll(() => {
    app = buildApp({
      account: "111111111111",
      siteContentPath: resolve(import.meta.dirname, "fixtures", "site"),
      alertEmail: "alerts@example.invalid",
      certArn: CERT_ARN,
    });
    templates = Object.fromEntries(
      STACK_NAMES.map((name) => [name, stackTemplate(app, name).toJSON()]),
    ) as typeof templates;
  });

  // One snapshot file per stack — keeps PR diffs scoped to the stacks that
  // actually changed instead of bundling all four into a single .snap file.
  // The template object is handed to the matcher directly so vitest's snapshot
  // serializer pipeline runs; CDK asset hashes are normalised to a stable
  // placeholder there (see vitest.setup.ts).
  it.each(STACK_NAMES)("%s matches snapshot", async (name) => {
    await expect(templates[name]).toMatchFileSnapshot(`./__snapshots__/${name}.snap`);
  });

  // Functional assertions sit alongside the snapshots for two reasons. (1) A
  // snapshot diff tells you "something changed" but not whether the change is
  // safe — the assertions below pin properties that *must* hold regardless of
  // refactors. (2) They also illustrate the kinds of checks worth writing
  // against composureCDK output beyond the synth snapshot.

  describe("CloudFront distribution", () => {
    it("serves apex + www on the imported us-east-1 certificate", () => {
      stackTemplate(app, "UkeOOnoSiteStack").hasResourceProperties(
        "AWS::CloudFront::Distribution",
        {
          DistributionConfig: Match.objectLike({
            Aliases: ["uke-o-ono.com", "www.uke-o-ono.com"],
            ViewerCertificate: Match.objectLike({ AcmCertificateArn: CERT_ARN }),
          }),
        },
      );
    });
  });

  describe("budget", () => {
    it("limits monthly spend to 4 USD", () => {
      stackTemplate(app, "UkeOOnoUsEast1AlertsStack").hasResourceProperties(
        "AWS::Budgets::Budget",
        {
          Budget: Match.objectLike({
            BudgetLimit: { Amount: 4, Unit: "USD" },
            BudgetType: "COST",
            TimeUnit: "MONTHLY",
          }),
        },
      );
    });
  });

  describe("CDN alarms", () => {
    // Recommended-alarm coverage from composureCDK — if this drops to zero,
    // someone has flipped `recommendedAlarms(false)` on the cdn builder.
    it("creates multiple CloudWatch alarms in the edge region", () => {
      const template = stackTemplate(app, "UkeOOnoCdnAlarmsStack");
      const alarmCount = Object.keys(template.findResources("AWS::CloudWatch::Alarm")).length;
      expect(alarmCount).toBeGreaterThanOrEqual(5);
    });
  });

  describe("CI OIDC", () => {
    it("creates a deploy role scoped to the ukeoono.com repo", () => {
      const template = stackTemplate(app, "UkeOOnoCiOidcStack");
      template.hasResourceProperties("AWS::IAM::Role", {
        RoleName: "GitHubActionsDeployRole",
      });
      // Subject claim must reference exactly this repo — forks/other repos
      // mint OIDC tokens under different `repo:<owner>/<name>:*` namespaces
      // and so cannot satisfy this StringLike condition.
      const policyDoc = JSON.stringify(template.findResources("AWS::IAM::Role"));
      expect(policyDoc).toContain("repo:laazyj/ukeoono.com:ref:refs/heads/main");
      expect(policyDoc).toContain("repo:laazyj/ukeoono.com:pull_request");
    });
  });
});
