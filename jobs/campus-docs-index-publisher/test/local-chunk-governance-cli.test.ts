import { describe, expect, it } from "vitest";

import { parseCommand as parseReviewCommand } from "../src/local-chunk-governance-cli.ts";
import { parseCommand as parseLabelCommand } from "../src/local-chunk-review-labels-cli.ts";
import type { Sha256Ref } from "../src/types.ts";

const CHUNK_SET = `sha256:${"a".repeat(64)}` as Sha256Ref;
const EMBEDDING_EVALUATION = `sha256:${"b".repeat(64)}` as Sha256Ref;
const REVIEW_RUN = `sha256:${"c".repeat(64)}` as Sha256Ref;

describe("Campus docs chunk governance CLIs", () => {
	it("parses a review command with embedding evidence", () => {
		expect(parseReviewCommand([
			"--",
			"--chunk-set",
			CHUNK_SET,
			"--embedding-evaluation",
			EMBEDDING_EVALUATION,
		])).toEqual({
			chunkSet: CHUNK_SET,
			embeddingEvaluation: EMBEDDING_EVALUATION,
		});
	});

	it("parses a review-label summary command", () => {
		expect(parseLabelCommand([
			"--review-run",
			REVIEW_RUN,
			"--labels",
			"var/campus-docs/chunk-governance/labels/review.ndjson",
		])).toEqual({
			labels: "var/campus-docs/chunk-governance/labels/review.ndjson",
			reviewRun: REVIEW_RUN,
		});
	});

	it("rejects incomplete commands", () => {
		expect(() => parseReviewCommand(["--chunk-set", CHUNK_SET, "--embedding-evaluation"]))
			.toThrow("Usage: review-chunks-local");
		expect(() => parseLabelCommand(["--review-run", REVIEW_RUN]))
			.toThrow("Usage: summarize-chunk-review-labels-local");
	});
});
