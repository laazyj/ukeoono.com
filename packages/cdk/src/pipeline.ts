import type { Stack } from "aws-cdk-lib";

import { at, compose, ref } from "@composurecdk/core";
import { outputs } from "@composurecdk/cloudformation";
import {
  createRoleBuilder,
  createStatementBuilder,
  githubActions,
  type OpenIdConnectProviderBuilderResult,
  type RoleBuilderResult,
} from "@composurecdk/iam";

export interface PipelineStacks {
  /** GitHub OIDC provider and the deploy role CI assumes. */
  readonly ciStack: Stack;
}

export interface PipelineOptions {
  readonly githubOwner: string;
  readonly githubRepo: string;
  readonly cdkBootstrapQualifier?: string;
}

const DEFAULT_CDK_QUALIFIER = "hnb659fds";

/**
 * The CI half of the app: how GitHub Actions gets into the account. A sibling
 * of `createSystem()`, with no edges to it.
 *
 * Both components pin their construct id with `at()`. `compose()` would
 * otherwise build them at `<appId>/<key>`, which rotates their logical ids, and
 * neither resource survives replacement: AWS allows one GitHub OIDC provider
 * per account, and the role has a fixed name and is the one CI deploys as.
 */
export function createPipeline(stacks: PipelineStacks, options: PipelineOptions) {
  const { ciStack } = stacks;
  const { githubOwner: owner, githubRepo: repo } = options;
  const qualifier = options.cdkBootstrapQualifier ?? DEFAULT_CDK_QUALIFIER;

  return compose(
    {
      // Library gap (@composurecdk/iam 0.14): githubActions.provider() wraps
      // CDK's custom-resource OpenIdConnectProvider, whose provider Lambda
      // writes to a log group with no retention. Moving to the native
      // AWS::IAM::OIDCProvider needs a staged migration (#127); remove this
      // note when that lands.
      oidcProvider: at("GithubOidcProvider", githubActions.provider()),

      // The role's only direct permission is to assume CDK's bootstrap roles in
      // any region of this account. Those roles are the actual permission
      // boundary for deploys; this matches CDK's intended OIDC pattern and keeps
      // the long-lived role's blast radius limited to "do CDK things".
      deployRole: at(
        "GitHubActionsDeployRole",
        createRoleBuilder()
          .roleName("GitHubActionsDeployRole")
          // Subject-claim allowlist scopes role assumption to this exact repo.
          // Forks run workflows under their own `repo:<fork>/<name>:*`
          // namespace, so they cannot mint a token that satisfies these
          // conditions even though the OIDC provider is account-wide.
          .assumedBy(
            ref<OpenIdConnectProviderBuilderResult>("oidcProvider")
              .get("provider")
              .map((provider) =>
                githubActions.principal({
                  owner,
                  repo,
                  provider,
                  subjects: [
                    githubActions.Subject.branch("main"),
                    githubActions.Subject.pullRequest(),
                  ],
                }),
              ),
          )
          .description(`GitHub Actions deploy role for ${owner}/${repo}.`)
          .addInlinePolicyStatements("AssumeCdkBootstrapRoles", [
            createStatementBuilder()
              .allow()
              .actions(["sts:AssumeRole"])
              .resources([
                `arn:aws:iam::*:role/cdk-${qualifier}-deploy-role-*`,
                `arn:aws:iam::*:role/cdk-${qualifier}-file-publishing-role-*`,
                `arn:aws:iam::*:role/cdk-${qualifier}-image-publishing-role-*`,
                `arn:aws:iam::*:role/cdk-${qualifier}-lookup-role-*`,
              ]),
          ]),
      ),
    },
    { oidcProvider: [], deployRole: ["oidcProvider"] },
  )
    .withStacks({ oidcProvider: ciStack, deployRole: ciStack })
    .afterBuild(
      outputs({
        GitHubActionsDeployRoleArn: {
          value: ref<RoleBuilderResult>("deployRole")
            .get("role")
            .map((r) => r.roleArn),
          description: "Set as the GitHub Actions secret `AWS_DEPLOY_ROLE_ARN`.",
          scope: "deployRole",
        },
      }),
    );
}
