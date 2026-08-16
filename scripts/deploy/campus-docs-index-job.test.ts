import assert from "node:assert/strict";
import test from "node:test";

import { parseStageInput, stageTemplate } from "./campus-docs-index-job.ts";

const chunkSet = `sha256:${"a".repeat(64)}`;
const embeddingSet = `sha256:${"b".repeat(64)}`;

test("builds one explicit embedding Job command", () => {
	const input = parseStageInput([
		"--stage",
		"embeddings",
		"--chunk-set",
		chunkSet,
		"--reuse-embedding-set",
		embeddingSet,
	]);
	assert.deepEqual(stageTemplate(input), {
		args: ["build-embeddings", "--chunk-set", chunkSet, "--reuse-embedding-set", embeddingSet],
		cronJob: "campus-docs-embedding-builder",
		jobPrefix: "campus-docs-embeddings",
	});
});

test("requires explicit artifact references for publish", () => {
	assert.throws(() => parseStageInput(["--stage", "publish", "--chunk-set", chunkSet]), /Usage:/u);
	assert.deepEqual(
		stageTemplate(
			parseStageInput([
				"--stage",
				"publish",
				"--chunk-set",
				chunkSet,
				"--embedding-set",
				embeddingSet,
			]),
		),
		{
			args: ["publish-index", "--chunk-set", chunkSet, "--embedding-set", embeddingSet],
			cronJob: "campus-docs-index-publisher",
			jobPrefix: "campus-docs-publish",
		},
	);
});
