// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createRequestScopeFactory } from "../src/app/request-scope";
import type { DocsReadModelStore } from "../src/modules/docs";
import type { AppTelemetry } from "../src/modules/telemetry";

const docsModuleMock = vi.hoisted(() => {
	const store = {
		async getCollection() {
			return {
				collection: "student_rules",
				corpus: "regulations",
				description: "公开学生手册规章。",
				displayName: "学生手册",
			};
		},
		async getDocumentVersion() {
			return null;
		},
		async getReaderAsset() {
			return null;
		},
		async listCollectionDocuments() {
			return [
				{
					canonicalUrl: "/docs/regulations/student_rules/student-attendance-management",
					collection: "student_rules",
					corpus: "regulations",
					currentVersionId: "ver_2018_current",
					currentVersionSlug: "2018-current",
					deliveryMode: "public_static_asset",
					docId: "handbook:attendance",
					documentSlug: "student-attendance-management",
					entitlementGroups: [],
					isCurrent: true,
					title: "中央民族大学学生考勤管理办法",
					updatedAt: "2026-04-23T08:00:00.000Z",
					versionId: "ver_2018_current",
					versionSlug: "2018-current",
					visibilityLevel: "public",
				},
			];
		},
		async listDocumentVersions() {
			return [];
		},
	} as DocsReadModelStore;
	return {
		createPgDocsReadModelStore: vi.fn(() => store),
	};
});

vi.mock("../src/modules/docs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/modules/docs")>();
	return {
		...actual,
		createPgDocsReadModelStore: docsModuleMock.createPgDocsReadModelStore,
	};
});

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

function createTelemetry(): AppTelemetry {
	return {
		captureException: vi.fn(),
		configureChatRequestScope: vi.fn(),
		configureHttpRequestScope: vi.fn(),
		getTraceHeaders: vi.fn(() => ({})),
		markHttpResponseStatus: vi.fn(),
		recordExecutionAuditEvent: vi.fn(async () => undefined),
		recordIdentityEndpoint: vi.fn(async () => undefined),
		recordProjectionDrain: vi.fn(async () => undefined),
		recordProjectionEnqueued: vi.fn(async () => undefined),
		recordQualitySampledGrade: vi.fn(async () => undefined),
		recordRequestAccepted: vi.fn(async () => undefined),
		recordRequestFinalized: vi.fn(async () => undefined),
		recordRequestTransportError: vi.fn(async () => undefined),
	};
}

describe("docs request scope", () => {
	it("wires the default docs service to the docs read model store", async () => {
		docsModuleMock.createPgDocsReadModelStore.mockClear();
		const factory = createRequestScopeFactory({
			dependencies: {},
			env,
			telemetry: createTelemetry(),
		});

		const response = await factory.createRequestScope().resolveDocsService().getNavigation({
			collection: "student_rules",
			corpus: "regulations",
			principal: null,
		});

		expect(docsModuleMock.createPgDocsReadModelStore).toHaveBeenCalledWith(
			env,
			expect.objectContaining({ getDb: expect.any(Function) }),
		);
		expect(response.nodes).toEqual([
			{
				canonicalUrl: "/docs/regulations/student_rules/student-attendance-management",
				documentSlug: "student-attendance-management",
				isCurrent: true,
				kind: "document",
				title: "中央民族大学学生考勤管理办法",
			},
		]);
	});
});
