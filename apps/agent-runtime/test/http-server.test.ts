import { describe, expect, it, vi } from "vitest";
import type {
	AgentRunnerResult,
	AgentRuntimeLimits,
	SolveWorkflowOperationInput,
	SynthesizeWorkflowOperationInput,
	TaskPlan,
	TaskPlanStep,
	ToolExecutionResult,
	WorkflowEvidence,
	WorkflowOperationInput,
	WorkflowOperationResult,
	WorkflowOperationRuntime,
	WorkflowOperationStreamEvent,
} from "../src/agent-run-contract.ts";
import { createAgentRuntimeHandler as createAgentRuntimeHandlerBase } from "../src/http-server.ts";
import type { ModelConfigClientOptions } from "../src/model-config-client.ts";
import type { ToolCatalog } from "../src/tool-catalog.ts";
import { createWorkflowOperationRuntime } from "../src/workflow-runtime.ts";
import { testToolContractFingerprint } from "./helpers/runtime-contract.ts";

const targetSHA256 = "5b2e4a65688738d87e396008d0d331b53e13a9dc53a7c89c7391b0d5440b5b70";
const fingerprint = testToolContractFingerprint();

const catalog: ToolCatalog = {
	contractFingerprint: fingerprint,
	registryVersion: "test",
	schemaVersion: "tool-registry-v7",
	tools: [],
};

const campusStep: TaskPlanStep = {
	id: "step.campus",
	objective: "查找校园通知",
	candidateSources: ["campus_search"],
	dependsOn: [],
};
const plan: TaskPlan = {
	schemaVersion: "task_plan.v1",
	goal: "查询校园通知",
	steps: [campusStep],
};
const evidence: WorkflowEvidence = {
	schemaVersion: "workflow_evidence.v1",
	id: "campus:notice-1",
	source: "campus_search",
	title: "校园通知",
	excerpt: "通知正文",
	citationIndex: 1,
	noticeId: "notice-1",
	citationHref: "/notices/notice-1",
	sectionTitle: "正文",
};

describe("agent runtime HTTP handler", () => {
	it("rejects oversized completion JSON and invalidates streamed drafts", async () => {
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: {
				async run(input) {
					return resultFor(input, { finalOutput: "😀".repeat(262144) });
				},
				async *stream(input) {
					yield { event: "answer_delta", data: { delta: "draft", provisional: true } };
					yield {
						event: "completed",
						data: resultFor(input, { finalOutput: "😀".repeat(262144) }),
					};
				},
			},
		});
		const response = await post(handler, validBody("synthesize"));
		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({
			error: { code: "workflow_operation_payload_too_large" },
		});
		const streamed = await post(
			handler,
			validBody("synthesize"),
			"/internal/agent-requests/stream",
		);
		const events = parseSseEvents(await streamed.text());
		expect(events.map((event) => event.event)).toEqual([
			"answer_delta",
			"answer_invalidated",
			"error",
		]);
		expect(events.at(-1)?.data.code).toBe("workflow_operation_payload_too_large");
	});

	it("serves health and readiness endpoints with their intended authorization boundary", async () => {
		const handler = createAgentRuntimeHandler({ runtime: runtimeFor(), sharedSecret: "secret" });

		expect((await handler(new Request("http://agent-runtime/healthz"))).status).toBe(200);
		expect(await (await handler(new Request("http://agent-runtime/healthz"))).json()).toEqual({
			status: "ok",
		});
		expect((await handler(new Request("http://agent-runtime/readyz"))).status).toBe(200);
		expect(
			await createAgentRuntimeHandler({ runtime: runtimeFor(), sharedSecret: "" })(
				new Request("http://agent-runtime/readyz"),
			),
		).toHaveProperty("status", 503);
		expect((await handler(new Request("http://agent-runtime/internal/readyz"))).status).toBe(401);
		expect(
			(
				await handler(
					new Request("http://agent-runtime/internal/readyz", {
						headers: { authorization: "Bearer secret" },
					}),
				)
			).status,
		).toBe(200);
	});

	it("rejects missing worker authorization before parsing the workflow body", async () => {
		const handler = createAgentRuntimeHandler({ runtime: runtimeFor(), sharedSecret: "secret" });
		const response = await handler(
			new Request("http://agent-runtime/internal/agent-requests", {
				method: "POST",
				body: JSON.stringify(validBody("solve")),
			}),
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
	});

	it("maps a solve request into the workflow operation contract and returns a structured plan", async () => {
		let observed: WorkflowOperationInput | undefined;
		const taskPlan: TaskPlan = {
			schemaVersion: "task_plan.v1",
			goal: "查询奖学金",
			steps: [campusStep],
		};
		const handler = createAgentRuntimeHandler({
			runtime: {
				async run(input) {
					observed = input;
					return resultFor(input, { solveOutcome: "plan", plan: taskPlan });
				},
				stream: streamFor(),
			},
			sharedSecret: "secret",
		});
		const body = validBody("solve");
		(body.operation_input as Record<string, unknown>).goal = taskPlan.goal;

		const response = await post(handler, body);

		expect(response.status).toBe(200);
		expect(observed?.operation).toBe("solve");
		expect(observed?.operationInput).toMatchObject({ goal: "查询奖学金", maxSteps: 2 });
		const responseBody = await response.json();
		expect(responseBody).not.toHaveProperty("prompt_trace");
		expect(responseBody).toMatchObject({
			operation: "solve",
			status: "completed",
			plan: {
				schema_version: "task_plan.v1",
				goal: "查询奖学金",
			},
		});
	});

	it("maps an execute-step request and preserves partial source failures in the result", async () => {
		let observed: WorkflowOperationInput | undefined;
		const failedTool: ToolExecutionResult = {
			status: "failed",
			result: { error: "source unavailable" },
			failure: {
				code: "source_unavailable",
				operation: "tool.campus_search",
			},
			toolName: "campus_search",
			invocationId: "call-1",
			argumentsJson: { search_query: "通知" },
			durationMs: 12,
			startedAt: "2026-09-06T10:00:00.000Z",
			completedAt: "2026-09-06T10:00:00.012Z",
		};
		const handler = createAgentRuntimeHandler({
			runtime: {
				async run(input) {
					observed = input;
					return resultFor(input, {
						finalOutput: "当前来源暂时不可用。",
						toolResults: [failedTool],
						sourceAttempts: [
							{ source: "campus_search", status: "failed", failureCode: "source_unavailable" },
						],
					});
				},
				stream: streamFor(),
			},
			sharedSecret: "secret",
		});

		const response = await post(handler, validBody("execute_step"));
		const body = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(200);
		expect(observed?.operation).toBe("execute_step");
		expect(observed?.operationInput).toMatchObject({
			step: { id: campusStep.id },
			citationStart: 1,
		});
		expect(body.final_output).toBe("当前来源暂时不可用。");
		expect(body.source_attempts).toEqual([
			{ source: "campus_search", status: "failed", failure_code: "source_unavailable" },
		]);
		expect((body.tool_results as unknown[])[0]).toMatchObject({
			failure: { code: "source_unavailable", operation: "tool.campus_search" },
			status: "failed",
			started_at: "2026-09-06T10:00:00.000Z",
			completed_at: "2026-09-06T10:00:00.012Z",
		});
	});

	it("streams only the final synthesize operation with the workflow SSE schema", async () => {
		const handler = createAgentRuntimeHandler({
			runtime: {
				async run() {
					throw new Error("blocking operation must not be used for stream");
				},
				stream: streamFor(true),
			},
			sharedSecret: "secret",
		});

		const response = await post(
			handler,
			validBody("synthesize"),
			"/internal/agent-requests/stream",
		);
		const events = parseSseEvents(await response.text());

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		expect(events.map((event) => event.event)).toEqual(["answer_delta", "completed"]);
		expect(events[0]?.data).toEqual({
			delta: "部分答案",
			schema_version: "workflow_runtime_answer_delta.v2",
			provisional: true,
		});
		expect(events[1]?.data).toMatchObject({
			operation: "synthesize",
			final_output: "最终答案。",
			status: "completed",
		});
	});

	it("streams a solve answer decision before answer text and completion", async () => {
		const answer = "中央民族大学。";
		const handler = createAgentRuntimeHandler({
			runtime: {
				async run() {
					throw new Error("blocking operation must not be used for stream");
				},
				async *stream(input: SolveWorkflowOperationInput | SynthesizeWorkflowOperationInput) {
					yield { event: "solve_decision", data: { outcome: "answer" } };
					yield { event: "answer_delta", data: { delta: answer, provisional: true } };
					yield {
						event: "completed",
						data: resultFor(input, { finalOutput: answer, solveOutcome: "answer" }),
					};
				},
			},
			sharedSecret: "secret",
		});

		const response = await post(handler, validBody("solve"), "/internal/agent-requests/stream");
		const events = parseSseEvents(await response.text());

		expect(response.status).toBe(200);
		expect(events.map((event) => event.event)).toEqual([
			"solve_decision",
			"answer_delta",
			"completed",
		]);
		expect(events[0]?.data).toEqual({
			outcome: "answer",
			schema_version: "workflow_runtime_solve_decision.v1",
		});
		expect(events[1]?.data).toEqual({
			delta: answer,
			schema_version: "workflow_runtime_answer_delta.v2",
			provisional: true,
		});
		expect(events[2]?.data).toMatchObject({
			final_output: answer,
			operation: "solve",
			solve_outcome: "answer",
			status: "completed",
		});
	});

	it("streams a solve plan decision without answer text", async () => {
		const taskPlan: TaskPlan = {
			schemaVersion: "task_plan.v1",
			goal: "查询奖学金",
			steps: [campusStep],
		};
		const handler = createAgentRuntimeHandler({
			runtime: {
				async run() {
					throw new Error("blocking operation must not be used for stream");
				},
				async *stream(input: SolveWorkflowOperationInput | SynthesizeWorkflowOperationInput) {
					yield { event: "solve_decision", data: { outcome: "plan" } };
					yield {
						event: "completed",
						data: resultFor(input, { solveOutcome: "plan", plan: taskPlan }),
					};
				},
			},
			sharedSecret: "secret",
		});

		const response = await post(handler, validBody("solve"), "/internal/agent-requests/stream");
		const events = parseSseEvents(await response.text());

		expect(response.status).toBe(200);
		expect(events.map((event) => event.event)).toEqual(["solve_decision", "completed"]);
		expect(events.some((event) => event.event === "answer_delta")).toBe(false);
		expect(events[0]?.data).toEqual({
			outcome: "plan",
			schema_version: "workflow_runtime_solve_decision.v1",
		});
		expect(events[1]?.data).toMatchObject({
			operation: "solve",
			solve_outcome: "plan",
			status: "completed",
			plan: { schema_version: "task_plan.v1" },
		});
	});

	it("returns an SSE error for solve answer text emitted before its decision", async () => {
		const runtime = createWorkflowOperationRuntime({
			catalog,
			runner: async () => {
				throw new Error("blocking runner must not be used");
			},
			streamingRunner: async function* () {
				yield { delta: "过早的答案片段" };
			},
		});
		const handler = createAgentRuntimeHandler({ runtime, sharedSecret: "secret" });

		const response = await post(handler, validBody("solve"), "/internal/agent-requests/stream");
		const events = parseSseEvents(await response.text());

		expect(response.status).toBe(200);
		expect(events.map((event) => event.event)).toEqual(["error"]);
		expect(events[0]?.data).toMatchObject({ code: "run_failed", operation: "workflow.solve" });
	});

	it("returns an SSE error when a solve decision disagrees with completion", async () => {
		const taskPlan: TaskPlan = {
			schemaVersion: "task_plan.v1",
			goal: "查询奖学金",
			steps: [campusStep],
		};
		const runtime = createWorkflowOperationRuntime({
			catalog,
			runner: async () => {
				throw new Error("blocking runner must not be used");
			},
			streamingRunner: async function* () {
				yield { solveOutcome: "answer" };
				yield agentRunnerResult({
					finalOutput: JSON.stringify({
						outcome: "plan",
						plan: taskPlan,
					}),
				});
			},
		});
		const handler = createAgentRuntimeHandler({ runtime, sharedSecret: "secret" });

		const response = await post(handler, validBody("solve"), "/internal/agent-requests/stream");
		const events = parseSseEvents(await response.text());

		expect(response.status).toBe(200);
		expect(events.map((event) => event.event)).toEqual(["solve_decision", "error"]);
		expect(events[1]?.data).toMatchObject({ code: "run_failed", operation: "workflow.solve" });
	});

	it("rejects streaming a non-synthesize operation at the HTTP boundary", async () => {
		const runtime = {
			run: vi.fn(async (input: WorkflowOperationInput) => resultFor(input)),
			stream: streamFor(),
		} satisfies WorkflowOperationRuntime;
		const handler = createAgentRuntimeHandler({ runtime, sharedSecret: "secret" });

		const response = await post(
			handler,
			validBody("execute_step"),
			"/internal/agent-requests/stream",
		);

		expect(response.status).toBe(400);
		expect(runtime.run).not.toHaveBeenCalled();
		expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
	});

	it("rejects legacy inline provider and single-turn input fields", async () => {
		const handler = createAgentRuntimeHandler({ runtime: runtimeFor(), sharedSecret: "secret" });
		for (const legacyField of [{ provider_config: {} }, { input: "你好" }]) {
			const response = await post(handler, { ...validBody("solve"), ...legacyField });
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({
				error: { code: "invalid_request", retryable: false },
			});
		}
	});

	it("rejects a current operation goal above its admitted character limit", async () => {
		const handler = createAgentRuntimeHandler({ runtime: runtimeFor(), sharedSecret: "secret" });
		const body = validBody("solve");
		body.limits = { ...validRuntimeLimits(), current_input_char_limit: 2 };
		(body.operation_input as Record<string, unknown>).goal = "超过限制";

		const response = await post(handler, body);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error: { code: "context_budget_exceeded", retryable: false },
		});
	});

	it("passes the request cancellation signal into the workflow runtime", async () => {
		const controller = new AbortController();
		let observedSignal: AbortSignal | undefined;
		const handler = createAgentRuntimeHandler({
			runtime: {
				async run(input) {
					observedSignal = input.signal;
					return resultFor(input);
				},
				stream: streamFor(),
			},
			sharedSecret: "secret",
		});

		const response = await post(handler, validBody("solve"), undefined, controller.signal);

		expect(response.status).toBe(200);
		expect(observedSignal?.aborted).toBe(false);
		controller.abort();
		expect(observedSignal?.aborted).toBe(true);
	});

	it("returns a sanitized diagnostic when the workflow runtime throws", async () => {
		const onRunError = vi.fn();
		const thrown = new Error("private provider response");
		const handler = createAgentRuntimeHandler({
			onRunError,
			runtime: {
				async run() {
					throw thrown;
				},
				stream: streamFor(),
			},
			sharedSecret: "secret",
		});

		const response = await post(handler, validBody("solve"));

		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({
			error: {
				code: "run_failed",
				message: "The agent runtime could not complete the request.",
				retryable: false,
			},
		});
		expect(onRunError).toHaveBeenCalledWith(thrown, {
			operation: "solve",
			requestId: "req-solve",
		});
	});

	it("classifies an operation deadline on the blocking route", async () => {
		const handler = createAgentRuntimeHandler({
			runtime: {
				async run(input) {
					await waitForAbort(input.signal);
					throw input.signal?.reason;
				},
				stream: streamFor(),
			},
			sharedSecret: "secret",
		});
		const body = validBody("solve");
		body.limits = { ...validRuntimeLimits(), agent_deadline_ms: 5 };

		const response = await post(handler, body);

		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({
			error: { code: "agent_deadline_exceeded", retryable: false },
		});
	});

	it("emits an SSE error when a stream ends without a completed event", async () => {
		const handler = createAgentRuntimeHandler({
			runtime: {
				async run() {
					throw new Error("blocking operation must not be used");
				},
				async *stream() {
					yield { event: "answer_delta", data: { delta: "partial", provisional: true } };
				},
			},
			sharedSecret: "secret",
		});

		const response = await post(
			handler,
			validBody("synthesize"),
			"/internal/agent-requests/stream",
		);
		const events = parseSseEvents(await response.text());

		expect(events).toEqual([
			{
				event: "answer_delta",
				data: {
					delta: "partial",
					schema_version: "workflow_runtime_answer_delta.v2",
					provisional: true,
				},
			},
			{
				event: "answer_invalidated",
				data: {
					reason: "terminal_result_unavailable",
					schema_version: "workflow_runtime_answer_invalidation.v1",
				},
			},
			{
				event: "error",
				data: {
					code: "run_failed",
					message: "The agent runtime could not complete the request.",
					operation: "agent.runtime",
					retryable: false,
					runtime_release: "test-release",
				},
			},
		]);
	});

	it("rejects tool contract drift before running the operation", async () => {
		let modelInvoked = false;
		const runtime = createWorkflowOperationRuntime({
			catalog,
			runner: async (): Promise<AgentRunnerResult> => {
				modelInvoked = true;
				return {
					finalOutput: "",
					providerResponseId: "resp",
					toolResults: [],
					webCitations: [],
					webSearchUsed: false,
					usage: { modelRequestCount: 1, inputTokens: 1, outputTokens: 1, usageObserved: true },
				};
			},
		});
		const handler = createAgentRuntimeHandler({
			runtime,
			sharedSecret: "secret",
		});
		const body = validBody("solve");
		body.expected_tool_contract_fingerprint = {
			...wireFingerprint(),
			tools_sha256: `sha256:${"0".repeat(64)}`,
		};

		const response = await post(handler, body);

		expect(response.status).toBe(409);
		expect(modelInvoked).toBe(false);
		expect(await response.json()).toMatchObject({ error: { code: "tool_contract_mismatch" } });
	});
});

function createAgentRuntimeHandler(
	options: Omit<
		Parameters<typeof createAgentRuntimeHandlerBase>[0],
		"modelConfig" | "runtimeRelease"
	> & {
		modelConfig?: ModelConfigClientOptions;
		runtimeRelease?: string;
	},
) {
	return createAgentRuntimeHandlerBase({
		...options,
		modelConfig: options.modelConfig ?? modelConfigClient(),
		runtimeRelease: options.runtimeRelease ?? "test-release",
	});
}

async function post(
	handler: ReturnType<typeof createAgentRuntimeHandler>,
	body: Record<string, unknown>,
	path = "/internal/agent-requests",
	signal?: AbortSignal,
): Promise<Response> {
	return handler(
		new Request(`http://agent-runtime${path}`, {
			body: JSON.stringify(body),
			headers: { authorization: "Bearer secret" },
			method: "POST",
			...(signal ? { signal } : {}),
		}),
	);
}

function runtimeFor(): WorkflowOperationRuntime {
	return {
		run: async (input) => resultFor(input),
		stream: streamFor(),
	};
}

function streamFor(includeDelta = false): WorkflowOperationRuntime["stream"] {
	return async function* (
		input: SynthesizeWorkflowOperationInput,
	): AsyncIterable<WorkflowOperationStreamEvent> {
		if (includeDelta) {
			yield { event: "answer_delta", data: { delta: "部分答案", provisional: true } };
		}
		yield { event: "completed", data: resultFor(input, { finalOutput: "最终答案。" }) };
	};
}

function resultFor(
	input: WorkflowOperationInput,
	overrides: Partial<WorkflowOperationResult> = {},
): WorkflowOperationResult {
	const base: WorkflowOperationResult = {
		status: "completed",
		operation: input.operation,
		requestId: input.requestId,
		contextUsage: { contextChars: 48, currentInputChars: 6, modelVisibleItemCount: 1 },
		finalOutput: input.operation === "solve" || input.operation === "replan" ? "" : "答案。",
		evidence: [],
		sourceAttempts: [],
		modelName: "gpt-5-mini",
		modelProvider: "openai",
		providerResponseId: "resp-test",
		stageTiming: { [`workflow.${input.operation}_ms`]: 2 },
		toolContractFingerprint: fingerprint,
		toolResults: [],
		webCitations: [],
		webSearchUsed: false,
		terminalReason: "operation_completed",
		usage: { modelRequestCount: 1, inputTokens: 1, outputTokens: 1, usageObserved: true },
	};
	return { ...base, ...overrides };
}

function agentRunnerResult(overrides: Partial<AgentRunnerResult> = {}): AgentRunnerResult {
	return {
		finalOutput: "",
		providerResponseId: "resp-test",
		toolResults: [],
		webCitations: [],
		webSearchUsed: false,
		usage: { modelRequestCount: 1, inputTokens: 1, outputTokens: 1, usageObserved: true },
		...overrides,
	};
}

function validBody(
	operation: "solve" | "execute_step" | "replan" | "synthesize",
): Record<string, unknown> {
	const common = {
		activity_attempt: 1,
		user_id: "user-1",
		request_id: `req-${operation}`,
		conversation_id: "conversation-1",
		visible_function_tool_names: ["campus_search"],
		expected_tool_contract_fingerprint: wireFingerprint(),
		expected_model_target_sha256: targetSHA256,
		limits: validRuntimeLimits(),
	};
	if (operation === "solve") {
		return { ...common, operation, operation_input: { goal: "查询校园通知", max_steps: 2 } };
	}
	if (operation === "execute_step") {
		return {
			...common,
			operation,
			operation_input: {
				goal: plan.goal,
				plan: planWire(plan),
				step: taskPlanStepWire(campusStep),
				completed_steps: [],
				citation_start: 1,
			},
		};
	}
	if (operation === "replan") {
		return {
			...common,
			operation,
			operation_input: {
				goal: plan.goal,
				plan: planWire(plan),
				completed_steps: [],
				remaining_steps: [taskPlanStepWire(campusStep)],
				max_remaining_steps: 2,
			},
		};
	}
	return {
		...common,
		operation,
		operation_input: {
			goal: plan.goal,
			source_attempts: [],
			remaining_facts: [],
			evidence: [evidenceWire(evidence)],
			answer_mode: "grounded",
		},
	};
}

function validRuntimeLimits(): AgentRuntimeLimits & Record<string, number> {
	return {
		agent_deadline_ms: 90_000,
		context_char_limit: 16_000,
		current_input_char_limit: 8_000,
		max_output_tokens: 2_048,
		max_function_tool_calls: 3,
		max_turns: 6,
		max_plan_steps: 8,
		max_replans: 2,
	} as unknown as AgentRuntimeLimits & Record<string, number>;
}

function planWire(value: TaskPlan) {
	return {
		schema_version: value.schemaVersion,
		goal: value.goal,
		steps: value.steps.map(taskPlanStepWire),
	};
}

function taskPlanStepWire(value: TaskPlanStep) {
	return {
		id: value.id,
		objective: value.objective,
		candidate_sources: value.candidateSources,
		depends_on: value.dependsOn,
	};
}

function evidenceWire(value: WorkflowEvidence) {
	return {
		schema_version: value.schemaVersion,
		id: value.id,
		source: value.source,
		title: value.title,
		excerpt: value.excerpt,
		...(value.citationIndex === undefined ? {} : { citation_index: value.citationIndex }),
		...(value.noticeId === undefined ? {} : { notice_id: value.noticeId }),
		...(value.citationHref === undefined ? {} : { citation_href: value.citationHref }),
		...(value.sectionTitle === undefined ? {} : { section_title: value.sectionTitle }),
		...(value.rootUnitIds === undefined ? {} : { root_unit_ids: value.rootUnitIds }),
	};
}

function wireFingerprint() {
	return {
		function_schema_sha256: fingerprint.functionSchemaSha256,
		schema_version: fingerprint.schemaVersion,
		tools_sha256: fingerprint.toolsSha256,
	};
}

function modelConfigClient(): ModelConfigClientOptions {
	return {
		baseUrl: "http://model-config",
		fetchImplementation: async () =>
			Response.json({
				api_key: "provider-key",
				api_protocol: "openai.responses",
				base_url: "https://api.openai.com/v1",
				model: "gpt-5-mini",
				name: "primary_agent",
				provider: "openai",
				schema_version: "model_runtime_config.v1",
				target_sha256: targetSHA256,
			}),
	};
}

function parseSseEvents(body: string): { event: string; data: Record<string, unknown> }[] {
	return body
		.split("\n\n")
		.map((block) => block.trim())
		.filter((block) => block && !block.startsWith(":"))
		.map((block) => {
			const eventLine = block.split("\n").find((line) => line.startsWith("event: "));
			const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
			if (!(eventLine && dataLine)) {
				throw new Error(`Invalid SSE block: ${block}`);
			}
			return {
				event: eventLine.slice("event: ".length),
				data: JSON.parse(dataLine.slice("data: ".length)) as Record<string, unknown>,
			};
		});
}

function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
	if (!signal) {
		return Promise.reject(new Error("workflow runtime signal is required"));
	}
	if (signal.aborted) {
		return Promise.resolve();
	}
	return new Promise((resolve) =>
		signal.addEventListener("abort", () => resolve(), { once: true }),
	);
}
