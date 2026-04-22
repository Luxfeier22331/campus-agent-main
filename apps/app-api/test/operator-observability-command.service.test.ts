// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { buildOperatorObservabilityCommandService } from "../src/modules/operator-observability-command/service";

describe("operator observability command service", () => {
	it("upserts sampled grades before emitting the stable sink event", async () => {
		const store = {
			getRequestObservabilitySeed: vi.fn().mockResolvedValue({
				collection: "student_handbook",
				modelName: "gpt-5.2-mini",
				principalType: "student",
				requestId: "req_01HQ",
				requestStartedAt: "2026-04-20T00:00:00.000Z",
				requestedCapability: "knowledge",
				requestedScopeSummary: "regulations/student_handbook",
				selectedTarget: "rag-agent",
				surface: "public_chat_web",
				traceId: "trace_01HQ",
			}),
			upsertQualityGrades: vi.fn().mockResolvedValue(undefined),
			upsertTraceBacklinks: vi.fn().mockResolvedValue(undefined),
		};
		const telemetry = {
			recordQualitySampledGrade: vi.fn().mockResolvedValue(undefined),
		};
		const service = buildOperatorObservabilityCommandService({
			now: () => new Date("2026-04-20T00:20:00.000Z"),
			store,
			telemetry,
		});

		await expect(
			service.ingestGrades({
				payload: {
					grades: [
						{
							gradeDomain: "grounding",
							gradeSource: "openai_trace_grader",
							graderVersion: "grader@2026-04-20",
							rationaleSummary: "grounded to cited handbook passages",
							requestId: "req_01HQ",
							sampledAt: "2026-04-20T00:10:00.000Z",
							score: 0.913,
							traceId: "trace_01HQ",
							verdict: "pass",
						},
					],
				},
			}),
		).resolves.toEqual({ accepted: 1 });

		expect(store.upsertQualityGrades).toHaveBeenCalledWith({
			grades: [
				expect.objectContaining({
					collection: "student_handbook",
					gradeDomain: "grounding",
					gradeId: "req_01HQ:openai_trace_grader:grounding",
					gradeSource: "openai_trace_grader",
					graderVersion: "grader@2026-04-20",
					modelName: "gpt-5.2-mini",
					principalType: "student",
					projectedAt: "2026-04-20T00:20:00.000Z",
					rationaleSummary: "grounded to cited handbook passages",
					requestId: "req_01HQ",
					requestStartedAt: "2026-04-20T00:00:00.000Z",
					requestedCapability: "knowledge",
					sampledAt: "2026-04-20T00:10:00.000Z",
					scoreMilli: 913,
					selectedTarget: "rag-agent",
					surface: "public_chat_web",
					traceId: "trace_01HQ",
					verdict: "pass",
				}),
			],
		});
		expect(telemetry.recordQualitySampledGrade).toHaveBeenCalledWith({
			collection: "student_handbook",
			gradeDomain: "grounding",
			gradeId: "req_01HQ:openai_trace_grader:grounding",
			gradeSource: "openai_trace_grader",
			graderVersion: "grader@2026-04-20",
			modelName: "gpt-5.2-mini",
			principalType: "student",
			rationaleSummary: "grounded to cited handbook passages",
			requestId: "req_01HQ",
			requestStartedAt: "2026-04-20T00:00:00.000Z",
			requestedCapability: "knowledge",
			requestedScopeSummary: "regulations/student_handbook",
			sampledAt: "2026-04-20T00:10:00.000Z",
			scoreMilli: 913,
			selectedTarget: "rag-agent",
			surface: "public_chat_web",
			traceId: "trace_01HQ",
			verdict: "pass",
		});
		expect(store.upsertQualityGrades.mock.invocationCallOrder[0]).toBeLessThan(
			telemetry.recordQualitySampledGrade.mock.invocationCallOrder[0],
		);
	});
});
