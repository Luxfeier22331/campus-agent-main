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

	it("rejects scoped rules because they are not in the current docs consumption surface", () => {
		expect(() =>
			buildDocsReadModelImportPlan({
				collections: [
					{
						collection: "scoped_rules",
						corpus: "regulations",
						description: "Scoped rules are a non-serving holding collection.",
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
				readerAssets: [],
				schemaVersion: "document_reader_publish_manifest_v1",
				searchUnits: [],
			}),
		).toThrow("unsupported docs read model scope: regulations/scoped_rules");
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
			searchUnits: [],
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
			surface: "public_docs",
		});
	});
});
