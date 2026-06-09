// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { AppApiRouteError } from "../src/http";
import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type { DocsService } from "../src/modules/docs";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

function createCampusPrincipal(): ResolvedAppPrincipal {
	return {
		actor: {
			departments: [],
			principalId: "user_01HQ",
			principalType: "campus_member",
			roles: ["campus_member"],
			userId: "user_01HQ",
		},
		permissions: {
			chat: true,
			operator: false,
		},
		principal: {
			displayName: "Jane Doe",
			email: "jane@example.edu",
			principalId: "user_01HQ",
			type: "campus_member",
		},
		session: {
			expiresAt: "2026-04-30T07:00:00.000Z",
			sessionId: "sess_01HQ",
		},
	};
}

describe("docs routes", () => {
	it("returns docs control-plane readiness without depending on supervisor readiness", async () => {
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(null),
			getAppAuth: vi.fn().mockResolvedValue({}) as never,
			docsReadinessProbe: vi.fn().mockResolvedValue({
				dependencies: {
					auth: "ready",
					database: "ready",
					docsReadModel: "ready",
				},
				failed: {},
			}),
		});

		const response = await app.fetch(new Request("https://app-api.internal/api/docs/readyz"));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			status: "ready",
			dependencies: {
				auth: "ready",
				database: "ready",
				docsReadModel: "ready",
			},
		});
	});

	it("fails docs control-plane readiness closed when docs dependencies are unavailable", async () => {
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(null),
			docsReadinessProbe: vi.fn().mockResolvedValue({
				dependencies: {
					auth: "not_ready",
					database: "ready",
					docsReadModel: "not_ready",
				},
				failed: {
					auth: "better-auth session runtime failed probe",
					docsReadModel: "docs read-model probe returned no collections",
				},
			}),
		});

		const response = await app.fetch(new Request("https://app-api.internal/api/docs/readyz"));

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				message: "Document reader control plane is not ready.",
				retryable: true,
				traceId: null,
				requestId: null,
				details: {
					failed: {
						auth: "better-auth session runtime failed probe",
						docsReadModel: "docs read-model probe returned no collections",
					},
				},
			},
		});
	});

	it("returns collection navigation for anonymous or authenticated readers", async () => {
		const principal = createCampusPrincipal();
		const service: DocsService = {
			getDocumentSummary: vi.fn(),
			getNavigation: vi.fn().mockResolvedValue({
				collection: {
					collection: "curriculum_plan",
					corpus: "curriculum",
					description: "当前开放的培养方案与阅读入口。",
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
			}),
			getVersions: vi.fn(),
			checkReaderAdmission: vi.fn(),
			resolveReader: vi.fn(),
			search: vi.fn(),
		};
		const app = createApp(env, {
			docsService: service,
			getPrincipal: vi.fn().mockResolvedValue(principal),
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/docs/collections/curriculum/curriculum_plan/navigation",
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			collection: {
				collection: "curriculum_plan",
				corpus: "curriculum",
				description: "当前开放的培养方案与阅读入口。",
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
		expect(service.getNavigation).toHaveBeenCalledWith({
			collection: "curriculum_plan",
			corpus: "curriculum",
			principal,
		});
	});

	it("returns summary, versions, resolve, and search using the docs service contract", async () => {
		const service: DocsService = {
			getDocumentSummary: vi.fn().mockResolvedValue({
				document: {
					canonicalUrl: "/docs/curriculum/curriculum_plan/law-ethnic-class-program",
					collection: "curriculum_plan",
					corpus: "curriculum",
					currentVersionId: "ver_2026_01",
					currentVersionSlug: "2026-current",
					docId: "curriculum:law-ethnic-class-program",
					documentSlug: "law-ethnic-class-program",
					title: "法学（民族班）培养方案",
					updatedAt: "2026-04-23T08:00:00.000Z",
				},
			}),
			getNavigation: vi.fn(),
			getVersions: vi.fn().mockResolvedValue({
				document: {
					docId: "curriculum:law-ethnic-class-program",
					documentSlug: "law-ethnic-class-program",
					title: "法学（民族班）培养方案",
				},
				versions: [
					{
						effectiveFrom: "2026-02-01",
						isCurrent: true,
						label: "现行版",
						versionId: "ver_2026_01",
						versionSlug: "2026-current",
					},
				],
			}),
			checkReaderAdmission: vi.fn(),
			resolveReader: vi.fn().mockResolvedValue({
				document: {
					canonicalUrl: "/docs/curriculum/curriculum_plan/law-ethnic-class-program",
					collection: "curriculum_plan",
					corpus: "curriculum",
					docId: "curriculum:law-ethnic-class-program",
					documentSlug: "law-ethnic-class-program",
					title: "法学（民族班）培养方案",
					updatedAt: "2026-04-23T08:00:00.000Z",
					versionId: "ver_2026_01",
					versionSlug: "2026-current",
				},
				readerAsset: {
					canonicalUrl: "/docs/curriculum/curriculum_plan/law-ethnic-class-program",
					contentUrl:
						"/_docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/reader.json",
					deliveryMode: "public_static_asset",
					outlineUrl:
						"/_docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/outline.json",
				},
				readerState: {
					anchor: "semester-4",
					highlightRootUnitIds: ["semester-4-course-list", "semester-4-practice"],
				},
				resolvedVersion: {
					isCurrent: true,
					label: "现行版",
					versionId: "ver_2026_01",
					versionSlug: "2026-current",
				},
			}),
			search: vi.fn().mockResolvedValue({
				query: "大二下课程",
				results: [
					{
						anchor: "semester-4",
						canonicalUrl:
							"/docs/curriculum/curriculum_plan/law-ethnic-class-program#semester-4?hl=semester-4-course-list",
						documentTitle: "法学（民族班）培养方案",
						highlightRootUnitIds: ["semester-4-course-list"],
						kind: "section_hit",
						snippet: "第四学期开设课程包括……",
						title: "第四学期",
					},
				],
			}),
		};
		const app = createApp(env, {
			docsService: service,
			getPrincipal: vi.fn().mockResolvedValue(null),
		});

		const summaryResponse = await app.fetch(
			new Request(
				"https://app-api.internal/api/docs/collections/curriculum/curriculum_plan/documents/law-ethnic-class-program",
			),
		);
		expect(summaryResponse.status).toBe(200);
		await expect(summaryResponse.json()).resolves.toEqual({
			document: {
				canonicalUrl: "/docs/curriculum/curriculum_plan/law-ethnic-class-program",
				collection: "curriculum_plan",
				corpus: "curriculum",
				currentVersionId: "ver_2026_01",
				currentVersionSlug: "2026-current",
				docId: "curriculum:law-ethnic-class-program",
				documentSlug: "law-ethnic-class-program",
				title: "法学（民族班）培养方案",
				updatedAt: "2026-04-23T08:00:00.000Z",
			},
		});

		const versionsResponse = await app.fetch(
			new Request(
				"https://app-api.internal/api/docs/collections/curriculum/curriculum_plan/documents/law-ethnic-class-program/versions",
			),
		);
		expect(versionsResponse.status).toBe(200);
		await expect(versionsResponse.json()).resolves.toEqual({
			document: {
				docId: "curriculum:law-ethnic-class-program",
				documentSlug: "law-ethnic-class-program",
				title: "法学（民族班）培养方案",
			},
			versions: [
				{
					effectiveFrom: "2026-02-01",
					isCurrent: true,
					label: "现行版",
					versionId: "ver_2026_01",
					versionSlug: "2026-current",
				},
			],
		});

		const resolveResponse = await app.fetch(
			new Request(
				"https://app-api.internal/api/docs/collections/curriculum/curriculum_plan/documents/law-ethnic-class-program/resolve?version=2026-current&anchor=semester-4&hl=semester-4-course-list,semester-4-practice",
			),
		);
		expect(resolveResponse.status).toBe(200);
		await expect(resolveResponse.json()).resolves.toEqual({
			document: {
				canonicalUrl: "/docs/curriculum/curriculum_plan/law-ethnic-class-program",
				collection: "curriculum_plan",
				corpus: "curriculum",
				docId: "curriculum:law-ethnic-class-program",
				documentSlug: "law-ethnic-class-program",
				title: "法学（民族班）培养方案",
				updatedAt: "2026-04-23T08:00:00.000Z",
				versionId: "ver_2026_01",
				versionSlug: "2026-current",
			},
			readerAsset: {
				canonicalUrl: "/docs/curriculum/curriculum_plan/law-ethnic-class-program",
				contentUrl:
					"/_docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/reader.json",
				deliveryMode: "public_static_asset",
				outlineUrl:
					"/_docs/curriculum/curriculum_plan/law-ethnic-class-program/2026-current/outline.json",
			},
			readerState: {
				anchor: "semester-4",
				highlightRootUnitIds: ["semester-4-course-list", "semester-4-practice"],
			},
			resolvedVersion: {
				isCurrent: true,
				label: "现行版",
				versionId: "ver_2026_01",
				versionSlug: "2026-current",
			},
		});
		expect(service.resolveReader).toHaveBeenCalledWith({
			anchor: "semester-4",
			collection: "curriculum_plan",
			corpus: "curriculum",
			documentSlug: "law-ethnic-class-program",
			highlightRootUnitIds: ["semester-4-course-list", "semester-4-practice"],
			principal: null,
			version: "2026-current",
		});

		const searchResponse = await app.fetch(
			new Request(
				"https://app-api.internal/api/docs/collections/curriculum/curriculum_plan/search?q=%E5%A4%A7%E4%BA%8C%E4%B8%8B%E8%AF%BE%E7%A8%8B&limit=5&versionMode=current",
			),
		);
		expect(searchResponse.status).toBe(200);
		await expect(searchResponse.json()).resolves.toEqual({
			query: "大二下课程",
			results: [
				{
					anchor: "semester-4",
					canonicalUrl:
						"/docs/curriculum/curriculum_plan/law-ethnic-class-program#semester-4?hl=semester-4-course-list",
					documentTitle: "法学（民族班）培养方案",
					highlightRootUnitIds: ["semester-4-course-list"],
					kind: "section_hit",
					snippet: "第四学期开设课程包括……",
					title: "第四学期",
				},
			],
		});
		expect(service.search).toHaveBeenCalledWith({
			collection: "curriculum_plan",
			corpus: "curriculum",
			limit: 5,
			principal: null,
			query: "大二下课程",
			versionMode: "current",
		});
	});

	it("returns no-store admission response for gated static assets", async () => {
		const principal = createCampusPrincipal();
		const service: DocsService = {
			getDocumentSummary: vi.fn(),
			getNavigation: vi.fn(),
			getVersions: vi.fn(),
			resolveReader: vi.fn(),
			checkReaderAdmission: vi.fn().mockResolvedValue(undefined),
			search: vi.fn(),
		};
		const app = createApp(env, {
			docsService: service,
			getPrincipal: vi.fn().mockResolvedValue(principal),
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/docs/collections/curriculum/curriculum_plan/documents/restricted-program/admission?version=2026-current",
			),
		);

		expect(response.status).toBe(204);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("vary")).toBe("Cookie, Authorization");
		await expect(response.text()).resolves.toBe("");
		expect(service.checkReaderAdmission).toHaveBeenCalledWith({
			collection: "curriculum_plan",
			corpus: "curriculum",
			documentSlug: "restricted-program",
			principal,
			version: "2026-current",
		});
	});

	it("preserves fail-close behavior when gated static admission is rejected", async () => {
		const service: DocsService = {
			getDocumentSummary: vi.fn(),
			getNavigation: vi.fn(),
			getVersions: vi.fn(),
			resolveReader: vi.fn(),
			checkReaderAdmission: vi.fn().mockRejectedValue(
				new AppApiRouteError({
					code: "docs_document_not_found",
					message: "Document was not found.",
					retryable: false,
					status: 404,
				}),
			),
			search: vi.fn(),
		};
		const app = createApp(env, {
			docsService: service,
			getPrincipal: vi.fn().mockResolvedValue(null),
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/docs/collections/curriculum/curriculum_plan/documents/restricted-program/admission?version=2026-current",
			),
		);

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "docs_document_not_found",
			},
		});
		expect(service.checkReaderAdmission).toHaveBeenCalledWith({
			collection: "curriculum_plan",
			corpus: "curriculum",
			documentSlug: "restricted-program",
			principal: null,
			version: "2026-current",
		});
	});
});
