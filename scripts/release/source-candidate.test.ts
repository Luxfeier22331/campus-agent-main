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
test("first publication requires every active image", () => {
	assert.throws(() => completeCandidate(initial, undefined, {}, []), /Missing published image/);
	assert.throws(
		() => parseSourceCandidate({ schemaVersion: 2, sourceSha: sha, images: {} }),
		/Missing complete candidate image/,
	);
});
