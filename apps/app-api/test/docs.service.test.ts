// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { AppApiRouteError } from "../src/http";
import type { ResolvedAppPrincipal } from "../src/modules/auth";
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

const restrictedRegulationDoc = {
	canonicalUrl:
		"/docs/regulations/scoped_rules/中央民族大学中华民族共同体学院-2026年-英才计划-硕博连读研究生招生实施细则",
	collection: "scoped_rules",
	corpus: "regulations",
	currentVersionId: "ver_scoped_rule",
	currentVersionSlug: "2026-current",
	deliveryMode: "gated_asset" as const,
	docId: "institutional_regulation:muc:scoped-rule",
	documentSlug: "中央民族大学中华民族共同体学院-2026年-英才计划-硕博连读研究生招生实施细则",
	entitlementGroups: ["campus_members"],
	title: "中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则",
	updatedAt: "2026-04-28T12:53:09.490Z",
	versionId: "ver_scoped_rule",
	versionSlug: "2026-current",
	visibilityLevel: "restricted",
};

const historicalPublicDoc = {
	...publicDoc,
	currentVersionId: "ver_2026_01",
	currentVersionSlug: "2026-current",
	isCurrent: false,
	label: "2025 版",
	versionId: "ver_2025_01",
	versionSlug: "2025-history",
};

function createStore(): DocsReadModelStore {
	return {
		async getCollection(input) {
			if (input.corpus === "regulations" && input.collection === "scoped_rules") {
				return {
					collection: "scoped_rules",
					corpus: "regulations",
					description: "已发布到文档站的受控规章通知。",
					displayName: "专项规章",
				};
			}
			return {
				collection: "curriculum_plan",
				corpus: "curriculum",
				description: "当前公开的培养方案。",
				displayName: "培养方案",
			};
		},
		async getDocumentVersion(input) {
			if (input.documentSlug === restrictedRegulationDoc.documentSlug) {
				return restrictedRegulationDoc;
			}
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
			if (input.documentSlug === restrictedRegulationDoc.documentSlug) {
				return {
					...restrictedRegulationDoc,
					contentUrl: "/_gated-docs/regulations/scoped_rules/scoped-rule/2026-current/reader.json",
					manifestUrl:
						"/_gated-docs/regulations/scoped_rules/scoped-rule/2026-current/asset-manifest.json",
					outlineUrl: "/_gated-docs/regulations/scoped_rules/scoped-rule/2026-current/outline.json",
					sourceObjects: {
						"asset-manifest":
							"regulations/documents/scoped_rules/scoped-rule/source-faithful/2026/reader-assets/asset-manifest.json",
						meta: "regulations/documents/scoped_rules/scoped-rule/source-faithful/2026/reader-assets/meta.json",
						outline:
							"regulations/documents/scoped_rules/scoped-rule/source-faithful/2026/reader-assets/outline.json",
						reader:
							"regulations/documents/scoped_rules/scoped-rule/source-faithful/2026/reader-assets/reader.json",
					},
				};
			}
			if (input.documentSlug === restrictedDoc.documentSlug) {
				return {
					...restrictedDoc,
					contentUrl: "/_gated-docs/curriculum/restricted-program/reader.json",
					manifestUrl: "/_gated-docs/curriculum/restricted-program/asset-manifest.json",
					outlineUrl: "/_gated-docs/curriculum/restricted-program/outline.json",
					sourceObjects: {
						"asset-manifest": "reader-assets/restricted-program/asset-manifest.json",
						meta: "reader-assets/restricted-program/meta.json",
						outline: "reader-assets/restricted-program/outline.json",
						reader: "reader-assets/restricted-program/reader.json",
					},
				};
			}
			if (input.version === historicalPublicDoc.versionSlug) {
				return {
					...historicalPublicDoc,
					canonicalUrl: publicDoc.canonicalUrl,
					contentUrl:
						"/_docs/curriculum/curriculum_plan/law-ethnic-class-program/2025-history/reader.json",
					manifestUrl:
						"/_docs/curriculum/curriculum_plan/law-ethnic-class-program/2025-history/asset-manifest.json",
					outlineUrl:
						"/_docs/curriculum/curriculum_plan/law-ethnic-class-program/2025-history/outline.json",
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
		async listCollectionDocuments(input) {
			if (input.corpus === "regulations" && input.collection === "scoped_rules") {
				return [restrictedRegulationDoc];
			}
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
			if (input.documentSlug === restrictedRegulationDoc.documentSlug) {
				return [restrictedRegulationDoc];
			}
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
					...historicalPublicDoc,
					effectiveFrom: "2025-02-01",
				},
			];
		},
		async searchCurrentPublic() {
			return [
				{
					...publicDoc,
					anchor: "semester-4",
					canonicalUrl: "/docs/curriculum/curriculum_plan/law-ethnic-class-program",
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

function createStudentPrincipal(): ResolvedAppPrincipal {
	return {
		actor: {
			departments: [],
			principalId: "user_student",
			principalType: "student",
			roles: ["student"],
			userId: "user_student",
		},
		authorization: {
			approvalState: "approved",
			entitlementGroups: ["campus_members", "students"],
			entitlementSnapshotId: "snapshot_student",
			ownershipScopes: [],
			principalId: "user_student",
			projectionSource: "campus_identity",
			retrievalFilter: {
				entitlementGroups: ["campus_members", "students"],
				policyProjectionVersion: "phase1-authorization-projection-v1",
				visibilityLevel: "restricted",
				visibilityScope: null,
			},
			visibilityScope: null,
		},
		permissions: {
			chat: true,
			operator: false,
		},
		principal: {
			displayName: "学生用户",
			email: "student@muc.edu.cn",
			principalId: "user_student",
			type: "student",
		},
		session: {
			expiresAt: "2026-04-30T07:00:00.000Z",
			sessionId: "sess_student",
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

		const historical = await service.resolveReader({
			anchor: "semester-4",
			collection: "curriculum_plan",
			corpus: "curriculum",
			documentSlug: "law-ethnic-class-program",
			highlightRootUnitIds: ["semester-4-course-list"],
			principal: null,
			version: "2025-history",
		});

		expect(historical.readerAsset).toEqual({
			canonicalUrl: "/docs/curriculum/curriculum_plan/law-ethnic-class-program/v/2025-history",
			contentUrl:
				"/_docs/curriculum/curriculum_plan/law-ethnic-class-program/2025-history/reader.json",
			deliveryMode: "public_static_asset",
			outlineUrl:
				"/_docs/curriculum/curriculum_plan/law-ethnic-class-program/2025-history/outline.json",
		});
		expect(historical.document.canonicalUrl).toBe(
			"/docs/curriculum/curriculum_plan/law-ethnic-class-program/v/2025-history",
		);
		expect(historical.resolvedVersion).toEqual({
			isCurrent: false,
			label: "2025 版",
			versionId: "ver_2025_01",
			versionSlug: "2025-history",
		});

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

	it("resolves restricted reader descriptors and server-only source objects for authorized principals", async () => {
		const service = buildDocsService({ store: createStore() });
		const principal = createStudentPrincipal();

		const response = await service.resolveReader({
			anchor: "restricted-section",
			collection: "curriculum_plan",
			corpus: "curriculum",
			documentSlug: "restricted-program",
			highlightRootUnitIds: ["restricted-root"],
			principal,
			version: null,
		});

		expect(response.readerAsset).toEqual({
			canonicalUrl: "/docs/curriculum/curriculum_plan/restricted-program",
			contentUrl:
				"/_gated-docs/curriculum/curriculum_plan/restricted-program/2026-current/reader.json",
			deliveryMode: "gated_asset",
			outlineUrl:
				"/_gated-docs/curriculum/curriculum_plan/restricted-program/2026-current/outline.json",
		});
		expect(JSON.stringify(response)).not.toContain("reader-assets/restricted-program");

		await expect(
			service.checkReaderAdmission({
				collection: "curriculum_plan",
				corpus: "curriculum",
				documentSlug: "restricted-program",
				principal,
				version: "2026-current",
			}),
		).resolves.toBeUndefined();
	});

	it("lists and resolves gated scoped regulation notices for entitled campus members", async () => {
		const service = buildDocsService({ store: createStore() });
		const principal = createStudentPrincipal();

		const navigation = await service.getNavigation({
			collection: "scoped_rules",
			corpus: "regulations",
			principal,
		});

		expect(navigation.nodes).toEqual([
			{
				canonicalUrl: restrictedRegulationDoc.canonicalUrl,
				documentSlug: restrictedRegulationDoc.documentSlug,
				isCurrent: true,
				kind: "document",
				title: restrictedRegulationDoc.title,
			},
		]);

		const response = await service.resolveReader({
			anchor: null,
			collection: "scoped_rules",
			corpus: "regulations",
			documentSlug: restrictedRegulationDoc.documentSlug,
			highlightRootUnitIds: [],
			principal,
			version: null,
		});

		const encodedSlug = encodeURIComponent(restrictedRegulationDoc.documentSlug);
		expect(response.readerAsset).toEqual({
			canonicalUrl: restrictedRegulationDoc.canonicalUrl,
			contentUrl: `/_gated-docs/regulations/scoped_rules/${encodedSlug}/2026-current/reader.json`,
			deliveryMode: "gated_asset",
			outlineUrl: `/_gated-docs/regulations/scoped_rules/${encodedSlug}/2026-current/outline.json`,
		});
		expect(JSON.stringify(response)).not.toContain("regulations/documents/");
		expect(JSON.stringify(response)).not.toContain("reader-assets/");

		await expect(
			service.checkReaderAdmission({
				collection: "scoped_rules",
				corpus: "regulations",
				documentSlug: restrictedRegulationDoc.documentSlug,
				principal,
				version: "2026-current",
			}),
		).resolves.toBeUndefined();

		await expect(
			service.checkReaderAdmission({
				collection: "scoped_rules",
				corpus: "regulations",
				documentSlug: restrictedRegulationDoc.documentSlug,
				principal: null,
				version: "2026-current",
			}),
		).rejects.toMatchObject({
			code: "docs_document_not_found",
			status: 404,
		} satisfies Partial<AppApiRouteError>);
	});

	it("fails closed for gated-only collection navigation without matching entitlement", async () => {
		const service = buildDocsService({ store: createStore() });

		await expect(
			service.getNavigation({
				collection: "scoped_rules",
				corpus: "regulations",
				principal: null,
			}),
		).rejects.toMatchObject({
			code: "docs_collection_not_found",
			status: 404,
		} satisfies Partial<AppApiRouteError>);
	});

	it("fails closed for restricted reader admission without matching entitlement", async () => {
		const service = buildDocsService({ store: createStore() });

		await expect(
			service.checkReaderAdmission({
				collection: "curriculum_plan",
				corpus: "curriculum",
				documentSlug: "restricted-program",
				principal: null,
				version: "2026-current",
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
						"/docs/curriculum/curriculum_plan/law-ethnic-class-program?hl=semester-4-course-list#semester-4",
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
