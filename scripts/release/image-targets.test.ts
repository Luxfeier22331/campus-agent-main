import assert from "node:assert/strict";
import test from "node:test";

import {
	ACTIVE_IMAGE_TARGETS,
	containerBuildInputsChanged,
	imageTargetsForScope,
} from "./image-targets.mts";

function targets(changedFiles: string[], tasks: Array<{ package: string; task: string }> = []) {
	return imageTargetsForScope({ changedFiles, tasks });
}

test("active image target registry excludes the historical schema image", () => {
	assert.deepEqual(ACTIVE_IMAGE_TARGETS, [
		"agent-runtime",
		"campus-agent-schema",
		"campus-docs-index-publisher",
		"campus-rag-index-publisher",
		"execution-control",
		"internal-portal-collection",
		"model-config",
		"notice-classifier",
		"notice-index-publisher",
		"notice-publisher",
		"ops-web",
	]);
});

test("maps package build tasks and Dockerfiles to the same image target", () => {
	assert.deepEqual(
		targets(
			["apps/ops-web/Dockerfile"],
			[
				{ package: "agent-runtime", task: "build" },
				{ package: "unknown", task: "build" },
			],
		),
		["agent-runtime", "ops-web"],
	);
});

test("maps shared Node build inputs to all active Node images", () => {
	assert.deepEqual(targets([".node-version"]), [
		"agent-runtime",
		"campus-agent-schema",
		"campus-docs-index-publisher",
		"campus-rag-index-publisher",
		"internal-portal-collection",
		"notice-classifier",
		"notice-index-publisher",
		"notice-publisher",
		"ops-web",
	]);
	assert.deepEqual(targets(["package.json"]), [
		"agent-runtime",
		"campus-agent-schema",
		"campus-docs-index-publisher",
		"campus-rag-index-publisher",
		"internal-portal-collection",
		"notice-classifier",
		"notice-index-publisher",
		"notice-publisher",
		"ops-web",
	]);
	assert.deepEqual(targets(["turbo.json"]), [
		"agent-runtime",
		"campus-agent-schema",
		"campus-docs-index-publisher",
		"campus-rag-index-publisher",
		"internal-portal-collection",
		"notice-classifier",
		"notice-index-publisher",
		"notice-publisher",
		"ops-web",
	]);
});

test("maps shared Docker context changes to every active image", () => {
	assert.deepEqual(targets([".dockerignore"]), [...ACTIVE_IMAGE_TARGETS]);
	assert.deepEqual(targets(["docker-bake.hcl"]), [...ACTIVE_IMAGE_TARGETS]);
});

test("maps non-Turbo notice and execution inputs to their consumers", () => {
	assert.deepEqual(targets(["packages/notice-database/src/index.ts"]), [
		"internal-portal-collection",
		"notice-classifier",
		"notice-index-publisher",
		"notice-publisher",
	]);
	assert.deepEqual(targets(["configs/runtime/tools.v7.json"]), ["execution-control"]);
});

test("maps notice index and embedding runtime changes to their artifact images", () => {
	assert.deepEqual(targets(["jobs/notice-index-publisher/src/cli.ts"]), [
		"campus-rag-index-publisher",
		"notice-index-publisher",
	]);
	assert.deepEqual(targets(["packages/embedding-runtime/src/index.ts"]), [
		"campus-rag-index-publisher",
		"notice-index-publisher",
	]);
});

test("maps the docs publisher's shared contract sources to its image", () => {
	assert.deepEqual(targets(["packages/contracts/src/campus-docs/node/index.ts"]), [
		"campus-docs-index-publisher",
		"campus-rag-index-publisher",
	]);
	assert.deepEqual(targets(["packages/contracts/schemas/campus-docs-course-maps.v1.schema.json"]), [
		"campus-docs-index-publisher",
	]);
});

test("recognizes container definition changes independently of image selection", () => {
	assert.equal(containerBuildInputsChanged([".node-version"]), true);
	assert.equal(containerBuildInputsChanged(["scripts/release/images.mts"]), true);
	assert.equal(containerBuildInputsChanged(["apps/agent-runtime/Dockerfile"]), true);
	assert.equal(containerBuildInputsChanged(["docs/runbooks/release.md"]), false);
});
