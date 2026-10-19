import assert from "node:assert/strict";
import test from "node:test";
import { type CandidatePlan, SOURCE_BASE_PATHS } from "./candidates.mts";
import { ACTIVE_IMAGE_TARGETS } from "./image-targets.mts";
import { completeCandidate, parseSourceCandidate } from "./source-candidate.mts";
import { WORKER_CANDIDATES } from "./workers.mts";

const sha = "a".repeat(40);
const next = "b".repeat(40);
const digest = `sha256:${"1".repeat(64)}`;
const initial: CandidatePlan = {
	base: sha,
	head: sha,
	images: [...ACTIVE_IMAGE_TARGETS],
	workers: [...WORKER_CANDIDATES],
	sourceBases: [...SOURCE_BASE_PATHS],
	topologyMigrations: [],
};
test("a complete publication can skip intermediate deployment candidates without losing unchanged digests", () => {
	const before = completeCandidate(
		initial,
		undefined,
		Object.fromEntries(ACTIVE_IMAGE_TARGETS.map((name) => [name, digest])),
		[],
	);
	const after = completeCandidate(
		{ ...initial, base: sha, head: next, images: ["model-config"], workers: [], sourceBases: [] },
		before,
		{ "model-config": `sha256:${"2".repeat(64)}` },
		[],
	);
	assert.equal(after.sourceSha, next);
	assert.equal(after.images["model-config"]?.sourceSha, next);
	assert.deepEqual(after.images["agent-runtime"], before.images["agent-runtime"]);
	assert.deepEqual(after.baseRevisions, before.baseRevisions);
	assert.deepEqual(after.workers, before.workers);
	assert.equal(Object.keys(after.images).length, ACTIVE_IMAGE_TARGETS.length);
});
test("a baseline published before an image was added or retired still plans the next candidate", () => {
	const complete = completeCandidate(
		initial,
		undefined,
		Object.fromEntries(ACTIVE_IMAGE_TARGETS.map((name) => [name, digest])),
		[],
	);
	const { "retrieval-index": added, ...older } = complete.images;
	assert(added);
	const baseline = parseSourceCandidate(
		{ ...complete, images: { ...older, "retired-image": older["model-config"] } },
		{ publishedSnapshot: true },
	);
	assert.throws(
		() => parseSourceCandidate(baseline),
		/Missing complete candidate image retrieval-index/,
	);
	const after = completeCandidate(
		{ ...initial, head: next, images: ["retrieval-index"], workers: [], sourceBases: [] },
		baseline,
		{ "retrieval-index": `sha256:${"2".repeat(64)}` },
		[],
	);
	assert.deepEqual(Object.keys(after.images).sort(), [...ACTIVE_IMAGE_TARGETS].sort());
	assert.equal(after.images["retrieval-index"]?.sourceSha, next);
	assert.throws(
		() => completeCandidate({ ...initial, head: next, images: [] }, baseline, {}, []),
		/No baseline for retrieval-index/,
	);
});

test("a baseline published before a Worker was registered still plans the next candidate", () => {
	const complete = completeCandidate(
		initial,
		undefined,
		Object.fromEntries(ACTIVE_IMAGE_TARGETS.map((name) => [name, digest])),
		[],
	);
	const { "edge-router-staging": added, ...older } = complete.workers;
	assert(added);
	const baseline = parseSourceCandidate(
		{ ...complete, workers: older },
		{ publishedSnapshot: true },
	);
	assert.throws(
		() => parseSourceCandidate(baseline),
		/Missing candidate Worker edge-router-staging/,
	);
	const after = completeCandidate(
		{ ...initial, head: next, images: [], workers: [], sourceBases: [] },
		baseline,
		{},
		[],
	);
	assert.deepEqual(Object.keys(after.workers).sort(), [...WORKER_CANDIDATES].sort());
	assert.equal(after.workers["edge-router-staging"].sourceSha, next);
	assert.deepEqual(after.workers["app-api-staging"], baseline.workers["app-api-staging"]);
});
test("first publication requires every active image", () => {
	assert.throws(() => completeCandidate(initial, undefined, {}, []), /Missing published image/);
	assert.throws(
		() => parseSourceCandidate({ schemaVersion: 2, sourceSha: sha, images: {} }),
		/Missing complete candidate image/,
	);
});

test("candidate includes declared maintenance requirements and accepts legacy candidate snapshots", () => {
	const candidate = completeCandidate(
		initial,
		undefined,
		Object.fromEntries(ACTIVE_IMAGE_TARGETS.map((name) => [name, digest])),
		[],
	);
	assert.deepEqual(candidate.maintenanceRequirements, []);
	const withRequirement = completeCandidate(
		{ ...initial, maintenanceRequirements: ["agent-control-schema-rename"] },
		undefined,
		Object.fromEntries(ACTIVE_IMAGE_TARGETS.map((name) => [name, digest])),
		[],
	);
	assert.deepEqual(withRequirement.maintenanceRequirements, ["agent-control-schema-rename"]);
	const { maintenanceRequirements: _ignored, ...legacy } = withRequirement;
	assert.deepEqual(parseSourceCandidate(legacy).maintenanceRequirements, []);
	assert.throws(
		() => parseSourceCandidate({ ...withRequirement, maintenanceRequirements: ["../invalid"] }),
		/maintenance requirements/,
	);
});
