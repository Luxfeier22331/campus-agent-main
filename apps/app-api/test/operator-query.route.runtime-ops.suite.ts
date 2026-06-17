import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import {
	createCampusPrincipal,
	createOperatorPrincipal,
	createOperatorQueryServiceMock,
	env,
} from "./operator-query.route.test-support";

export function registerOperatorQueryRuntimeOpsSuite(): void {
	describe("GET /api/operator/runtime/temporal-task-queues", () => {
		it("returns Temporal task queue projections for operator principals", async () => {
			const service = createOperatorQueryServiceMock({
				listTemporalTaskQueues: vi.fn().mockResolvedValue({
					page: { nextCursor: null },
					snapshots: [
						{
							backlog: { count: null, state: "unsupported_by_source" },
							namespace: "default",
							oldestTaskAge: { ms: null, state: "unsupported_by_source" },
							pollerCount: 0,
							pollerIdentities: [],
							projectedAt: "2026-06-15T10:00:02.000Z",
							sampledAt: "2026-06-15T10:00:00.000Z",
							scheduleToStartLatency: { ms: null, state: "unsupported_by_source" },
							snapshotId: "temporal-snapshot-20260615T100000Z",
							source: "execution-control.temporal-task-queue-sampler",
							taskQueue: "campus-agent.activity.knowledge.retrieval",
							taskQueueKind: "activity",
						},
					],
				}),
			});
			const principal = createOperatorPrincipal();
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(principal),
				operatorQueryService: service,
			});

			const response = await app.fetch(
				new Request(
					"https://app-api.internal/api/operator/runtime/temporal-task-queues?taskQueue=campus-agent.activity.knowledge.retrieval&limit=10",
				),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				page: { nextCursor: null },
				snapshots: [
					{
						backlog: { count: null, state: "unsupported_by_source" },
						namespace: "default",
						oldestTaskAge: { ms: null, state: "unsupported_by_source" },
						pollerCount: 0,
						pollerIdentities: [],
						projectedAt: "2026-06-15T10:00:02.000Z",
						sampledAt: "2026-06-15T10:00:00.000Z",
						scheduleToStartLatency: { ms: null, state: "unsupported_by_source" },
						snapshotId: "temporal-snapshot-20260615T100000Z",
						source: "execution-control.temporal-task-queue-sampler",
						taskQueue: "campus-agent.activity.knowledge.retrieval",
						taskQueueKind: "activity",
					},
				],
			});
			expect(service.listTemporalTaskQueues).toHaveBeenCalledWith({
				filters: {
					cursor: null,
					limit: 10,
					taskQueue: "campus-agent.activity.knowledge.retrieval",
					taskQueueKind: null,
				},
				principal,
			});
		});

		it("rejects non-operator principals", async () => {
			const service = createOperatorQueryServiceMock({
				listTemporalTaskQueues: vi.fn(),
			});
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
				operatorQueryService: service,
			});

			const response = await app.fetch(
				new Request("https://app-api.internal/api/operator/runtime/temporal-task-queues"),
			);

			expect(response.status).toBe(403);
			expect(service.listTemporalTaskQueues).not.toHaveBeenCalled();
		});
	});

	describe("GET /api/operator/runtime/autoscaler/decisions", () => {
		it("returns autoscaler decisions and actuations for operator principals", async () => {
			const service = createOperatorQueryServiceMock({
				listAutoscalerDecisions: vi.fn().mockResolvedValue({
					decisions: [
						{
							budgetState: "within_budget",
							currentReplicas: 1,
							decidedAt: "2026-06-15T10:00:05.000Z",
							decision: "scale_up",
							decisionId: "decision_01",
							desiredReplicas: 2,
							reason: "required poller floor is not met",
							sourceSnapshotId: "temporal-snapshot-20260615T100000Z",
							targetService: "activity-worker-knowledge-retrieval",
							taskQueue: "campus-agent.activity.knowledge.retrieval",
							taskQueueKind: "activity",
						},
					],
					page: { nextCursor: null },
				}),
			});
			const principal = createOperatorPrincipal();
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(principal),
				operatorQueryService: service,
			});

			const response = await app.fetch(
				new Request(
					"https://app-api.internal/api/operator/runtime/autoscaler/decisions?targetService=activity-worker-knowledge-retrieval",
				),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				decisions: [
					{
						budgetState: "within_budget",
						currentReplicas: 1,
						decidedAt: "2026-06-15T10:00:05.000Z",
						decision: "scale_up",
						decisionId: "decision_01",
						desiredReplicas: 2,
						reason: "required poller floor is not met",
						sourceSnapshotId: "temporal-snapshot-20260615T100000Z",
						targetService: "activity-worker-knowledge-retrieval",
						taskQueue: "campus-agent.activity.knowledge.retrieval",
						taskQueueKind: "activity",
					},
				],
				page: { nextCursor: null },
			});
			expect(service.listAutoscalerDecisions).toHaveBeenCalledWith({
				filters: {
					cursor: null,
					decision: null,
					limit: null,
					targetService: "activity-worker-knowledge-retrieval",
				},
				principal,
			});
		});
	});

	describe("GET /api/operator/runtime/autoscaler/actuations", () => {
		it("returns autoscaler actuation evidence for operator principals", async () => {
			const service = createOperatorQueryServiceMock({
				listAutoscalerActuations: vi.fn().mockResolvedValue({
					actuations: [
						{
							actedAt: "2026-06-15T10:00:06.000Z",
							action: "scale",
							actuationId: "actuation_01",
							actuatorKind: "docker_compose",
							decisionId: "decision_01",
							errorCode: "docker_compose_scale_failed",
							fromReplicas: 1,
							status: "failed",
							targetService: "activity-worker-knowledge-retrieval",
							toReplicas: 2,
						},
					],
					page: { nextCursor: null },
				}),
			});
			const principal = createOperatorPrincipal();
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(principal),
				operatorQueryService: service,
			});

			const response = await app.fetch(
				new Request(
					"https://app-api.internal/api/operator/runtime/autoscaler/actuations?targetService=activity-worker-knowledge-retrieval&status=failed",
				),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				actuations: [
					{
						actedAt: "2026-06-15T10:00:06.000Z",
						action: "scale",
						actuationId: "actuation_01",
						actuatorKind: "docker_compose",
						decisionId: "decision_01",
						errorCode: "docker_compose_scale_failed",
						fromReplicas: 1,
						status: "failed",
						targetService: "activity-worker-knowledge-retrieval",
						toReplicas: 2,
					},
				],
				page: { nextCursor: null },
			});
			expect(service.listAutoscalerActuations).toHaveBeenCalledWith({
				filters: {
					cursor: null,
					decisionId: null,
					limit: null,
					status: "failed",
					targetService: "activity-worker-knowledge-retrieval",
				},
				principal,
			});
		});
	});
}
