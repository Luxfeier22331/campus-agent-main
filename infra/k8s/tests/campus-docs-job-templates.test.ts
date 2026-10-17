import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseAllDocuments } from "yaml";

const jobs = parseAllDocuments(
	readFileSync(new URL("../campus-search/base/retrieval-jobs.yaml", import.meta.url), "utf8"),
).map((d) => d.toJS());
test("retrieval jobs are explicit, single-run workloads with lifecycle-specific credentials", () => {
	assert.deepEqual(
		jobs.map((j) => j.metadata.name),
		["retrieval-build", "retrieval-apply", "retrieval-cleanup"],
	);
	for (const j of jobs) {
		assert.equal(j.spec.suspend, true);
		assert.equal(j.spec.jobTemplate.spec.backoffLimit, 0);
		const pod = j.spec.jobTemplate.spec.template.spec;
		assert.equal(pod.restartPolicy, "Never");
		assert.equal(pod.automountServiceAccountToken, false);
		const env = pod.containers[0].env.map((e: { name: string }) => e.name);
		assert(!env.includes("TEMPORAL_ADDRESS"));
		assert.equal(env.includes("QDRANT_API_KEY"), j.metadata.name === "retrieval-apply");
		assert.equal(env.includes("MODEL_CONFIG_URL"), j.metadata.name === "retrieval-build");
		// Each run creates and removes its own workspace; nothing persists between Jobs.
		assert(
			pod.volumes.some(
				(v: { name: string; emptyDir?: { sizeLimit?: string } }) =>
					v.name === "work" && v.emptyDir?.sizeLimit === "20Gi",
			),
		);
	}
});
