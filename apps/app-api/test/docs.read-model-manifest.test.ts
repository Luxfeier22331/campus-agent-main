// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	buildDocsReadModelImportPlan,
	buildPublicDocsSyncManifestFromReadModel,
} from "../src/modules/docs/read-model-manifest";

describe("docs read model manifest", () => {
	it("rejects unsupported internal notice source scope", () => {
		expect(() =>
			buildDocsReadModelImportPlan({
				collections: [
					{
						collection: "internal_notice",
						corpus: "campus_notices",
						description: "Source notices are not document-reader targets.",
						displayName: "内部通知",
						updatedAt: "2026-04-27T08:00:00.000Z",
					},
				],
				documentVersions: [
					{
						deliveryMode: "gated_asset",
						docId: "notice:muc_internal_portal:187233",
						entitlementGroups: ["campus_members"],
						isCurrent: true,
						label: "现行版",
						updatedAt: "2026-04-27T08:00:00.000Z",
						versionId: "sha256:187233",
						versionSlug: "2021-current",
						visibilityLevel: "restricted",
					},
				],
				documents: [
					{
						canonicalUrl: "/docs/campus_notices/internal_notice/187233",
						collection: "internal_notice",
						corpus: "campus_notices",
						currentVersionId: "sha256:187233",
						currentVersionSlug: "2021-current",
						docId: "notice:muc_internal_portal:187233",
						documentSlug: "187233",
						title: "关于修订《中央民族大学采购工作管理办法》的通知",
						updatedAt: "2026-04-27T08:00:00.000Z",
					},
				],
				generatedAt: "2026-04-27T08:00:00.000Z",
				readerAssets: [],
				schemaVersion: "document_reader_publish_manifest_v1",
				searchUnits: [],
			}),
		).toThrow("unsupported docs read model scope: campus_notices/internal_notice");
	});

	it("allows scoped rules as gated reader documents without making them public static assets", () => {
		const plan = buildDocsReadModelImportPlan({
			collections: [
				{
					collection: "scoped_rules",
					corpus: "regulations",
					description: "Scoped rules are gated reader documents.",
					displayName: "专项规章",
					updatedAt: "2026-05-18T08:00:00.000Z",
				},
			],
			documentVersions: [
				{
					deliveryMode: "gated_asset",
					docId: "regulation:scoped:college-rule",
					entitlementGroups: ["campus_members"],
					isCurrent: true,
					label: "现行版",
					updatedAt: "2026-05-18T08:00:00.000Z",
					versionId: "sha256:scoped-rule",
					versionSlug: "2026-current",
					visibilityLevel: "restricted",
				},
			],
			documents: [
				{
					canonicalUrl: "/docs/regulations/scoped_rules/college-rule",
					collection: "scoped_rules",
					corpus: "regulations",
					currentVersionId: "sha256:scoped-rule",
					currentVersionSlug: "2026-current",
					docId: "regulation:scoped:college-rule",
					documentSlug: "college-rule",
					title: "某学院专项实施细则",
					updatedAt: "2026-05-18T08:00:00.000Z",
				},
			],
			generatedAt: "2026-05-18T08:00:00.000Z",
			readerAssets: [
				{
					contentUrl: "/_gated-docs/regulations/scoped_rules/college-rule/2026-current/reader.json",
					outlineUrl:
						"/_gated-docs/regulations/scoped_rules/college-rule/2026-current/outline.json",
					sourceObjects: { reader: "reader-assets/scoped-rule/reader.json" },
					staticPrefix: "/_gated-docs/regulations/scoped_rules/college-rule/2026-current",
					targetObjects: {
						reader: "_gated-docs/regulations/scoped_rules/college-rule/2026-current/reader.json",
					},
					updatedAt: "2026-05-18T08:00:00.000Z",
					versionId: "sha256:scoped-rule",
				},
			],
			schemaVersion: "document_reader_publish_manifest_v1",
			searchUnits: [
				{
					anchor: "overview",
					canonicalUrl: "/docs/curriculum/curriculum_plan/law",
					docId: "curriculum:law",
					highlightRootUnitIds: ["law-root"],
					searchText: "法学 培养目标",
					searchUnitId: "search_public_current",
					snippet: "法学专业培养目标。",
					title: "培养目标",
					unitOrder: 1,
					versionId: "ver_law",
				},
				{
					anchor: "history",
					canonicalUrl: "/docs/curriculum/curriculum_plan/law/v/2025-history#history",
					docId: "curriculum:law",
					highlightRootUnitIds: ["history-root"],
					searchText: "历史版本",
					searchUnitId: "search_public_history",
					snippet: "历史版本正文。",
					title: "历史版本",
					unitOrder: 1,
					versionId: "ver_law_2025",
				},
				{
					anchor: "restricted",
					canonicalUrl: "/docs/curriculum/curriculum_plan/restricted#restricted",
					docId: "curriculum:restricted",
					highlightRootUnitIds: ["restricted-root"],
					searchText: "受限正文",
					searchUnitId: "search_restricted",
					snippet: "受限正文。",
					title: "受限章节",
					unitOrder: 1,
					versionId: "ver_restricted",
				},
			],
		});

		expect(plan.scopes).toEqual([{ collection: "scoped_rules", corpus: "regulations" }]);
		const syncManifest = buildPublicDocsSyncManifestFromReadModel(plan, "2026-05-18T08:10:00.000Z");
		expect(syncManifest.entries[0]).toMatchObject({
			collection: "scoped_rules",
			corpus: "regulations",
			deliveryMode: "gated_asset",
			targetObjects: {
				reader: "_gated-docs/regulations/scoped_rules/college-rule/2026-current/reader.json",
			},
		});
	});

	it("builds a deterministic import plan and exports only public static assets", () => {
		const plan = buildDocsReadModelImportPlan({
			collections: [
				{
					collection: "curriculum_plan",
					corpus: "curriculum",
					description: "公开培养方案。",
					displayName: "培养方案",
					updatedAt: "2026-04-27T08:00:00.000Z",
				},
			],
			documentVersions: [
				{
					deliveryMode: "public_static_asset",
					docId: "curriculum:law",
					effectiveFrom: "2026-02-01",
					entitlementGroups: [],
					isCurrent: true,
					label: "现行版",
					updatedAt: "2026-04-27T08:00:00.000Z",
					versionId: "ver_law",
					versionSlug: "2026-current",
					visibilityLevel: "public",
				},
				{
					deliveryMode: "public_static_asset",
					docId: "curriculum:law",
					effectiveFrom: "2025-02-01",
					entitlementGroups: [],
					isCurrent: false,
					label: "2025 版",
					updatedAt: "2026-04-27T08:00:00.000Z",
					versionId: "ver_law_2025",
					versionSlug: "2025-history",
					visibilityLevel: "public",
				},
				{
					deliveryMode: "gated_asset",
					docId: "curriculum:restricted",
					entitlementGroups: ["students"],
					isCurrent: true,
					label: "现行版",
					updatedAt: "2026-04-27T08:00:00.000Z",
					versionId: "ver_restricted",
					versionSlug: "2026-current",
					visibilityLevel: "restricted",
				},
			],
			documents: [
				{
					canonicalUrl: "/docs/curriculum/curriculum_plan/law",
					collection: "curriculum_plan",
					corpus: "curriculum",
					currentVersionId: "ver_law",
					currentVersionSlug: "2026-current",
					docId: "curriculum:law",
					documentSlug: "law",
					title: "法学本科人才培养方案",
					updatedAt: "2026-04-27T08:00:00.000Z",
				},
				{
					canonicalUrl: "/docs/curriculum/curriculum_plan/restricted",
					collection: "curriculum_plan",
					corpus: "curriculum",
					currentVersionId: "ver_restricted",
					currentVersionSlug: "2026-current",
					docId: "curriculum:restricted",
					documentSlug: "restricted",
					title: "受限培养方案",
					updatedAt: "2026-04-27T08:00:00.000Z",
				},
			],
			generatedAt: "2026-04-27T08:00:00.000Z",
			readerAssets: [
				{
					contentUrl: "/_docs/curriculum/curriculum_plan/law/2026-current/reader.json",
					manifestUrl: "/_docs/curriculum/curriculum_plan/law/2026-current/asset-manifest.json",
					outlineUrl: "/_docs/curriculum/curriculum_plan/law/2026-current/outline.json",
					sourceObjects: { reader: "reader-assets/law/reader.json" },
					staticPrefix: "/_docs/curriculum/curriculum_plan/law/2026-current",
					targetObjects: {
						reader: "_docs/curriculum/curriculum_plan/law/2026-current/reader.json",
					},
					updatedAt: "2026-04-27T08:00:00.000Z",
					versionId: "ver_law",
				},
				{
					contentUrl: "/_docs/curriculum/curriculum_plan/law/2025-history/reader.json",
					manifestUrl: "/_docs/curriculum/curriculum_plan/law/2025-history/asset-manifest.json",
					outlineUrl: "/_docs/curriculum/curriculum_plan/law/2025-history/outline.json",
					sourceObjects: { reader: "reader-assets/law-2025/reader.json" },
					staticPrefix: "/_docs/curriculum/curriculum_plan/law/2025-history",
					targetObjects: {
						reader: "_docs/curriculum/curriculum_plan/law/2025-history/reader.json",
					},
					updatedAt: "2026-04-27T08:00:00.000Z",
					versionId: "ver_law_2025",
				},
				{
					contentUrl: "/_gated-docs/curriculum/restricted/2026-current/reader.json",
					outlineUrl: "/_gated-docs/curriculum/restricted/2026-current/outline.json",
					sourceObjects: { reader: "reader-assets/restricted/reader.json" },
					staticPrefix: "/_gated-docs/curriculum/restricted/2026-current",
					targetObjects: {
						reader: "_gated-docs/curriculum/restricted/2026-current/reader.json",
					},
					updatedAt: "2026-04-27T08:00:00.000Z",
					versionId: "ver_restricted",
				},
			],
			schemaVersion: "document_reader_publish_manifest_v1",
			searchUnits: [
				{
					anchor: "overview",
					canonicalUrl: "/docs/curriculum/curriculum_plan/law",
					docId: "curriculum:law",
					highlightRootUnitIds: ["law-root"],
					searchText: "法学 培养目标",
					searchUnitId: "search_public_current",
					snippet: "法学专业培养目标。",
					title: "培养目标",
					unitOrder: 1,
					versionId: "ver_law",
				},
				{
					anchor: "history",
					canonicalUrl: "/docs/curriculum/curriculum_plan/law/v/2025-history#history",
					docId: "curriculum:law",
					highlightRootUnitIds: ["history-root"],
					searchText: "历史版本",
					searchUnitId: "search_public_history",
					snippet: "历史版本正文。",
					title: "历史版本",
					unitOrder: 1,
					versionId: "ver_law_2025",
				},
				{
					anchor: "restricted",
					canonicalUrl: "/docs/curriculum/curriculum_plan/restricted#restricted",
					docId: "curriculum:restricted",
					highlightRootUnitIds: ["restricted-root"],
					searchText: "受限正文",
					searchUnitId: "search_restricted",
					snippet: "受限正文。",
					title: "受限章节",
					unitOrder: 1,
					versionId: "ver_restricted",
				},
			],
		});

		expect(plan.scopes).toEqual([{ collection: "curriculum_plan", corpus: "curriculum" }]);
		expect(plan.collections).toHaveLength(1);
		expect(plan.documents).toHaveLength(2);
		expect(plan.readerAssets[0]?.sourceObjects).toEqual({
			reader: "reader-assets/law/reader.json",
		});

		expect(buildPublicDocsSyncManifestFromReadModel(plan, "2026-04-27T08:10:00.000Z")).toEqual({
			entries: [
				{
					collection: "curriculum_plan",
					corpus: "curriculum",
					deliveryMode: "public_static_asset",
					docId: "curriculum:law",
					documentSlug: "law",
					sourceObjects: { reader: "reader-assets/law/reader.json" },
					targetObjects: {
						reader: "_docs/curriculum/curriculum_plan/law/2026-current/reader.json",
					},
					title: "法学本科人才培养方案",
					isCurrent: true,
					versionLabel: "现行版",
					versionId: "ver_law",
					versionSlug: "2026-current",
				},
				{
					collection: "curriculum_plan",
					corpus: "curriculum",
					deliveryMode: "public_static_asset",
					docId: "curriculum:law",
					documentSlug: "law",
					sourceObjects: { reader: "reader-assets/law-2025/reader.json" },
					targetObjects: {
						reader: "_docs/curriculum/curriculum_plan/law/2025-history/reader.json",
					},
					title: "法学本科人才培养方案",
					isCurrent: false,
					versionLabel: "2025 版",
					versionId: "ver_law_2025",
					versionSlug: "2025-history",
				},
				{
					collection: "curriculum_plan",
					corpus: "curriculum",
					deliveryMode: "gated_asset",
					docId: "curriculum:restricted",
					documentSlug: "restricted",
					sourceObjects: { reader: "reader-assets/restricted/reader.json" },
					targetObjects: {
						reader: "_gated-docs/curriculum/restricted/2026-current/reader.json",
					},
					title: "受限培养方案",
					isCurrent: true,
					versionLabel: "现行版",
					versionId: "ver_restricted",
					versionSlug: "2026-current",
				},
			],
			generatedAt: "2026-04-27T08:10:00.000Z",
			searchUnits: [
				{
					anchor: "overview",
					canonicalUrl: "/docs/curriculum/curriculum_plan/law",
					collection: "curriculum_plan",
					corpus: "curriculum",
					docId: "curriculum:law",
					documentSlug: "law",
					documentTitle: "法学本科人才培养方案",
					highlightRootUnitIds: ["law-root"],
					searchUnitId: "search_public_current",
					snippet: "法学专业培养目标。",
					title: "培养目标",
					versionId: "ver_law",
					versionSlug: "2026-current",
				},
			],
			surface: "public_docs",
		});
	});
});
