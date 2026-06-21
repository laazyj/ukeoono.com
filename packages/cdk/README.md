# `@uke-o-ono/cdk`

AWS CDK app that owns the domain, DNS, certificate, CDN, S3 bucket, alarms,
and CI deploy role for [uke-o-ono.com](https://uke-o-ono.com/).

Built with [composureCDK](https://github.com/laazyj/composureCDK): the five
application stacks are wired declaratively as one composed system in
[`src/system.ts`](./src/system.ts) and deploy together with
`cdk deploy --all`. The docblock on `createSystem()` walks through the three
moving parts (the builder block, the dependency block, and the
`withStacks` / `afterBuild` wiring).

## File map

| File                                                           | Role                                                                                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/app.ts`](./src/app.ts)                                   | Entry point. Builds the `App`, the five application stacks, and the standalone CI OIDC stack. The top-of-file `CONFIG` block holds the domain and region.     |
| [`src/system.ts`](./src/system.ts)                             | The composition root — the `compose(...)` call that wires every builder.                                                                                      |
| [`src/stacks/ci-oidc-stack.ts`](./src/stacks/ci-oidc-stack.ts) | Standalone OIDC provider + `GitHubActionsDeployRole` assumed by `.github/workflows/`.                                                                         |
| [`src/redirect-function.ts`](./src/redirect-function.ts)       | The CloudFront viewer-request function source: `www`→apex 301 + pretty-URL → `index.html` rewrite. Only the string between the backticks ships to the edge.   |
| [`src/zone-records.ts`](./src/zone-records.ts)                 | DNS records for the zone (currently empty — no mail yet). Apex and `www` ALIASes are added in `system.ts` because they depend on the CloudFront distribution. |
| [`scripts/`](./scripts/)                                       | Post-deploy operational scripts: the live-site smoke test.                                                                                                    |
| [`test/`](./test/)                                             | Vitest snapshot tests + functional assertions. Snapshots are committed and reviewed in PRs.                                                                   |

## Stack architecture

```
Cross-region edges (auto-wired by `crossRegionReferences: true`):

  DnsStack    (eu-west-2) ── DNS validation ──▶ CertStack       (us-east-1)
  CertStack   (us-east-1) ── certificate ARN ─▶ SiteStack       (eu-west-2)
  SiteStack   (eu-west-2) ── distribution id ─▶ CdnAlarmsStack  (us-east-1)

Same-region edges (us-east-1):

  UsEast1AlertsStack ── alarm actions ──▶ CertStack, CdnAlarmsStack

Standalone (no edges to the application stacks):

  CiOidcStack
```

The CDK app is a single top-level `compose()` routed across five application
stacks plus a standalone CI stack:

- **`UkeOOnoDnsStack`** (`eu-west-2`) — Route 53 hosted zone. No non-apex DNS
  records yet (mail/DKIM/verification go in `src/zone-records.ts` when
  configured). Route 53 is a global service; the region choice is cosmetic.
- **`UkeOOnoCertStack`** (`us-east-1`) — ACM certificate for apex + `www`,
  DNS-validated against the hosted zone. `us-east-1` is an AWS requirement for
  certificates attached to CloudFront.
- **`UkeOOnoSiteStack`** (`eu-west-2`) — S3 bucket, CloudFront distribution,
  CloudFront Function (`www`→apex 301 + pretty-URL rewrite), bucket deployment
  of the Eleventy output, apex/`www` alias records, Route 53 health check, and
  an SNS topic for site-region alarms.
- **`UkeOOnoUsEast1AlertsStack`** (`us-east-1`) — SNS topic shared by every
  us-east-1 alarm (cert, CloudFront, health check) plus the monthly Budget. No
  downstream deps so any us-east-1 stack can target it without creating a cycle.
- **`UkeOOnoCdnAlarmsStack`** (`us-east-1`) — CloudFront and Route 53
  health-check CloudWatch alarms. Both metric streams emit only in `us-east-1`,
  so the alarms must live there too. Kept separate from the cert stack to avoid
  a `cdn ↔ cert` cycle.
- **`UkeOOnoCiOidcStack`** (`eu-west-2`) — GitHub OIDC provider and the
  `GitHubActionsDeployRole`. Standalone; deployed once from a workstation.

Every stack opts in to `crossRegionReferences: true`, which lets CDK
auto-generate the SSM-parameter + custom-resource plumbing for cross-region
edges. Deployment order is inferred from the references, so no `addDependency`
calls are needed.

## CDK scripts

Run from the repo root (each `cdk:*` script runs the cdk build + site build
first via Nx's task graph):

- `npm run cdk:synth` — render CloudFormation for all stacks.
- `npm run cdk:diff` — preview changes for all stacks.
- `npm run cdk:deploy` — deploy **all** stacks. Default for simplicity; review
  the per-stack snapshot diffs under `test/__snapshots__/` first.
- `npm run cdk:deploy:stack -- <StackName>` — escape hatch for a single stack
  (e.g. `npm run cdk:deploy:stack -- UkeOOnoSiteStack`).

## Post-deploy / one-off scripts

```sh
npm run site:smoke              # post-deploy smoke (homepage, sitemap, sample, 404, www→apex)
```

CI runs the smoke test after every deploy. It's exposed as a root script for
ad-hoc runs.

Environment variables (the smoke test reads its own subset; missing values fall
back to sensible defaults):

| Variable            | Used by | Default                 | Purpose                                                                                       |
| ------------------- | ------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| `BASE_URL`          | smoke   | `https://uke-o-ono.com` | Origin under test.                                                                            |
| `EXPECTED_SHA`      | smoke   | _unset_                 | If set, smoke asserts `<meta name="build-sha">` matches; CI sets this to `${{ github.sha }}`. |
| `SMOKE_RETRIES`     | smoke   | `6`                     | Per-URL retry count for transient failures.                                                   |
| `SMOKE_RETRY_MS`    | smoke   | `5000`                  | Delay between retries in milliseconds.                                                        |
| `SMOKE_SAMPLE`      | smoke   | `10`                    | Number of randomly-sampled sitemap URLs to probe (`0` disables).                              |
| `SMOKE_CONCURRENCY` | smoke   | `5`                     | Parallel HTTP fetches for the sample.                                                         |

## Deploying

Pushes to `main` deploy automatically — see
[Continuous deployment](#continuous-deployment) below. The manual flow here is
the fallback for emergencies or first-time bootstrap.

The CDK app uses the standard `CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION`
environment variables, plus `ALERT_EMAIL` (the address subscribed to both
alarm topics — synth fails if it is unset). Authenticate with the target AWS
account first (e.g. `aws sso login --profile uke-o-ono.com`, then
`export AWS_PROFILE=uke-o-ono.com` for the rest of the shell), then:

```sh
export ALERT_EMAIL=alert@jasonduffett.org
npm run site:build   # build site content
npm run cdk:synth    # render CloudFormation
npm run cdk:diff     # preview changes
npm run cdk:deploy   # apply (all stacks)
```

After the first deploy, AWS sends one confirmation email per topic
(us-east-1 and eu-west-2). Click both confirm links — alerts only flow once
the subscriptions are in the `Confirmed` state.

### Reviewing infra changes

[`test/app.test.ts`](./test/app.test.ts) snapshots the synthesised
CloudFormation for every stack. Any change that affects the templates
(DNS records, alarm thresholds, distribution config) shows up in the snapshot
diff in the PR. If you intend the change, regenerate with
`npm run test:update`. If you don't, you have a regression.

### First-time setup

A new AWS account needs `cdk bootstrap` run once per region the app deploys
into. This app spans two regions, so bootstrap both:

```sh
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
npx cdk bootstrap aws://$ACCOUNT/eu-west-2   # DNS + Site stacks
npx cdk bootstrap aws://$ACCOUNT/us-east-1   # Cert + alarm stacks (CloudFront requirement)
```

For the very first deploy, deploy the DNS stack alone first so you can read
its nameservers before delegating:

```sh
npm run cdk:deploy:stack -- UkeOOnoDnsStack
```

Then proceed with [Domain delegation](#domain-delegation) below before
deploying the remaining stacks (the certificate's DNS validation succeeds
automatically once delegation lands).

## Continuous deployment

`main` auto-deploys via GitHub Actions:

- **`.github/workflows/pr.yml`** — runs on every PR: lint, format, build,
  test, plus `cdk diff` posted as a comment so infra changes are visible at
  review time.
- **`.github/workflows/deploy.yml`** — runs on push to `main`: full verify,
  fresh `site:build` (with `GITHUB_SHA` baked into a `<meta name="build-sha">`
  tag), `cdk deploy --all`, and the post-deploy smoke test. A failure on any
  step fails the workflow; GitHub emails the repo owner by default.

Both workflows authenticate to AWS via OpenID Connect — there are no
long-lived AWS keys in GitHub. The OIDC provider and the deploy role are
managed as a CDK stack (`UkeOOnoCiOidcStack`) so the trust policy lives in
source control. Third-party action versions are pinned to commit SHAs (with
`# vX.Y.Z` comments that Dependabot can read) so a tag rewrite upstream
cannot silently change what runs in CI.

### CI bootstrap (one-time)

After the standard `cdk bootstrap` in [First-time setup](#first-time-setup),
deploy the OIDC stack locally:

```sh
ALERT_EMAIL=alert@jasonduffett.org npm run cdk:deploy:stack -- UkeOOnoCiOidcStack
```

The stack outputs `GitHubActionsDeployRoleArn`. Configure GitHub:

- **Repository secrets** (Settings → Secrets and variables → Actions → Secrets):
  - `AWS_DEPLOY_ROLE_ARN` — the role ARN from the stack output.
  - `ALERT_EMAIL` — same address used for the alarm topics.
- **Branch protection on `main`** (Settings → Branches): require a pull
  request before merging and require the `verify` and `cdk diff` status
  checks to pass.

The deploy role's trust policy is restricted to two exact subject claims —
`repo:laazyj/ukeoono.com:ref:refs/heads/main` and
`repo:laazyj/ukeoono.com:pull_request` — so forks run workflows under their
own OIDC namespace and cannot assume the role. Making the repository public
does not expand who can deploy.

## Domain delegation

To delegate the zone to Route 53, point the domain's NS records at the
hosted-zone name servers:

1. Read the new name servers from the stack output:

   ```sh
   aws cloudformation describe-stacks \
     --stack-name UkeOOnoDnsStack \
     --query "Stacks[0].Outputs[?OutputKey=='NameServers'].OutputValue" \
     --output text
   ```

2. At the registrar, replace the existing NS records with the four AWS NS
   hostnames from step 1 (no trailing dot).

3. Wait for propagation (typically minutes; up to a couple of hours). Verify with:

   ```sh
   dig +trace @1.1.1.1 uke-o-ono.com NS    # bottom should show the AWS nameservers
   ```

4. Smoke-test the live site once delegation has propagated:

   ```sh
   curl -I https://uke-o-ono.com/
   curl -I https://www.uke-o-ono.com/             # 301 → apex
   ```

## Tests

```sh
npx nx run @uke-o-ono/cdk:test
```

[`test/app.test.ts`](./test/app.test.ts) synthesises every stack, snapshots
the CloudFormation, and adds functional assertions for invariants that must
hold regardless of refactors (certificate SANs, budget limit, alarm coverage,
OIDC trust policy).

After intentional infra changes, regenerate snapshots with
`npx nx run @uke-o-ono/cdk:test -- -u`.

## Linting and formatting

Inherits the root ESLint and Prettier configs. Run `npm run lint` /
`npm run format:check` from the repo root.

## See also

- [Top-level README](../../README.md) — repo overview.
- [`@uke-o-ono/site`](../site/README.md) — the Eleventy site this CDK app
  hosts.
- [composureCDK](https://github.com/laazyj/composureCDK) — the framework used
  here.
