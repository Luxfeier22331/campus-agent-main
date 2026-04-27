// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { AppApiRouteError } from "../src/http";
import { buildDocsService, type DocsReadModelStore } from "../src/modules/docs";

const publicDoc = {
	canonicalUrl: "/docs/curriculum/curriculum_plan/law-ethnic-class-program",
	collection: "curriculum_plan",
	corpus: "curriculum",
	currentVersionId: "ver_2026_01",
	currentVersionSlug: "2026-current",
	deliveryMode: "public_static_asset" as const,
	docId: "curriculum:law-ethnic-class-program",
	documentSlug: "law-ethnic-class-program",
	entitlementGroups: [],
	title: "法学（民族班）培养方案",
	updatedAt: "2026-04-23T08:00:00.000Z",
	versionId: "ver_2026_01",
	versionSlug: "2026-current",
	visibilityLevel: "public",
};

const restrictedDoc = {
	...publicDoc,
	canonicalUrl: "/docs/curriculum/curriculum_plan/restricted-program",
	currentVersionId: "ver_restricted",
	currentVersionSlug: "2026-current",
	deliveryMode: "gated_asset" as const,
	docId: "curriculum:restricted-program",
	documentSlug: "restricted-program",
	entitlementGroups: ["students"],
	title: "受限培养方案",
	versionId: "ver_restricted",
	versionSlug: "2026-current",
	visibilityLevel: "restricted",
};

function createStore(): DocsReadModelStore {
	return {
		async getCollection() {
			return {
				collection: "curriculum_plan",
				corpus: "curriculum",
				description: "当前公开的培养方案。",
				displayName: "培养方案",
			};
		},
		async getDocumentVersion(input) {
			if (input.documentSlug === restrictedDoc.documentSlug) {
				return restrictedDoc;
			}
			return {
				...publicDoc,
				objectStoreKey: "reader-assets/private/reader.json",
				rawSourceLocator: "s3://campus-rag-derived/private/raw-source.json",
			};
		},
		async getReaderAsset(input) {
			if (input.documentSlug === restrictedDoc.documentSlug) {
				return {
					...restrictedDoc,
					contentUrl: "/_gated/curriculum/restricted-program/reader.json",
					manifestUrl: "/_gated/curriculum/restricted-program/asset-manifest.json",
					outlineUrl: "/_gated/curriculum/restricted-program/outline.json",
				};
			}
			return {
				...publicDoc,
				contentUrl:
					"/_docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/reader.json",
				manifestUrl:
					"/_docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/asset-manifest.json",
				objectStoreKey: "reader-assets/private/reader.json",
				outlineUrl:
					"/_docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/outline.json",
				rawSourceLocator: "s3://campus-rag-derived/private/raw-source.json",
			};
		},
		async listCollectionDocuments() {
			return [
				publicDoc,
				restrictedDoc,
				{
					...publicDoc,
					currentVersionId: "ver_history",
					currentVersionSlug: "2025-history",
					documentSlug: "old-program",
					isCurrent: false,
					title: "旧培养方案",
					versionId: "ver_history",
					versionSlug: "2025-history",
				},
			];
		},
		async listDocumentVersions(input) {
			if (input.documentSlug === restrictedDoc.documentSlug) {
				return [restrictedDoc];
			}
			return [
				{
					...publicDoc,
					effectiveFrom: "2026-02-01",
					isCurrent: true,
					label: "现行版",
				},
				{
					...publicDoc,
					currentVersionId: "ver_2025_01",
					currentVersionSlug: "2025-history",
					effectiveFrom: "2025-02-01",
					isCurrent: false,
					label: "历史版本",
					versionId: "ver_2025_01",
					versionSlug: "2025-history",
				},
			];
		},
		async searchCurrentPublic() {
			return [
				{
					...publicDoc,
					anchor: "semester-4",
					canonicalUrl: "/docs/curriculum/curriculum_plan/law-ethnic-class-program#semester-4",
					chunkId: "chunk-private-001",
					documentTitle: publicDoc.title,
					highlightRootUnitIds: ["semester-4-course-list"],
					rawSourceLocator: "s3://campus-rag-derived/private/chunk.jsonl",
					snippet: "第四学期开设法理学、宪法学。",
					title: "第四学期",
				},
				{
					...restrictedDoc,
					anchor: "restricted",
					canonicalUrl: restrictedDoc.canonicalUrl,
					documentTitle: restrictedDoc.title,
					highlightRootUnitIds: ["restricted-root"],
					snippet: "受限内容",
					title: "受限章节",
				},
			];
		},
	};
}

describe("docs service", () => {
	it("returns public current navigation and never leaks storage/source internals", async () => {
		const service = buildDocsService({ store: createStore() });

		const response = await service.getNavigation({
			collection: "curriculum_plan",
			corpus: "curriculum",
			principal: null,
		});

		expect(response).toEqual({
			collection: {
				collection: "curriculum_plan",
				corpus: "curriculum",
				description: "当前公开的培养方案。",
				displayName: "培养方案",
			},
			nodes: [
				{
					canonicalUrl: "/docs/curriculum/curriculum_plan/law-ethnic-class-program",
					documentSlug: "law-ethnic-class-program",
					isCurrent: true,
					kind: "document",
					title: "法学（民族班）培养方案",
				},
			],
		});
		expect(JSON.stringify(response)).not.toContain("reader-assets/private");
		expect(JSON.stringify(response)).not.toContain("rawSourceLocator");
	});

	it("resolves only public static reader assets for browser readers", async () => {
		const service = buildDocsService({ store: createStore() });

		const response = await service.resolveReader({
			anchor: "semester-4",
			collection: "curriculum_plan",
			corpus: "curriculum",
			documentSlug: "law-ethnic-class-program",
			highlightRootUnitIds: ["semester-4-course-list"],
			principal: null,
			version: "2026-current",
		});

		expect(response.readerAsset).toEqual({
			canonicalUrl: "/docs/curriculum/curriculum_plan/law-ethnic-class-program",
			contentUrl:
				"/_docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/reader.json",
			deliveryMode: "public_static_asset",
			outlineUrl:
				"/_docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/outline.json",
		});
		expect(JSON.stringify(response)).not.toContain("reader-assets/private");
		expect(JSON.stringify(response)).not.toContain("rawSourceLocator");

		await expect(
			service.resolveReader({
				anchor: null,
				collection: "curriculum_plan",
				corpus: "curriculum",
				documentSlug: "restricted-program",
				highlightRootUnitIds: [],
				principal: null,
				version: null,
			}),
		).rejects.toMatchObject({
			code: "docs_document_not_found",
			status: 404,
		} satisfies Partial<AppApiRouteError>);
	});

	it("returns source-card search targets without chunk or raw locator leakage", async () => {
		const service = buildDocsService({ store: createStore() });

		const response = await service.search({
			collection: "curriculum_plan",
			corpus: "curriculum",
			limit: 5,
			principal: null,
			query: "第四学期",
			versionMode: "current",
		});

		expect(response).toEqual({
			query: "第四学期",
			results: [
				{
					anchor: "semester-4",
					canonicalUrl:
						"/docs/curriculum/curriculum_plan/law-ethnic-class-program#semester-4?hl=semester-4-course-list",
					documentTitle: "法学（民族班）培养方案",
					highlightRootUnitIds: ["semester-4-course-list"],
					kind: "section_hit",
					snippet: "第四学期开设法理学、宪法学。",
					title: "第四学期",
				},
			],
		});
		expect(JSON.stringify(response)).not.toContain("chunk-private-001");
		expect(JSON.stringify(response)).not.toContain("rawSourceLocator");
	});
});
