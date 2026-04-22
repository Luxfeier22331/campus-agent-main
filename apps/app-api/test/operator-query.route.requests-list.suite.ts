import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { AppApiRouteError } from "../src/http";
import type { OperatorQueryService } from "../src/modules/operator-query";
import {
	createCampusPrincipal,
	createOperatorPrincipal,
	createOperatorQueryServiceMock,
	env,
} from "./operator-query.route.test-support";

export function registerOperatorQueryRequestsListSuite(): void {
	describe("GET /api/operator/requests", () => {
		it("returns request projections for operator principals only", async () => {
			const service: OperatorQueryService = {
				getById: vi.fn(),
				getAuditById: vi.fn(),
				getObservabilityById: vi.fn(),
				getOverview: vi.fn(),
				getQualitySummary: vi.fn(),
				getQualityTimeseries: vi.fn(),
				getSafetySummary: vi.fn(),
				listSafetyAnomalies: vi.fn(),
				getCostSummary: vi.fn(),
				getCostTimeseries: vi.fn(),
				listQualityBadcases: vi.fn(),
				listAudit: vi.fn(),
				list: vi.fn().mockResolvedValue({
					page: {
						nextCursor: "cursor_01HQ",
					},
					requests: [
						{
							answerPreview: "图书馆开放到 22:00。",
							applicabilityScope: "undergraduate",
							completedAt: "2026-03-28T08:00:01.000Z",
							conversationId: "conv_01HQ",
							durationMs: 842,
							errorCode: null,
							entitlementGroups: ["students"],
							entitlementSnapshotId: "entitlements-2026-03-29",
							principalId: "user_01HQ",
							principalLabel: "Jane Doe",
							principalType: "student",
							projectedAt: "2026-03-28T08:00:02.000Z",
							questionPreview: "图书馆开放到几点？",
							requestId: "req_01HQ",
							requestedCapability: "knowledge",
							requestedScope: {
								collection: "student_rules",
								corpus: "regulations",
							},
							selectedTarget: "rag-agent",
							sourceDocIds: ["handbook:library-hours"],
							startedAt: "2026-03-28T08:00:00.000Z",
							status: "completed",
							surface: "public_chat_web",
							traceId: "trace_01HQ",
							visibilityScope: "main",
						},
					],
				}),
			};
			const principal = createOperatorPrincipal();
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(principal),
				operatorQueryService: service,
			});

			const response = await app.fetch(
				new Request(
					"https://app-api.internal/api/operator/requests?limit=10&q=%E5%9B%BE%E4%B9%A6%E9%A6%86&status=completed",
				),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				page: {
					nextCursor: "cursor_01HQ",
				},
				requests: [
					{
						answerPreview: "图书馆开放到 22:00。",
						applicabilityScope: "undergraduate",
						completedAt: "2026-03-28T08:00:01.000Z",
						conversationId: "conv_01HQ",
						durationMs: 842,
						errorCode: null,
						entitlementGroups: ["students"],
						entitlementSnapshotId: "entitlements-2026-03-29",
						principalId: "user_01HQ",
						principalLabel: "Jane Doe",
						principalType: "student",
						projectedAt: "2026-03-28T08:00:02.000Z",
						questionPreview: "图书馆开放到几点？",
						requestId: "req_01HQ",
						requestedCapability: "knowledge",
						requestedScope: {
							collection: "student_rules",
							corpus: "regulations",
						},
						selectedTarget: "rag-agent",
						sourceDocIds: ["handbook:library-hours"],
						startedAt: "2026-03-28T08:00:00.000Z",
						status: "completed",
						surface: "public_chat_web",
						traceId: "trace_01HQ",
						visibilityScope: "main",
					},
				],
			});
			expect(service.list).toHaveBeenCalledWith({
				filters: {
					conversationId: null,
					cursor: null,
					limit: 10,
					q: "图书馆",
					requestId: null,
					status: "completed",
					surface: null,
				},
				principal,
			});
		});

		it("fails closed for missing or non-operator principals", async () => {
			const appWithoutPrincipal = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(null),
				operatorQueryService: createOperatorQueryServiceMock(),
			});

			const anonymous = await appWithoutPrincipal.fetch(
				new Request("https://app-api.internal/api/operator/requests"),
			);

			expect(anonymous.status).toBe(401);
			await expect(anonymous.json()).resolves.toEqual({
				error: {
					code: "session_required",
					details: null,
					message: "Sign in required.",
					requestId: null,
					retryable: false,
					traceId: null,
				},
			});

			const appWithUserPrincipal = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
				operatorQueryService: createOperatorQueryServiceMock(),
			});

			const forbidden = await appWithUserPrincipal.fetch(
				new Request("https://app-api.internal/api/operator/requests"),
			);

			expect(forbidden.status).toBe(403);
			await expect(forbidden.json()).resolves.toEqual({
				error: {
					code: "forbidden",
					details: null,
					message: "Operator access is not available for this principal.",
					requestId: null,
					retryable: false,
					traceId: null,
				},
			});
		});

		it("returns operator admission failures instead of collapsing them into dependency_not_ready", async () => {
			const app = createApp(env, {
				getPrincipal: vi.fn().mockRejectedValue(
					new AppApiRouteError({
						code: "operator_identity_not_admitted",
						message: "Operator identity is not admitted for panel access.",
						retryable: false,
						status: 403,
					}),
				),
				operatorQueryService: createOperatorQueryServiceMock(),
			});

			const response = await app.fetch(
				new Request("https://app-api.internal/api/operator/requests"),
			);

			expect(response.status).toBe(403);
			await expect(response.json()).resolves.toEqual({
				error: {
					code: "operator_identity_not_admitted",
					details: null,
					message: "Operator identity is not admitted for panel access.",
					requestId: null,
					retryable: false,
					traceId: null,
				},
			});
		});
	});
}
