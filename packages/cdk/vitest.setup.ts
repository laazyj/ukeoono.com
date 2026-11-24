import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";

// Synthesise under the same feature flags the cdk CLI uses: it hands
// cdk.json's context to the app through CDK_CONTEXT_JSON, which every `App`
// reads, so tests do the same from the same file.
process.env.CDK_CONTEXT_JSON = JSON.stringify(
  (
    JSON.parse(readFileSync(resolve(import.meta.dirname, "cdk.json"), "utf8")) as {
      context: Record<string, unknown>;
    }
  ).context,
);

// CDK addresses its bundled assets by content hash, and every such hash is a
// 64-char hex SHA-256. Three kinds show up in our synthesised templates:
//
//   - `S3Key`    — the framework's custom-resource provider Lambdas, the
//                  BucketDeployment handler, and the awscli layer.
//   - `CodeHash` — the same provider Lambdas, recorded on the custom resource.
//   - `SourceObjectKeys` — the site bucket-deployment source (the deployed
//                  site content).
//
// The provider/layer hashes churn on every aws-cdk-lib release with no change
// to our infrastructure, and the deployment-source hash only echoes site
// content changes that are already visible in the PR diff. None of them carry
// infrastructure signal, so we collapse every asset hash to a stable
// placeholder. These are the only 64-hex strings the templates contain, so a
// value-based serializer normalises all three without needing to inspect keys.
const ASSET_HASH = /^[0-9a-f]{64}(\.zip)?$/;

expect.addSnapshotSerializer({
  test: (value: unknown): boolean => typeof value === "string" && ASSET_HASH.test(value),
  serialize: (value: string) => (value.endsWith(".zip") ? '"<asset-hash>.zip"' : '"<asset-hash>"'),
});
