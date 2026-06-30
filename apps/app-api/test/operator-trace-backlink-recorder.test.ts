// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { buildOperatorTraceBacklinkRecorder } from "../src/modules/operator-observability-command";

describe("operator trace backlink recorder", () => {
	it("projects configured trace and issue deep links through the app-owned command seam", async () => {
		const commandService = {
			ingestExecutionAuditEvents: vi.fn(),
			ingestGrades: vi.fn(),
			ingestTemporalTaskQueueSnapshots: vi.fn(),
			ingestTraceBacklinks: vi.fn().mockResolvedValue({ accepted: 1 }),
		};
		const recorder = buildOperatorTraceBacklinkRecorder({
			env: {
				APP_API_OPERATOR_ISSUE_LINK_TEMPLATE:
					"https://axiom.example/query?request={requestId}&error={errorCode}",
				APP_API_OPERATOR_TRACE_LINK_TEMPLATE: "https://sentry.example/traces/{traceId}",
			},
			resolveCommandService: () => commandService,
		});

		await recorder.record({
			errorCode: "execution_timeout",
			requestId: "req_01HQ",
			selectedTool: "knowledge_query",
			surface: "campus_web",
			traceId: "trace_01HQ",
		});

		expect(commandService.ingestTraceBacklinks).toHaveBeenCalledWith({
			payload: {
				backlinks: [
					{
						issueFingerprint: "execution_timeout:knowledge",
						issueLink: "https://axiom.example/query?request=req_01HQ&error=execution_timeout",
						requestId: "req_01HQ",
						traceId: "trace_01HQ",
						traceLink: "https://sentry.example/traces/trace_01HQ",
					},
				],
			},
		});
	});

	it("records a safe error fingerprint without requiring a sink query link", async () => {
		const commandService = {
			ingestExecutionAuditEvents: vi.fn(),
			ingestGrades: vi.fn(),
			ingestTemporalTaskQueueSnapshots: vi.fn(),
			ingestTraceBacklinks: vi.fn().mockResolvedValue({ accepted: 1 }),
		};
		const recorder = buildOperatorTraceBacklinkRecorder({
			env: {},
			resolveCommandService: () => commandService,
		});

		await recorder.record({
			errorCode: "activity_failed",
			requestId: "req_01HQ",
			selectedTool: null,
			surface: "app_api",
			traceId: "trace_01HQ",
		});

		expect(commandService.ingestTraceBacklinks).toHaveBeenCalledWith({
			payload: {
				backlinks: [
					{
						issueFingerprint: "activity_failed:app_api",
						issueLink: null,
						requestId: "req_01HQ",
						traceId: "trace_01HQ",
						traceLink: null,
					},
				],
			},
		});
	});

	it("does not block the request path on invalid templates or command write failures", async () => {
		const logger = { warn: vi.fn() };
		const commandService = {
			ingestExecutionAuditEvents: vi.fn(),
			ingestGrades: vi.fn(),
			ingestTemporalTaskQueueSnapshots: vi.fn(),
			ingestTraceBacklinks: vi.fn().mockRejectedValue(new Error("database unavailable")),
		};
		const recorder = buildOperatorTraceBacklinkRecorder({
			env: {
				APP_API_OPERATOR_TRACE_LINK_TEMPLATE: "javascript:alert({traceId})",
			},
			logger,
			resolveCommandService: () => commandService,
		});

		await expect(
			recorder.record({
				requestId: "req_01HQ",
				surface: "campus_web",
				traceId: "trace_01HQ",
			}),
		).resolves.toBeUndefined();
		expect(commandService.ingestTraceBacklinks).not.toHaveBeenCalled();

		await expect(
			recorder.record({
				errorCode: "internal_error",
				requestId: "req_01HQ",
				surface: "campus_web",
				traceId: "trace_01HQ",
			}),
		).resolves.toBeUndefined();
		expect(logger.warn).toHaveBeenCalledWith(
			"Operator trace backlink projection failed: database unavailable",
		);
	});
});
