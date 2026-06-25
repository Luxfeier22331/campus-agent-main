// @vitest-environment node

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChatDurableE2eResult } from "../scripts/chat-durable-e2e-staging";
import {
	type OnlineAnswerPathCaseFile,
	runOnlineAnswerPathStagingCollector,
} from "../scripts/online-answer-path-staging-collector";

function completedChatResult(input: {
	requestId: string;
	runId: string;
	selectedCapability: string;
	traceId: string;
}): ChatDurableE2eResult {
	return {
		agentRuntimeEvalProjection: {
			schema_version: "agent_runtime_eval_projection.v1",
			run: {
				status: "completed",
			},
			trajectory: {
				direct_answer: false,
				requires_clarification: false,
				selected_capability: input.selectedCapability,
			},
		},
		conversation: {
			assistantAnswerText: "已完成回答。",
			assistantMessageCount: 1,
			hasAssistantMessageForRequest: true,
			id: "conv_01",
			messageCount: 2,
		},
		identity: {
			email: "eval@example.edu",
			resetViaDeployedRuntime: true,
		},
		langfuseCloseout: {
			productTraceId: input.traceId,
			requestId: input.requestId,
			runId: input.runId,
			sessionId: "conv_01",
			userId: "user_eval",
			workflowId: "workflow_01",
		},
		passed: true,
		principal: null,
		readyz: {
			appApi: { payload: { ok: true }, status: 200 },
			chat: { payload: { ok: true }, status: 200 },
		},
		resume: {
			afterSequence: 0,
			events: [
				{
					event: "execution.running",
					occurredAt: "2026-06-04T00:00:01.000Z",
					requestId: input.requestId,
					runId: input.runId,
					sequence: 2,
					status: "running",
					traceId: input.traceId,
				},
				{
					event: "request.completed",
					occurredAt: "2026-06-04T00:00:02.000Z",
					requestId: input.requestId,
					runId: input.runId,
					sequence: 3,
					status: "completed",
					traceId: input.traceId,
				},
			],
			terminalEvent: {
				event: "request.completed",
				occurredAt: "2026-06-04T00:00:02.000Z",
				requestId: input.requestId,
				runId: input.runId,
				sequence: 3,
				status: "completed",
				traceId: input.traceId,
			},
		},
		run: {
			conversationId: "conv_01",
			requestId: input.requestId,
			runId: input.runId,
			status: "completed",
			traceId: input.traceId,
		},
		runtimeStepResults: [],
		session: null,
		sessionMintAttempted: true,
		submit: {
			requestId: input.requestId,
			runId: input.runId,
			traceId: input.traceId,
		},
		submitStreamAbortedAfterAccepted: true,
		workflow: {
			attemptCount: 1,
			workflowId: "workflow_01",
		},
		workflowTraceSummary: {
			selected_capability: "campus_services",
			trace_steps: [
				{ status: "completed", step_id: "memory.recall" },
				{
					selected_capability: "campus_services",
					status: "completed",
					step_id: "agent.primary",
				},
				{ status: "completed", step_id: "finalization.write" },
			],
		},
	};
}

function caseFile(): OnlineAnswerPathCaseFile {
	return {
		cases: [
			{
				case_id: "main-institutional-campus-network-password",
				domain: "institutional_rules",
				expected: {
					answer_contract: {
						answer_text_present: true,
						citations_present: true,
					},
					selected_capability: "knowledge",
					source_truth: {
						evidence_required: true,
						expected_collections: ["regulations/institutional_rules"],
					},
					terminal_outcome: "completed",
					trace_contract: {
						forbidden_stages: ["legacy_python_cli"],
						required_stages: ["memory.recall", "agent.primary", "finalization.write"],
					},
				},
				split: "release_gate",
				user_utterance: "校园网密码怎么改？",
			},
			{
				case_id: "main-fail-closed-no-source",
				domain: "ambiguity",
				expected: {
					answer_contract: {
						answer_text_present: true,
						must_explain_missing_evidence: true,
					},
					selected_capability: "knowledge",
					source_truth: {
						evidence_required: false,
						expected_collections: ["official_web/fresh_news"],
					},
					terminal_outcome: "fail_closed",
					trace_contract: {
						forbidden_stages: ["legacy_python_cli"],
						required_stages: ["memory.recall", "agent.primary", "finalization.write"],
					},
				},
				split: "fail_closed",
				user_utterance: "学校明年会不会新增量子语言学专业？",
			},
		],
		case_family: "online_answer_main_path.v1",
		schema_version: 1,
	};
}

describe("online answer path staging collector", () => {
	it("writes sanitized main-path observations from real durable chat results", async () => {
		const tmp = mkdtempSync(resolve(tmpdir(), "online-answer-path-collector-"));
		const outputPath = resolve(tmp, "observations.json");
		try {
			const prompts: string[] = [];
			const result = await runOnlineAnswerPathStagingCollector([], {
				caseFile: caseFile(),
				env: { APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret" } as NodeJS.ProcessEnv,
				outputPath,
				runChatDurableE2eStaging: async (argv) => {
					const prompt = argv[argv.indexOf("--prompt") + 1];
					prompts.push(prompt);
					return completedChatResult({
						requestId: prompt.includes("校园网") ? "req_network" : "req_no_source",
						runId: prompt.includes("校园网") ? "run_network" : "run_no_source",
						selectedCapability: "knowledge",
						traceId: prompt.includes("校园网") ? "trace_network" : "trace_no_source",
					});
				},
			});
			const payload = JSON.parse(readFileSync(outputPath, "utf8"));
			const serialized = JSON.stringify(payload);

			expect(result.passed).toBe(true);
			expect(payload.schema_version).toBe("online_answer_path_observations.v1");
			expect(payload.case_family).toBe("online_answer_main_path.v1");
			expect(payload.observations).toHaveLength(1);
			expect(prompts).toEqual(["校园网密码怎么改？"]);
			expect(payload.observations[0]).toMatchObject({
				case_id: "main-institutional-campus-network-password",
				request_id: "req_network",
				selected_capability: "knowledge",
				semantic_outcome: "answered",
				terminal_status: "completed",
				trace_id: "trace_network",
			});
			expect(payload.observations[0].workflow_trace_summary.trace_steps).toEqual([
				{ status: "completed", step_id: "memory.recall" },
				{
					selected_capability: "campus_services",
					status: "completed",
					step_id: "agent.primary",
				},
				{ status: "completed", step_id: "finalization.write" },
			]);
			expect(serialized).not.toContain("user_utterance");
			expect(serialized).not.toContain("校园网密码怎么改");
			expect(serialized).not.toContain("rawTranscript");
			expect(serialized).not.toContain("providerRaw");
		} finally {
			rmSync(tmp, { force: true, recursive: true });
		}
	});

	it("rejects unsupported arguments", async () => {
		const tmp = mkdtempSync(resolve(tmpdir(), "online-answer-path-collector-"));
		const outputPath = resolve(tmp, "observations.json");
		try {
			await expect(
				runOnlineAnswerPathStagingCollector(["--unknown-flag"], {
					caseFile: caseFile(),
					env: { APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret" } as NodeJS.ProcessEnv,
					outputPath,
				}),
			).rejects.toThrow("Unknown argument: --unknown-flag");
		} finally {
			rmSync(tmp, { force: true, recursive: true });
		}
	});
});
