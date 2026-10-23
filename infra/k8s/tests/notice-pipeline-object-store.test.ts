import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseAllDocuments } from "yaml";

import { createSourceObjectStoreConnection } from "../../../jobs/internal-portal-collection/src/source-object-store.ts";

test("notice pipeline Worker supplies the source object-store configuration required by collection", () => {
	const manifests = parseAllDocuments(
		readFileSync(
			new URL("../notice-pipeline/base/notice-pipeline-worker.yaml", import.meta.url),
			"utf8",
		),
	).map((document) => document.toJS());
	const deployment = manifests.find((manifest) => manifest.kind === "Deployment");
	const container = deployment.spec.template.spec.containers.find(
		(value: { name: string }) => value.name === "worker",
	);
	const env: NodeJS.ProcessEnv = {};
	for (const entry of container.env) {
		if (entry.name.startsWith("OBJECT_STORE_")) {
			// Exercise the collector configuration without cluster secrets or network requests.
			env[entry.name] = entry.value ?? (entry.valueFrom?.secretKeyRef ? "test-secret" : undefined);
		}
	}
	const { bucket, client } = createSourceObjectStoreConnection(env);
	try {
		assert.equal(bucket, "campus-agent-source");
	} finally {
		client.destroy();
	}
});
