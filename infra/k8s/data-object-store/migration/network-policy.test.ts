import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

import { parseAllDocuments } from "yaml";

interface NetworkPolicy {
  kind: "NetworkPolicy";
  metadata: { name: string };
  spec: {
    ingress?: Array<{
      from?: Array<{
        namespaceSelector?: Record<string, unknown>;
        podSelector?: Record<string, unknown>;
      }>;
      ports?: Array<{ port?: number; protocol?: string }>;
    }>;
    podSelector?: {
      matchLabels?: Record<string, string>;
    };
  };
}

function renderPolicies(root: "base" | "cutover"): NetworkPolicy[] {
  const rendered = execFileSync("kustomize", ["build", resolve(import.meta.dirname, root)], {
    encoding: "utf8",
  });
  return parseAllDocuments(rendered)
    .map((document) => document.toJS() as NetworkPolicy)
    .filter((resource) => resource.kind === "NetworkPolicy");
}

function selectsRustfs(policy: NetworkPolicy): boolean {
  const labels = policy.spec.podSelector?.matchLabels;
  return (
    labels?.["app.kubernetes.io/name"] === "object-store" &&
    labels["app.kubernetes.io/instance"] === "rustfs"
  );
}

function allowsSameNamespaceS3(policy: NetworkPolicy): boolean {
  return (
    policy.spec.ingress?.some(
      (rule) =>
        rule.from?.some(
          (peer) =>
            peer.namespaceSelector === undefined &&
            peer.podSelector !== undefined &&
            Object.keys(peer.podSelector).length === 0,
        ) === true &&
        rule.ports?.some((port) => port.protocol === "TCP" && port.port === 9000) === true,
    ) === true
  );
}

test("keeps replication ingress strict until cutover", () => {
  const policies = renderPolicies("base").filter(selectsRustfs);
  assert.ok(policies.length > 0);
  assert.equal(policies.some(allowsSameNamespaceS3), false);
});

test("allows same-namespace object-store consumers during cutover", () => {
  const policies = renderPolicies("cutover").filter(selectsRustfs);
  assert.ok(policies.length > 0);
  assert.equal(policies.some(allowsSameNamespaceS3), true);
});
