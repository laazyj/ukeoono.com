import { CfnOutput, type App, type Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { buildApp, type BuildAppOptions } from "../src/app.js";

// A fixed dummy ARN so snapshots stay stable; shape matches a real us-east-1
// ACM cert ARN (the kind you'd validate in Cloudflare and import).
const CERT_ARN =
  "arn:aws:acm:us-east-1:111111111111:certificate/11111111-1111-1111-1111-111111111111";

// One set of pinned inputs for every synth in this file.
const APP_OPTIONS: BuildAppOptions = {
  account: "111111111111",
  siteContentPath: resolve(import.meta.dirname, "fixtures", "site"),
  alertEmail: "alerts@example.invalid",
  certArn: CERT_ARN,
};

const STACK_NAMES = [
  "UkeOOnoUsEast1AlertsStack",
  "UkeOOnoSiteStack",
  "UkeOOnoCdnAlarmsStack",
  "UkeOOnoCiOidcStack",
] as const;

const stackTemplate = (app: App, name: (typeof STACK_NAMES)[number]) =>
  Template.fromStack(app.node.findChild(name) as Stack);

const deployRoles = (template: Template) =>
  template.findResources("AWS::IAM::Role", { Properties: { RoleName: "GitHubActionsDeployRole" } });

describe("app synthesis", () => {
  let app: App;
  let templates: Record<(typeof STACK_NAMES)[number], unknown>;

  beforeAll(() => {
    app = buildApp(APP_OPTIONS);
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

    it("sets Cache-Control on every response with a viewer-response function", () => {
      const template = stackTemplate(app, "UkeOOnoSiteStack");
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          DefaultCacheBehavior: Match.objectLike({
            FunctionAssociations: Match.arrayWith([
              Match.objectLike({ EventType: "viewer-request" }),
              Match.objectLike({ EventType: "viewer-response" }),
            ]),
          }),
        }),
      });
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

    it("lets AWS Budgets publish to the alerts topic", () => {
      const template = stackTemplate(app, "UkeOOnoUsEast1AlertsStack");
      for (const Sid of ["AllowBudgetsPublish", "AllowPublishThroughSSLOnly"]) {
        template.hasResourceProperties("AWS::SNS::TopicPolicy", {
          PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Sid })]) },
        });
      }
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

  // The four snapshots above are all ASCII today, so nothing else in this file
  // fails if the `templateTextPolicy` call is dropped from `buildApp`. This
  // pins it: synth must reject text CloudFormation would transliterate, which
  // is what keeps `cdk diff` quiet on stacks nobody touched.
  describe("template text policy", () => {
    it("fails synth on a character CloudFormation cannot store", () => {
      const policed = buildApp(APP_OPTIONS);
      const stack = policed.node.findChild("UkeOOnoSiteStack") as Stack;
      new CfnOutput(stack, "EmDash", { value: "x", description: "an em-dash — here" });

      expect(() => Template.fromStack(stack)).toThrow(/U\+2014/);
    });
  });

  describe("CI OIDC", () => {
    // Deployed state that must not be replaced (see src/pipeline.ts). The
    // snapshot covers these ids too, but a bulk `-u` after an intended change
    // could slip a rotated id through; this cannot. Change them only through
    // the migration in #127.
    it("keeps the deployed OIDC provider and deploy role logical ids", () => {
      const template = stackTemplate(app, "UkeOOnoCiOidcStack");
      expect(Object.keys(template.findResources("Custom::AWSCDKOpenIdConnectProvider"))).toEqual([
        "GithubOidcProviderD8241A88",
      ]);
      expect(Object.keys(deployRoles(template))).toEqual(["GitHubActionsDeployRoleA6F4AD3D"]);
    });

    // The trust policy is the security boundary, so it is pinned exactly: an
    // extra subject, a dropped audience guard or a looser operator all fail.
    it("trusts only main-branch and pull-request runs of this repo", () => {
      const roles = deployRoles(stackTemplate(app, "UkeOOnoCiOidcStack"));
      expect(roles).toHaveProperty(
        ["GitHubActionsDeployRoleA6F4AD3D", "Properties", "AssumeRolePolicyDocument"],
        {
          Version: "2012-10-17",
          Statement: [
            {
              Action: "sts:AssumeRoleWithWebIdentity",
              Effect: "Allow",
              Principal: { Federated: { Ref: "GithubOidcProviderD8241A88" } },
              Condition: {
                StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
                StringLike: {
                  "token.actions.githubusercontent.com:sub": [
                    "repo:laazyj/ukeoono.com:ref:refs/heads/main",
                    "repo:laazyj/ukeoono.com:pull_request",
                  ],
                },
              },
            },
          ],
        },
      );
    });
  });
});
