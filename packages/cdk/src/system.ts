import { Duration, type Stack } from "aws-cdk-lib";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import {
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  PriceClass,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { HealthCheckType } from "aws-cdk-lib/aws-route53";
import { Source } from "aws-cdk-lib/aws-s3-deployment";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";

import { compose, ref } from "@composurecdk/core";
import { createBudgetBuilder } from "@composurecdk/budgets";
import { alarmActionsPolicy } from "@composurecdk/cloudwatch";
import {
  createHealthCheckAlarmBuilder,
  createHealthCheckBuilder,
  type HealthCheckBuilderResult,
} from "@composurecdk/route53";
import {
  createBucketBuilder,
  createBucketDeploymentBuilder,
  type BucketBuilderResult,
} from "@composurecdk/s3";
import {
  createCloudFrontAlarmBuilder,
  createDistributionBuilder,
  type DistributionBuilderResult,
} from "@composurecdk/cloudfront";
import { createTopicBuilder, type TopicBuilderResult } from "@composurecdk/sns";
import { outputs } from "@composurecdk/cloudformation";

import { buildRedirectFunctionCode } from "./redirect-function.js";

// 90 days: ample audit runway for a flyer site, well under the 731-day default.
const LOG_BUCKET_LIFECYCLE_RULES = [{ expiration: Duration.days(90) }];

export interface SystemStacks {
  /** SNS topic shared by every us-east-1 alarm. No downstream deps to avoid cycles. */
  readonly usEast1AlertsStack: Stack;
  /** S3 bucket, CloudFront distribution, bucket deployment, Route 53 health check. */
  readonly siteStack: Stack;
  /**
   * Alarms whose underlying CloudWatch metrics emit only in `us-east-1`:
   * CloudFront distribution metrics and AWS/Route53 health-check metrics.
   */
  readonly cdnAlarmsStack: Stack;
}

const topicArnOutput = (refName: "usEast1Alerts" | "siteAlerts", role: string) => ({
  value: ref<TopicBuilderResult>(refName)
    .get("topic")
    .map((t) => t.topicArn),
  description: `Subscribe here to receive ${role}.`,
  scope: refName,
});

export interface SystemOptions {
  /** Apex domain — e.g. `uke-o-ono.com`. `www.{domain}` is computed from it. */
  readonly domain: string;
  /** Directory whose contents are uploaded to the site bucket. */
  readonly siteContentPath: string;
  /** Email address subscribed to both alarm topics. */
  readonly alertEmail: string;
  /**
   * ARN of a pre-validated ACM certificate (in `us-east-1`) covering the apex
   * and `www`. DNS is hosted at Cloudflare, so the certificate is validated
   * there by hand and imported here by ARN rather than created/validated in
   * Route 53.
   */
  readonly certArn: string;
}

/**
 * Wires the multi-stack system using composureCDK's `compose()` builder.
 *
 * DNS lives at Cloudflare (the domain is on Cloudflare Registrar, which pins the
 * nameservers), so this app owns no hosted zone or records. The apex/`www`
 * CNAMEs and the ACM validation record are added in Cloudflare by hand; the
 * certificate is then imported by ARN.
 *
 * The `compose()` pattern in three parts:
 *
 *  1. **Builders block** — first arg. Each key is a builder; `ref<T>("name")`
 *     refers to another builder's result lazily.
 *  2. **Dependency block** — second arg. Drives topological ordering and
 *     attaches cross-stack references when a dependency lives in another stack.
 *  3. **`.withStacks()` + `.afterBuild()`** — routes each builder to a Stack and
 *     runs post-build wiring (outputs, alarm-action policies).
 *
 * Cross-region note: CloudFront/Route53 metrics only emit in `us-east-1`, so
 * those alarms live in `cdnAlarmsStack` and target the standalone `usEast1Alerts`
 * topic (no downstream deps) to keep the graph acyclic.
 */
export function createSystem(stacks: SystemStacks, options: SystemOptions) {
  const { usEast1AlertsStack, siteStack, cdnAlarmsStack } = stacks;
  const { domain, siteContentPath, alertEmail, certArn } = options;
  const www = `www.${domain}`;

  const bucket = ref<BucketBuilderResult>("bucket").get("bucket");
  const distribution = ref<DistributionBuilderResult>("cdn").get("distribution");
  // Imported, not created: the cert is validated in Cloudflare and referenced by
  // ARN. fromCertificateArn is a plain reference (no resource, no cross-stack
  // ref); CloudFront requires the ARN to be us-east-1, which it must already be.
  const certificate = Certificate.fromCertificateArn(siteStack, "SiteCert", certArn);

  return compose(
    {
      // CloudWatch alarms can only target same-region SNS topics, so one topic per region.
      usEast1Alerts: createTopicBuilder()
        .displayName(`${domain} us-east-1 alerts`)
        .addSubscription("email", new EmailSubscription(alertEmail)),
      siteAlerts: createTopicBuilder()
        .displayName(`${domain} site alerts`)
        .addSubscription("email", new EmailSubscription(alertEmail)),

      budget: createBudgetBuilder()
        .budgetName(`${domain}-monthly`)
        .limit({ amount: 4, unit: "USD" })
        .withRecommendedThresholds({ sns: ref<TopicBuilderResult>("usEast1Alerts").get("topic") })
        .recommendedAlarms(false),

      // SITE
      bucket: createBucketBuilder()
        .serverAccessLogs({
          prefix: "logs/",
          configure: (sub) => sub.lifecycleRules(LOG_BUCKET_LIFECYCLE_RULES),
        })
        .lifecycleRules([{ noncurrentVersionExpiration: Duration.days(30) }]),
      cdn: createDistributionBuilder()
        .comment(domain)
        .domainNames([domain, www])
        .certificate(certificate)
        .defaultRootObject("index.html")
        .priceClass(PriceClass.PRICE_CLASS_100)
        .accessLogs({
          prefix: "logs/",
          configure: (sub) => sub.lifecycleRules(LOG_BUCKET_LIFECYCLE_RULES),
        })
        .origin(bucket.map((b) => S3BucketOrigin.withOriginAccessControl(b)))
        .defaultBehavior({
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          functions: [
            {
              eventType: FunctionEventType.VIEWER_REQUEST,
              functionName: `${siteStack.stackName}-redirect`,
              runtime: FunctionRuntime.JS_2_0,
              code: FunctionCode.fromInline(buildRedirectFunctionCode(domain)),
              comment: "www→apex 301 + pretty-URL rewrite",
            },
          ],
        })
        .errorResponses([
          {
            httpStatus: 403,
            responseHttpStatus: 404,
            responsePagePath: "/404.html",
            ttl: Duration.seconds(60),
          },
          {
            httpStatus: 404,
            responseHttpStatus: 404,
            responsePagePath: "/404.html",
            ttl: Duration.seconds(60),
          },
        ])
        // CloudFront metrics only emit in us-east-1; alarms must live there too.
        .recommendedAlarms(false),
      cdnAlarms: createCloudFrontAlarmBuilder().distribution(ref<DistributionBuilderResult>("cdn")),

      // HEALTHCHECK — pings the public apex (which resolves via Cloudflare).
      healthCheck: createHealthCheckBuilder()
        .type(HealthCheckType.HTTPS)
        .fqdn(domain)
        .recommendedAlarms(false),
      healthCheckAlarms: createHealthCheckAlarmBuilder().healthCheck(
        ref<HealthCheckBuilderResult>("healthCheck"),
      ),

      deploy: createBucketDeploymentBuilder()
        .sources([Source.asset(siteContentPath)])
        .destinationBucket(bucket)
        .distribution(distribution)
        .distributionPaths(["/*"])
        .prune(true),
    },
    {
      usEast1Alerts: [],
      siteAlerts: [],
      budget: ["usEast1Alerts"],
      bucket: [],
      cdn: ["bucket"],
      cdnAlarms: ["cdn"],
      healthCheck: [],
      healthCheckAlarms: ["healthCheck"],
      deploy: ["bucket", "cdn"],
    },
  )
    .withStacks({
      usEast1Alerts: usEast1AlertsStack,
      siteAlerts: siteStack,
      budget: usEast1AlertsStack,
      bucket: siteStack,
      cdn: siteStack,
      cdnAlarms: cdnAlarmsStack,
      healthCheck: siteStack,
      healthCheckAlarms: cdnAlarmsStack,
      deploy: siteStack,
    })
    .afterBuild(
      outputs({
        DistributionDomainName: {
          value: distribution.map((d) => d.distributionDomainName),
          description: "CloudFront domain — point the apex and www CNAMEs at this in Cloudflare.",
          scope: "cdn",
        },
        SiteBucketName: {
          value: bucket.map((b) => b.bucketName),
          description: "S3 bucket backing the distribution.",
          scope: "bucket",
        },
        UsEast1AlertsTopicArn: topicArnOutput(
          "usEast1Alerts",
          "alarm notifications from every us-east-1 stack",
        ),
        SiteAlertsTopicArn: topicArnOutput("siteAlerts", "site-stack alarm notifications"),
      }),
    )
    .afterBuild((_scope, _id, results) => {
      const usEast1Action = new SnsAction(results.usEast1Alerts.topic);
      alarmActionsPolicy(usEast1AlertsStack, { defaults: { alarmActions: [usEast1Action] } });
      alarmActionsPolicy(cdnAlarmsStack, { defaults: { alarmActions: [usEast1Action] } });
      alarmActionsPolicy(siteStack, {
        defaults: { alarmActions: [new SnsAction(results.siteAlerts.topic)] },
      });
    });
}
