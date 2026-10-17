import { describe, expect, it } from "vitest";

import { parseCommand } from "../src/cli.ts";
import { parseLocalArtifactImportCommand } from "../src/import-local-cli.ts";
import { parseLocalPublishCommand } from "../src/local-cli.ts";

const docsEmbeddingSet = `sha256:${"a".repeat(64)}`;
const noticeEmbeddingSet = `sha256:${"b".repeat(64)}`;

describe("campus RAG publisher CLI", () => {
	it("requires both immutable embedding set inputs", () => {
		expect(
			parseCommand(["apply"], {
				CAMPUS_DOCS_EMBEDDING_SET: docsEmbeddingSet,
				CAMPUS_NOTICE_EMBEDDING_SET: noticeEmbeddingSet,
			}),
		).toEqual({
			docs: docsEmbeddingSet,
			kind: "apply",
			notices: noticeEmbeddingSet,
		});
	});

	it("rejects a missing Notice embedding set", () => {
		expect(() =>
			parseCommand(["apply"], {
				CAMPUS_DOCS_EMBEDDING_SET: docsEmbeddingSet,
			}),
		).toThrow("CAMPUS_NOTICE_EMBEDDING_SET must be");
	});

	it("parses the local S3 publication inputs", () => {
		expect(
			parseLocalPublishCommand(
				["--docs-embedding-set", docsEmbeddingSet, "--notice-embedding-set", noticeEmbeddingSet],
				"/repo",
			),
		).toEqual({
			docsEmbeddingSet,
			noticeEmbeddingSet,
		});
	});

	it("rejects incomplete local publication inputs", () => {
		expect(() => parseLocalPublishCommand(["--docs-embedding-set", docsEmbeddingSet])).toThrow(
			"Usage: publish-index-local",
		);
	});

	it("parses the kubectl local artifact import inputs", () => {
		expect(
			parseLocalArtifactImportCommand([
				"--namespace",
				"campus-agent-staging",
				"--context",
				"staging",
				"--docs-embedding-set",
				docsEmbeddingSet,
				"--notice-embedding-set",
				noticeEmbeddingSet,
			]),
		).toEqual({
			context: "staging",
			docsEmbeddingSet,
			namespace: "campus-agent-staging",
			noticeEmbeddingSet,
		});
	});
});
