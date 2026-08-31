import { describe, expect, it } from "vitest";

import {
	decodeCampusDocsReviewLabels,
	summarizeCampusDocsReviewLabels,
} from "../src/chunk-review-labels.ts";
import type {
	CampusDocsReviewCandidate,
	CampusDocsReviewItem,
	CampusDocsReviewItemStratum,
} from "../src/chunk-governance-types.ts";

describe("Campus docs review labels", () => {
	it("validates labels and summarizes verdicts by stratum and signal", () => {
		const items = [
			item("chunk-1", "control"),
			item("chunk-2", "metadata-or-near-max", candidate("chunk-2")),
		];
		const labels = decodeCampusDocsReviewLabels(bytes([
			{ chunkId: "chunk-1", verdict: "keep" },
			{ action: "drop", chunkId: "chunk-2", reason: "source URL only", verdict: "change" },
		]));

		const summary = summarizeCampusDocsReviewLabels(items, labels);

		expect(summary.itemCount).toBe(2);
		expect(summary.labeledCount).toBe(2);
		expect(summary.unlabeledCount).toBe(0);
		expect(summary.verdicts).toEqual({ change: 1, keep: 1 });
		expect(summary.actions.drop).toBe(1);
		expect(summary.byPrimaryStratum.control?.changeRate).toBe(0);
		expect(summary.byPrimaryStratum["metadata-or-near-max"]?.changeRate).toBe(1);
		expect(summary.bySignal["source-url-only"]?.changeRate).toBe(1);
	});

	it("rejects a change verdict without an action", () => {
		expect(() => decodeCampusDocsReviewLabels(bytes([
			{ chunkId: "chunk-1", verdict: "change" },
		]))).toThrow("requires a valid action");
	});

	it("rejects an action on a keep verdict", () => {
		expect(() => decodeCampusDocsReviewLabels(bytes([
			{ action: "merge", chunkId: "chunk-1", verdict: "keep" },
		]))).toThrow("must omit action");
	});

	it("rejects duplicate and unknown chunk labels", () => {
		expect(() => decodeCampusDocsReviewLabels(bytes([
			{ chunkId: "chunk-1", verdict: "keep" },
			{ chunkId: "chunk-1", verdict: "keep" },
		]))).toThrow("duplicate chunkId");
		expect(() => summarizeCampusDocsReviewLabels(
			[item("chunk-1", "control")],
			[{ chunkId: "chunk-2", verdict: "keep" }],
		)).toThrow("unknown chunk");
	});
});

function item(
	chunkId: string,
	primaryStratum: CampusDocsReviewItemStratum,
	signal?: CampusDocsReviewCandidate,
): CampusDocsReviewItem {
	return {
		boundaries: {},
		chunk: {
			chars: 20,
			chunkId,
			chunkIndex: 0,
			content: chunkId,
			headingPath: [],
			rootUnitIds: [chunkId],
			rootUnits: [{
				chars: 20,
				kind: "paragraph",
				rootUnitId: chunkId,
				textPreview: chunkId,
			}],
			sectionId: "section-1",
			sectionTitle: "Section",
		},
		collection: "fixture",
		corpus: "fixture",
		documentId: `document-${chunkId}`,
		documentTags: [],
		documentTitle: "Fixture",
		embeddingAnchors: [],
		primaryStratum,
		signals: signal ? [signal] : [],
	};
}

function candidate(chunkId: string): CampusDocsReviewCandidate {
	return {
		chunkIndex: 0,
		detail: "source URL only",
		documentId: `document-${chunkId}`,
		sectionId: "section-1",
		signal: "source-url-only",
		title: "Fixture",
	};
}

function bytes(records: readonly unknown[]): Uint8Array {
	return new TextEncoder().encode(records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}
