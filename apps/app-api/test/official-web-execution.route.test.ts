// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { OfficialWebExecutionStatusService } from "../src/modules/official-web-execution";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_INTERNAL_SHARED_SECRET: "app-api-internal-secret",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

describe("official web ingestion execution routes", () => {
	it("accepts trusted internal execution-status callbacks", async () => {
		const service: OfficialWebExecutionStatusService = {
			updateRunExecutionStatus: vi.fn().mockResolvedValue({
				run: {
					ingestionExecutionErrorCode: null,
					ingestionExecutionErrorMessage: null,
					ingestionExecutionRef: "owevt_completed_01HQ",
					ingestionExecutionStatus: "running",
					ingestionExecutionUpdatedAt: "2026-04-02T10:00:00.000Z",
					runId: "owrun_01HQ",
				},
			}),
		};
		const app = createApp(env, {
			officialWebExecutionStatusService: service,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/official-web/runs/owrun_01HQ/ingestion-execution",
				{
					body: JSON.stringify({
						executionRef: "owevt_completed_01HQ",
						status: "running",
						updatedAt: "2026-04-02T10:00:00.000Z",
					}),
					headers: {
						"content-type": "application/json",
						"x-app-internal-auth": "app-api-internal-secret",
					},
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			run: {
				ingestionExecutionErrorCode: null,
				ingestionExecutionErrorMessage: null,
				ingestionExecutionRef: "owevt_completed_01HQ",
				ingestionExecutionStatus: "running",
				ingestionExecutionUpdatedAt: "2026-04-02T10:00:00.000Z",
				runId: "owrun_01HQ",
			},
		});
		expect(service.updateRunExecutionStatus).toHaveBeenCalledWith({
			payload: {
				executionRef: "owevt_completed_01HQ",
				status: "running",
				updatedAt: "2026-04-02T10:00:00.000Z",
			},
			runId: "owrun_01HQ",
		});
	});

	it("accepts staged execution-status callbacks with promotion block details", async () => {
		const service: OfficialWebExecutionStatusService = {
			updateRunExecutionStatus: vi.fn().mockResolvedValue({
				run: {
					ingestionExecutionErrorCode: "promotion_blocked",
					ingestionExecutionErrorMessage:
						"promotion blocked by quality gates: minimum_promote_pages",
					ingestionExecutionRef: "owevt_completed_01HQ",
					ingestionExecutionStatus: "staged",
					ingestionExecutionUpdatedAt: "2026-04-02T10:10:00.000Z",
					runId: "owrun_01HQ",
				},
			}),
		};
		const app = createApp(env, {
			officialWebExecutionStatusService: service,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/official-web/runs/owrun_01HQ/ingestion-execution",
				{
					body: JSON.stringify({
						errorCode: "promotion_blocked",
						errorMessage: "promotion blocked by quality gates: minimum_promote_pages",
						executionRef: "owevt_completed_01HQ",
						status: "staged",
						updatedAt: "2026-04-02T10:10:00.000Z",
					}),
					headers: {
						"content-type": "application/json",
						"x-app-internal-auth": "app-api-internal-secret",
					},
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			run: {
				ingestionExecutionErrorCode: "promotion_blocked",
				ingestionExecutionErrorMessage: "promotion blocked by quality gates: minimum_promote_pages",
				ingestionExecutionRef: "owevt_completed_01HQ",
				ingestionExecutionStatus: "staged",
				ingestionExecutionUpdatedAt: "2026-04-02T10:10:00.000Z",
				runId: "owrun_01HQ",
			},
		});
		expect(service.updateRunExecutionStatus).toHaveBeenCalledWith({
			payload: {
				errorCode: "promotion_blocked",
				errorMessage: "promotion blocked by quality gates: minimum_promote_pages",
				executionRef: "owevt_completed_01HQ",
				status: "staged",
				updatedAt: "2026-04-02T10:10:00.000Z",
			},
			runId: "owrun_01HQ",
		});
	});

	it("fails closed when the internal shared secret is missing or invalid", async () => {
		const service: OfficialWebExecutionStatusService = {
			updateRunExecutionStatus: vi.fn(),
		};
		const app = createApp(env, {
			officialWebExecutionStatusService: service,
		});

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/internal/official-web/runs/owrun_01HQ/ingestion-execution",
				{
					body: JSON.stringify({
						status: "failed",
						updatedAt: "2026-04-02T10:05:00.000Z",
					}),
					headers: {
						"content-type": "application/json",
					},
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "internal_auth_required",
				details: null,
				message: "Trusted internal shared secret required.",
				requestId: null,
				retryable: false,
				traceId: null,
			},
		});
		expect(service.updateRunExecutionStatus).not.toHaveBeenCalled();
	});
});
