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
		"notice-pipeline-worker",
		"document-ocr",
		"execution-control",
		"model-config",
		"notice-artifacts-worker",
		"ops-web",
	]);
});

test("selects Dockerfiles independently of broad Turbo build tasks", () => {
	assert.deepEqual(
		targets(
			["apps/ops-web/Dockerfile"],
			[
				{ package: "agent-runtime", task: "build" },
				{ package: "unknown", task: "build" },
			],
		),
		["ops-web"],
	);
});

test("maps shared Node build inputs to all active Node images", () => {
	assert.deepEqual(targets([".node-version"]), [
		"agent-runtime",
		"campus-agent-schema",
		"campus-docs-index-publisher",
		"campus-rag-index-publisher",
		"notice-pipeline-worker",
		"document-ocr",
		"notice-artifacts-worker",
		"ops-web",
	]);
	assert.deepEqual(targets(["package.json"]), [
		"agent-runtime",
		"campus-agent-schema",
		"campus-docs-index-publisher",
		"campus-rag-index-publisher",
		"notice-pipeline-worker",
		"document-ocr",
		"notice-artifacts-worker",
		"ops-web",
	]);
	assert.deepEqual(targets(["turbo.json"]), []);
});

test("maps shared Docker context changes to every active image", () => {
	assert.deepEqual(targets([".dockerignore"]), [...ACTIVE_IMAGE_TARGETS]);
	assert.deepEqual(targets(["docker-bake.hcl"]), [...ACTIVE_IMAGE_TARGETS]);
});

test("test-only source and configuration changes do not select images", () => {
	assert.deepEqual(
		targets(
			[
				"apps/ops-web/test/setup.ts",
				"apps/ops-web/src/app.spec.tsx",
				"apps/ops-web/vitest.config.mts",
				"apps/ops-web/README.md",
				"apps/ops-web/turbo.json",
				"apps/model-config/internal/server/server_test.go",
				"scripts/release/images.test.ts",
				"docs/reference/verification.md",
			],
			[{ package: "ops-web", task: "build" }],
		),
		[],
	);
	assert.deepEqual(targets(["apps/app-api/src/app.ts"]), []);
	assert.deepEqual(targets(["packages/ui/src/button.tsx"]), ["ops-web"]);
	assert(targets(["packages/ingestion-contracts/src/index.ts"]).includes("ops-web"));
});

test("maps non-Turbo notice and execution inputs to their consumers", () => {
	assert.deepEqual(targets(["packages/notice-database/src/index.ts"]), [
		"notice-pipeline-worker",
		"document-ocr",
		"notice-artifacts-worker",
	]);
	assert.deepEqual(targets(["configs/runtime/tools.v7.json"]), [
		"agent-runtime",
		"execution-control",
	]);
});

test("maps notice index and embedding runtime changes to their artifact images", () => {
	assert.deepEqual(targets(["jobs/notice-index-publisher/src/cli.ts"]), [
		"notice-artifacts-worker",
	]);
	assert.deepEqual(targets(["packages/embedding-runtime/src/index.ts"]), [
		"campus-docs-index-publisher",
		"campus-rag-index-publisher",
		"notice-artifacts-worker",
	]);
});

test("transport domain changes do not select a retired publisher image", () => {
	assert.deepEqual(targets(["packages/domains/transport/src/domain/schedule.ts"]), ["ops-web"]);
});

test("maps the docs publisher's shared contract sources to its image", () => {
	assert.deepEqual(targets(["packages/contracts/src/campus-docs/node/index.ts"]), [
		"agent-runtime",
		"campus-docs-index-publisher",
		"campus-rag-index-publisher",
		"notice-pipeline-worker",
		"document-ocr",
		"notice-artifacts-worker",
		"ops-web",
	]);
	assert.deepEqual(targets(["packages/contracts/schemas/campus-docs-course-maps.v1.schema.json"]), [
		"agent-runtime",
		"campus-docs-index-publisher",
		"campus-rag-index-publisher",
		"notice-pipeline-worker",
		"document-ocr",
		"notice-artifacts-worker",
		"ops-web",
	]);
});

test("recognizes container definition changes independently of image selection", () => {
	assert.equal(containerBuildInputsChanged([".node-version"]), true);
	assert.equal(containerBuildInputsChanged(["scripts/release/images.mts"]), true);
	assert.equal(containerBuildInputsChanged(["apps/agent-runtime/Dockerfile"]), true);
	assert.equal(containerBuildInputsChanged(["docs/runbooks/release.md"]), false);
});

test("maps OCR bundled inputs to its image", () => {
	for (const file of [
		"packages/document-ocr/src/runner.ts",
		"packages/notice-database/src/index.ts",
		"packages/domains/notices/src/index.ts",
		"packages/contracts/package.json",
		"packages/contracts/src/notices.ts",
		"configs/sources/internal-portal.json",
	]) {
		assert.ok(targets([file]).includes("document-ocr"), file);
	}
});
