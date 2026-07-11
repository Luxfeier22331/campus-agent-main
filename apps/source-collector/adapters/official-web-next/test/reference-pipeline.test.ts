import { describe, expect, it } from "vitest";
import {
	buildOfficialWebNextReferencePipeline,
	type OfficialWebNextContentBlock,
	type OfficialWebNextSourceTruthBundle,
} from "../src/index.ts";

describe("official-web-next reference pipeline", () => {
	it("materializes document units, chunks, and an unpublished release manifest from source truth", () => {
		const bundle: OfficialWebNextSourceTruthBundle = {
			schemaVersion: "official_web_next_source_truth_bundle.v1",
			sourceChannel: "official_web",
			siteId: "muc_public",
			crawlRunId: "ow-next-run-001",
			generatedAt: "2026-07-08T00:00:00.000Z",
			pages: [
				{
					rawAssetId: "owasset_abc",
					rawVersionId: "owver_abc",
					normalizedCanonicalUrl: "https://www.example.edu/about.html",
					pageManifestObjectKey: "source/page-manifest.json",
					contentBlocksObjectKey: "source/content-blocks.jsonl",
					discoveredLinksObjectKey: "source/discovered-links.jsonl",
					responseHtmlObjectKey: "source/response.html",
					responseBodyHash: "hash",
					blockCount: 3,
				},
			],
		};
		const blocksByObjectKey = new Map<string, OfficialWebNextContentBlock[]>([
			[
				"source/content-blocks.jsonl",
				[
					block(0, "title", "Campus Overview"),
					block(1, "heading", "Campus Overview"),
					block(2, "paragraph", "The university has a public campus guide."),
				],
			],
		]);

		const result = buildOfficialWebNextReferencePipeline({
			blocksByObjectKey,
			bundle,
			releaseId: "candidate-release-001",
		});

		expect(result.documentUnits).toEqual([
			expect.objectContaining({
				documentUnitId: "owdoc_owasset_abc_owver_abc",
				title: "Campus Overview",
				sourceUrl: "https://www.example.edu/about.html",
			}),
		]);
		expect(result.chunks).toHaveLength(1);
		expect(result.chunks[0]).toEqual(
			expect.objectContaining({
				documentUnitId: "owdoc_owasset_abc_owver_abc",
				sourceUrl: "https://www.example.edu/about.html",
			}),
		);
		expect(result.releaseManifest).toEqual(
			expect.objectContaining({
				aliasPublished: false,
				currentPointerUpdated: false,
				releaseId: "candidate-release-001",
			}),
		);
		expect(JSON.stringify(result)).not.toContain("selectedWriteTarget");
		expect(JSON.stringify(result)).not.toContain("consumerFamily");
	});
});

function block(
	rowIndex: number,
	blockRole: OfficialWebNextContentBlock["blockRole"],
	textNormalized: string,
): OfficialWebNextContentBlock {
	return {
		schemaVersion: "official_web_next_content_block.v1",
		rawAssetId: "owasset_abc",
		rawVersionId: "owver_abc",
		rowIndex,
		blockRole,
		headingLevel: blockRole === "heading" ? 1 : null,
		textNormalized,
		linkTarget: null,
		tableCells: null,
		isMainContent: true,
	};
}
