import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseAllDocuments } from "yaml";

import { createOcrObjects } from "../../packages/document-ocr/src/objects.ts";

test("Ops deployment supplies the object-store configuration required by OCR", () => {
	const manifests = parseAllDocuments(
		readFileSync(new URL("../../infra/k8s/ops-web/base/workload.yaml", import.meta.url), "utf8"),
	).map((document) => document.toJS());
	const deployment = manifests.find((manifest) => manifest.kind === "Deployment");
	const container = deployment.spec.template.spec.containers.find(
		(value: { name: string }) => value.name === "ops-web",
	);
	const env: NodeJS.ProcessEnv = {};
	for (const entry of container.env) {
		if (entry.name.startsWith("OBJECT_STORE_")) {
			// Exercise the real client configuration without reading cluster secrets or sending requests.
			env[entry.name] = entry.value ?? (entry.valueFrom?.secretKeyRef ? "test-secret" : undefined);
		}
	}
	assert.equal(env.OBJECT_STORE_BUCKET_SOURCE, "campus-agent-source");
	assert.equal(env.OBJECT_STORE_BUCKET_DERIVED, "campus-agent-derived");
	const objects = createOcrObjects(env);
	objects.close();
});
