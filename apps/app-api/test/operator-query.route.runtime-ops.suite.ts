import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { createOperatorQueryServiceMock, env } from "./operator-query.route.test-support";

const internalEnv = {
	...env,
	APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
};

const internalRuntimePrincipal = expect.objectContaining({
	principal: expect.objectContaining({
		principalId: "execution-control-runtime",
		type: "operator",
	}),
});

export function registerOperatorQueryRuntimeOpsSuite(): void {
	describe("GET /api/internal/operator/runtime/temporal-task-queues", () => {
		it("returns Temporal task queue projections for trusted internal callers", async () => {
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
							taskQueue: "campus-agent.activity.agent",
							taskQueueKind: "activity",
						},
					],
				}),
			});
			const app = createApp(internalEnv, {
				operatorQueryService: service,
			});

			const response = await app.fetch(
				new Request(
					"https://app-api.internal/api/internal/operator/runtime/temporal-task-queues?taskQueue=campus-agent.activity.agent&limit=10",
					{ headers: { "x-app-internal-auth": "trusted-secret" } },
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
						taskQueue: "campus-agent.activity.agent",
						taskQueueKind: "activity",
					},
				],
			});
			expect(service.listTemporalTaskQueues).toHaveBeenCalledWith({
				filters: {
					cursor: null,
					limit: 10,
					taskQueue: "campus-agent.activity.agent",
					taskQueueKind: null,
				},
				principal: internalRuntimePrincipal,
			});
		});

		it("rejects callers without the internal shared secret", async () => {
			const service = createOperatorQueryServiceMock({
				listTemporalTaskQueues: vi.fn(),
			});
			const app = createApp(internalEnv, {
				operatorQueryService: service,
			});

			const response = await app.fetch(
				new Request("https://app-api.internal/api/internal/operator/runtime/temporal-task-queues"),
			);

			expect(response.status).toBe(401);
			expect(service.listTemporalTaskQueues).not.toHaveBeenCalled();
		});
	});

	describe("GET /api/internal/operator/runtime/autoscaler/actuations", () => {
		it("returns autoscaler actuation evidence for trusted internal callers", async () => {
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
							targetService: "activity-worker-agent",
							toReplicas: 2,
						},
					],
					page: { nextCursor: null },
				}),
			});
			const app = createApp(internalEnv, {
				operatorQueryService: service,
			});

			const response = await app.fetch(
				new Request(
					"https://app-api.internal/api/internal/operator/runtime/autoscaler/actuations?targetService=activity-worker-agent&status=failed",
					{ headers: { "x-app-internal-auth": "trusted-secret" } },
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
						targetService: "activity-worker-agent",
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
					targetService: "activity-worker-agent",
				},
				principal: internalRuntimePrincipal,
			});
		});
	});

	describe("GET /api/internal/operator/runtime/autoscaler/postures", () => {
		it("returns KEDA/HPA scaler posture for trusted internal callers", async () => {
			const service = createOperatorQueryServiceMock({
				listAutoscalerPostures: vi.fn().mockResolvedValue({
					page: { nextCursor: null },
					postures: [
						{
							currentReplicas: 1,
							desiredReplicas: 2,
							evidence: {
								hpaName: "keda-hpa-activity-worker-agent",
								kedaScaledObject: "activity-worker-agent",
							},
							lastScaleEventAt: "2026-06-15T10:00:06.000Z",
							lastScaleEventId: "actuation_01",
							maxReplicas: 5,
							metricFreshness: { ms: 15000, state: "observed" },
							minReplicas: 1,
							observedAt: "2026-06-15T10:00:08.000Z",
							projectedAt: "2026-06-15T10:00:09.000Z",
							reason: "hpa desired replicas above current replicas",
							scalerKind: "keda_temporal",
							scalerStatus: "healthy",
							taskQueue: "campus-agent.activity.agent",
							taskQueueKind: "activity",
							targetService: "activity-worker-agent",
						},
					],
				}),
			});
			const app = createApp(internalEnv, {
				operatorQueryService: service,
			});

			const response = await app.fetch(
				new Request(
					"https://app-api.internal/api/internal/operator/runtime/autoscaler/postures?targetService=activity-worker-agent&scalerStatus=healthy",
					{ headers: { "x-app-internal-auth": "trusted-secret" } },
				),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				page: { nextCursor: null },
				postures: [
					{
						currentReplicas: 1,
						desiredReplicas: 2,
						evidence: {
							hpaName: "keda-hpa-activity-worker-agent",
							kedaScaledObject: "activity-worker-agent",
						},
						lastScaleEventAt: "2026-06-15T10:00:06.000Z",
						lastScaleEventId: "actuation_01",
						maxReplicas: 5,
						metricFreshness: { ms: 15000, state: "observed" },
						minReplicas: 1,
						observedAt: "2026-06-15T10:00:08.000Z",
						projectedAt: "2026-06-15T10:00:09.000Z",
						reason: "hpa desired replicas above current replicas",
						scalerKind: "keda_temporal",
						scalerStatus: "healthy",
						taskQueue: "campus-agent.activity.agent",
						taskQueueKind: "activity",
						targetService: "activity-worker-agent",
					},
				],
			});
			expect(service.listAutoscalerPostures).toHaveBeenCalledWith({
				filters: {
					cursor: null,
					limit: null,
					scalerStatus: "healthy",
					targetService: "activity-worker-agent",
				},
				principal: internalRuntimePrincipal,
			});
		});
	});
}
