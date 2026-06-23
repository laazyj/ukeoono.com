# `@uke-o-ono/cdk`

AWS CDK app that owns the CDN, S3 bucket, monitoring, and CI deploy role for
[uke-o-ono.com](https://uke-o-ono.com/).

**DNS lives at Cloudflare, not AWS.** The domain is registered with Cloudflare
Registrar, which pins the domain to Cloudflare's nameservers — so this app owns
no Route 53 hosted zone. The TLS certificate is validated by hand in Cloudflare
and **imported by ARN**, and the apex / `www` records are CNAMEs in Cloudflare
pointing at the CloudFront distribution. See [DNS & certificate](#dns--certificate).

Built with [composureCDK](https://github.com/laazyj/composureCDK): the
application stacks are wired declaratively as one composed system in
[`src/system.ts`](./src/system.ts) and deploy together with `cdk deploy --all`.

## File map

| File                                                           | Role                                                                                                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/app.ts`](./src/app.ts)                                   | Entry point. Builds the `App`, the three application stacks, and the standalone CI OIDC stack. The top-of-file `CONFIG` block holds the domain and regions. |
| [`src/system.ts`](./src/system.ts)                             | The composition root — the `compose(...)` call that wires every builder.                                                                                    |
| [`src/stacks/ci-oidc-stack.ts`](./src/stacks/ci-oidc-stack.ts) | Standalone OIDC provider + `GitHubActionsDeployRole` assumed by `.github/workflows/`.                                                                       |
| [`src/redirect-function.ts`](./src/redirect-function.ts)       | The CloudFront viewer-request function source: `www`→apex 301 + pretty-URL → `index.html` rewrite. Only the string between the backticks ships to the edge. |
| [`scripts/`](./scripts/)                                       | Post-deploy operational scripts: the live-site smoke test.                                                                                                  |
| [`test/`](./test/)                                             | Vitest snapshot tests + functional assertions. Snapshots are committed and reviewed in PRs.                                                                 |

## Stack architecture

```
Cross-region edge (auto-wired by `crossRegionReferences: true`):

  SiteStack  (eu-west-2) ── distribution id ─▶ CdnAlarmsStack (us-east-1)

Same-region edge (us-east-1):

  UsEast1AlertsStack ── alarm actions ──▶ CdnAlarmsStack

Standalone (no edges to the application stacks):

  CiOidcStack
```

Three application stacks plus a standalone CI stack:

- **`UkeOOnoSiteStack`** (`eu-west-2`) — S3 bucket, CloudFront distribution
  (TLS via the imported us-east-1 ACM cert), CloudFront Function (`www`→apex
  301 + pretty-URL rewrite), bucket deployment of the Eleventy output, a
  Route 53 health check on the public apex, and an SNS topic for site-region
  alarms. The cert is referenced with `Certificate.fromCertificateArn(...)` —
  a plain ARN reference, so no resource and no cross-region plumbing.
- **`UkeOOnoUsEast1AlertsStack`** (`us-east-1`) — SNS topic shared by every
  us-east-1 alarm (CloudFront, health check) plus the monthly Budget. No
  downstream deps so any us-east-1 stack can target it without creating a cycle.
- **`UkeOOnoCdnAlarmsStack`** (`us-east-1`) — CloudFront and Route 53
  health-check CloudWatch alarms. Both metric streams emit **only** in
  `us-east-1`, so the alarms must live there too (this is the only reason the
  app still spans two regions).
- **`UkeOOnoCiOidcStack`** (`eu-west-2`) — GitHub OIDC provider and the
  `GitHubActionsDeployRole`. Standalone; deployed once from a workstation.

Every stack opts in to `crossRegionReferences: true` for the single
`SiteStack → CdnAlarmsStack` edge; deployment order is inferred from the
references, so no `addDependency` calls are needed.

## DNS & certificate

Because the domain is on Cloudflare Registrar (nameservers locked to
Cloudflare), AWS cannot be authoritative for the zone. So two things are done
**by hand in the Cloudflare dashboard**, and the cert ARN is passed to the app
via the `CERT_ARN` environment variable / GitHub repo variable.

### 1. Request + validate the certificate (one-time)

In **ACM, us-east-1** (CloudFront requires us-east-1), request a public cert for
`uke-o-ono.com` with `www.uke-o-ono.com` as a SAN, DNS validation:

```sh
aws acm request-certificate --region us-east-1 \
  --domain-name uke-o-ono.com \
  --subject-alternative-names www.uke-o-ono.com \
  --validation-method DNS \
  --query CertificateArn --output text
```

Read the two validation `CNAME` records ACM wants:

```sh
aws acm describe-certificate --region us-east-1 --certificate-arn <ARN> \
  --query "Certificate.DomainValidationOptions[].ResourceRecord" --output table
```

Add both as **CNAME** records in Cloudflare (DNS-only / grey cloud). Within a
few minutes the cert flips to `ISSUED`. That `<ARN>` is the value for `CERT_ARN`.

### 2. Point the domain at CloudFront (after the first deploy)

After `SiteStack` deploys, read the distribution domain:

```sh
aws cloudformation describe-stacks --region eu-west-2 --stack-name UkeOOnoSiteStack \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionDomainName'].OutputValue" --output text
```

In Cloudflare add, both **DNS-only / grey cloud**:

| Type  | Name            | Target                   |
| ----- | --------------- | ------------------------ |
| CNAME | `uke-o-ono.com` | `<dxxxx>.cloudfront.net` |
| CNAME | `www`           | `<dxxxx>.cloudfront.net` |

Cloudflare flattens the apex CNAME automatically. Grey-cloud so CloudFront
terminates TLS with the ACM cert and the `www`→apex function runs at the edge.

## Deploying

Pushes to `main` deploy automatically (see [Continuous deployment](#continuous-deployment)).
The manual flow is the fallback for first-time bootstrap or emergencies.

Required env: `ALERT_EMAIL` (subscribed to both alarm topics) and `CERT_ARN`
(the issued us-east-1 cert ARN). Synth fails if either is unset. Authenticate to
the account first (`aws sso login`), then:

```sh
export ALERT_EMAIL=alert@jasonduffett.org
export CERT_ARN=arn:aws:acm:us-east-1:<account>:certificate/<id>
npm run site:build   # build site content
npm run cdk:diff     # preview changes
npm run cdk:deploy   # apply (all stacks)
```

After the first deploy, AWS sends one SNS confirmation email per topic
(us-east-1 and eu-west-2 / site). Click both confirm links — alerts only flow
once the subscriptions are `Confirmed`.

### First-time setup

1. **Bootstrap** both regions once: `npx cdk bootstrap aws://<account>/eu-west-2`
   and `.../us-east-1`.
2. **Certificate** — do [DNS & certificate step 1](#1-request--validate-the-certificate-one-time)
   and note the ARN.
3. **CI OIDC stack** — `ALERT_EMAIL=… CERT_ARN=… npm run cdk:deploy:stack -- UkeOOnoCiOidcStack`;
   note the `GitHubActionsDeployRoleArn` output.
4. **GitHub config** (see [CI bootstrap](#ci-bootstrap-one-time)).
5. **Deploy** the rest (push to `main`, or `npm run cdk:deploy`).
6. **DNS** — do [DNS & certificate step 2](#2-point-the-domain-at-cloudfront-after-the-first-deploy).

## CDK scripts

Run from the repo root (each runs the cdk + site build first via Nx):

- `npm run cdk:synth` / `npm run cdk:diff` — render / preview all stacks.
- `npm run cdk:deploy` — deploy **all** stacks.
- `npm run cdk:deploy:stack -- <StackName>` — single stack.
- `npm run site:smoke` — post-deploy smoke (homepage, sitemap, sample, 404, www→apex).

## Continuous deployment

`main` auto-deploys via GitHub Actions, authenticating to AWS via OpenID
Connect (no long-lived keys):

- **`.github/workflows/pr.yml`** — on every PR: lint, format, build, test, plus
  `cdk diff` posted as a comment.
- **`.github/workflows/deploy.yml`** — on push to `main`: verify, fresh
  `site:build` (with `GITHUB_SHA` in a `<meta name="build-sha">` tag),
  `cdk deploy --all`, and the smoke test.

### CI bootstrap (one-time)

Configure GitHub (Settings → Secrets and variables → Actions):

- **Secrets:** `AWS_DEPLOY_ROLE_ARN` (the OIDC stack output), `ALERT_EMAIL`.
- **Variables:** `CERT_ARN` (the issued cert ARN — not secret), and optionally
  `GA_MEASUREMENT_ID` (unset = no analytics tag / cookie banner).
- **Branch protection on `main`:** require a PR and the `verify` + `cdk diff`
  checks.

The deploy role's trust policy is restricted to two exact subject claims —
`repo:laazyj/ukeoono.com:ref:refs/heads/main` and
`repo:laazyj/ukeoono.com:pull_request` — so forks cannot assume it.

## Tests

```sh
npx nx run @uke-o-ono/cdk:test
```

[`test/app.test.ts`](./test/app.test.ts) synthesises every stack, snapshots the
CloudFormation, and adds functional assertions for invariants that must hold
regardless of refactors (distribution aliases + imported cert ARN, budget limit,
alarm coverage, OIDC trust policy). Regenerate snapshots after intentional infra
changes with `npx nx run @uke-o-ono/cdk:test -- -u`.

## See also

- [Top-level README](../../README.md) — repo overview.
- [`@uke-o-ono/site`](../site/README.md) — the Eleventy site this CDK app hosts.
- [composureCDK](https://github.com/laazyj/composureCDK) — the framework used here.
