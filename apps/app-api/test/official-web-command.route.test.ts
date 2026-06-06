// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { AppApiRouteError } from "../src/http";
import type { OfficialWebCommandService } from "../src/modules/official-web-command";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN: "trusted-collector-token",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://hub.muc.wiki",
	PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
	EXECUTION_GATEWAY_BASE_URL: "https://execution-gateway.internal",
	EXECUTION_GATEWAY_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

describe("official web collector routes", () => {
	it("creates a crawl run through the collector command route", async () => {
		const service: OfficialWebCommandService = {
			finalize: vi.fn(),
			heartbeat: vi.fn(),
			start: vi.fn().mockResolvedValue({
				run: {
					heartbeatIntervalSeconds: 60,
					runId: "owrun_01HQ",
					siteId: "www_muc_edu_cn",
					startedAt: "2026-03-29T08:00:01.000Z",
					status: "accepted",
				},
			}),
		};
		const app = createApp(env, {
			officialWebCommandService: service,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/official-web/runs", {
				body: JSON.stringify({
					collectorVersion: "official-web-collector@0.1.0",
					configVersion: "git:abc1234",
					crawlPolicyVersion: "2026-03-29",
					hostSet: ["www.muc.edu.cn"],
					runIntent: "baseline",
					schedulerRunKey: "cron-2026-03-29T08:00:00.000Z",
					seedSet: ["https://www.muc.edu.cn/"],
					siteId: "www_muc_edu_cn",
					startedAt: "2026-03-29T08:00:01.000Z",
					triggerType: "scheduled",
				}),
				headers: {
					authorization: "Bearer trusted-collector-token",
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			run: {
				heartbeatIntervalSeconds: 60,
				runId: "owrun_01HQ",
				siteId: "www_muc_edu_cn",
				startedAt: "2026-03-29T08:00:01.000Z",
				status: "accepted",
			},
		});
		expect(service.start).toHaveBeenCalledWith({
			payload: {
				collectorVersion: "official-web-collector@0.1.0",
				configVersion: "git:abc1234",
				crawlPolicyVersion: "2026-03-29",
				hostSet: ["www.muc.edu.cn"],
				runIntent: "baseline",
				schedulerRunKey: "cron-2026-03-29T08:00:00.000Z",
				seedSet: ["https://www.muc.edu.cn/"],
				siteId: "www_muc_edu_cn",
				startedAt: "2026-03-29T08:00:01.000Z",
				triggerType: "scheduled",
			},
			principal: {
				kind: "service",
				serviceClass: "official_web_collector",
				serviceId: "official-web-collector",
			},
		});
	});

	it("fails closed when the collector credential is missing", async () => {
		const service: OfficialWebCommandService = {
			finalize: vi.fn(),
			heartbeat: vi.fn(),
			start: vi.fn(),
		};
		const app = createApp(env, {
			officialWebCommandService: service,
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/official-web/runs", {
				body: JSON.stringify({
					siteId: "www_muc_edu_cn",
				}),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "service_credential_required",
				details: null,
				message: "Collector service credential required.",
				requestId: null,
				retryable: false,
				traceId: null,
			},
		});
		expect(service.start).not.toHaveBeenCalled();
	});

	it("forwards heartbeat and finalize payloads to the command service", async () => {
		const service: OfficialWebCommandService = {
			finalize: vi.fn().mockResolvedValue({
				run: {
					finishedAt: "2026-03-29T08:17:32.000Z",
					ingestionDispatchStatus: "queued",
					runId: "owrun_01HQ",
					status: "completed",
				},
			}),
			heartbeat: vi.fn().mockResolvedValue({
				run: {
					lastHeartbeatAt: "2026-03-29T08:05:00.000Z",
					runId: "owrun_01HQ",
					status: "running",
				},
			}),
			start: vi.fn(),
		};
		const app = createApp(env, {
			officialWebCommandService: service,
		});

		const heartbeat = await app.fetch(
			new Request("https://app-api.internal/api/official-web/runs/owrun_01HQ/heartbeats", {
				body: JSON.stringify({
					counts: {
						artifactUploads: 6,
						failures: 4,
						pagesNormalized: 180,
						urlsDiscovered: 280,
						urlsFetched: 220,
					},
					observedAt: "2026-03-29T08:05:00.000Z",
					sequence: 3,
				}),
				headers: {
					authorization: "Bearer trusted-collector-token",
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);
		const finalize = await app.fetch(
			new Request("https://app-api.internal/api/official-web/runs/owrun_01HQ/finalize", {
				body: JSON.stringify({
					artifacts: [],
					finishedAt: "2026-03-29T08:17:32.000Z",
					summary: {
						failureCount: 0,
					},
					terminalStatus: "completed",
				}),
				headers: {
					authorization: "Bearer trusted-collector-token",
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(heartbeat.status).toBe(200);
		await expect(heartbeat.json()).resolves.toEqual({
			run: {
				lastHeartbeatAt: "2026-03-29T08:05:00.000Z",
				runId: "owrun_01HQ",
				status: "running",
			},
		});
		expect(finalize.status).toBe(200);
		await expect(finalize.json()).resolves.toEqual({
			run: {
				finishedAt: "2026-03-29T08:17:32.000Z",
				ingestionDispatchStatus: "queued",
				runId: "owrun_01HQ",
				status: "completed",
			},
		});
	});

	it("maps service-level command errors onto the shared error envelope", async () => {
		const app = createApp(env, {
			officialWebCommandService: {
				finalize: vi.fn(),
				heartbeat: vi.fn(),
				start: vi.fn().mockRejectedValue(
					new AppApiRouteError({
						code: "idempotency_conflict",
						message: "schedulerRunKey already exists with a different payload.",
						retryable: false,
						status: 409,
					}),
				),
			},
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/official-web/runs", {
				body: JSON.stringify({
					collectorVersion: "official-web-collector@0.1.0",
					configVersion: "git:changed",
					crawlPolicyVersion: "2026-03-29",
					hostSet: ["www.muc.edu.cn"],
					runIntent: "baseline",
					schedulerRunKey: "cron-2026-03-29T08:00:00.000Z",
					seedSet: ["https://www.muc.edu.cn/"],
					siteId: "www_muc_edu_cn",
					startedAt: "2026-03-29T08:00:01.000Z",
					triggerType: "scheduled",
				}),
				headers: {
					authorization: "Bearer trusted-collector-token",
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "idempotency_conflict",
				details: null,
				message: "schedulerRunKey already exists with a different payload.",
				requestId: null,
				retryable: false,
				traceId: null,
			},
		});
	});
});
