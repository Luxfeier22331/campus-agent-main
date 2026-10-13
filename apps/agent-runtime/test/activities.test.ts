import { ApiError } from "@google/genai";
import { MockActivityEnvironment } from "@temporalio/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentActivities } from "../src/activities.ts";
import { AgentControlClient, ControlHTTPError } from "../src/control-client.ts";
import * as gemini from "../src/gemini-runner.ts";
import type { StageDecision, TurnDecision } from "../src/temporal-contract.ts";
import { testToolContractFingerprint } from "./helpers/runtime-contract.ts";

const fingerprint = testToolContractFingerprint();
function fixture() {
	const deadline = new Date(Date.now() - 1000).toISOString();
	const stage = {
		input: {
			key: "solve.initial",
			operation: "solve",
			citationStart: 1,
			workflow: {
				deadline_at: deadline,
				admission_snapshot: {
					provider_config_sha256: "a".repeat(64),
					agent_budget: { max_plan_steps: 8 },
					agent_capabilities: { visible_function_tool_names: [], hosted_web_search: false },
				},
			},
		},
		preparedRef: "prepared",
		createdAt: deadline,
		startedAt: deadline,
		toolContext: { user_id: "user" },
		model: { provider: "openai", model: "test", transport: "chat_completions" },
		wire: {
			operation: "solve",
			operation_input: { goal: "hello", max_steps: 2 },
			activity_attempt: 1,
			user_id: "user",
			request_id: "run",
			conversation_id: "conversation",
			visible_function_tool_names: [],
			expected_model_target_sha256: "a".repeat(64),
			expected_tool_contract_fingerprint: {
				schema_version: fingerprint.schemaVersion,
				tools_sha256: fingerprint.toolsSha256,
				function_schema_sha256: fingerprint.functionSchemaSha256,
			},
			limits: {
				agent_deadline_ms: 1000,
				context_char_limit: 16000,
				current_input_char_limit: 8000,
				max_output_tokens: 2048,
				max_function_tool_calls: 3,
				max_turns: 6,
				max_plan_steps: 8,
				max_replans: 2,
			},
			deadline_at: deadline,
		},
	};
	const result = {
		finalOutput: "hello",
		structuredOutput: { outcome: "answer", answer: "hello" },
		providerResponseId: "response",
		toolResults: [],
		usage: { modelRequestCount: 1, inputTokens: 2, outputTokens: 3, usageObserved: true },
	};
	const turn = {
		state: { result, citation: 1, excludedRefs: [], reserved: 0, answerIndex: 0 },
		turn: { calls: [], result, continuation: { provider: "openai", items: [] } },
		completedAt: deadline,
		turnIndex: 0,
	};
	const rows = new Map<string, unknown>([
		["stage", stage],
		["turn", turn],
	]);
	const control = new AgentControlClient("http://control", "secret");
	const load = vi
		.spyOn(control, "load")
		.mockImplementation(async (_id, ref) => structuredClone(rows.get(ref)) as never);
	vi.spyOn(control, "maybeLoad").mockImplementation(
		async (_id, ref) => structuredClone(rows.get(ref)) as never,
	);
	vi.spyOn(control, "save").mockImplementation(async (_id, ref, payload) => {
		rows.set(ref, structuredClone(payload));
	});
	const call = vi.spyOn(control, "call").mockImplementation(async (action, input) => {
		if (action === "project") {
			rows.set("output", structuredClone(input.payload));
		}
		return { ref: "output" } as never;
	});
	const activities = createAgentActivities({
		control,
		catalog: {
			tools: [],
			contractFingerprint: fingerprint,
			registryVersion: "test",
			schemaVersion: "tool-registry-v7",
		},
		domains: { searchUrl: "", searchToken: "", memoryUrl: "", memorySecret: "" },
		modelConfigUrl: "http://model-config",
		release: "test",
	});
	return { activities, stage, turn, rows, call, load };
}
afterEach(() => vi.restoreAllMocks());
describe("real Agent activity completion", () => {
	it.each([0, 1, 2, "answer/started", "answer/delta"] as const)(
		"preserves the full result when delta attempt %s fails (0 means healthy)",
		async (failAt) => {
			const f = fixture();
			const deadline = new Date(Date.now() + 60000).toISOString();
			f.stage.input.workflow.deadline_at = deadline;
			f.stage.wire.deadline_at = deadline;
			f.stage.model = { provider: "google", model: "test", transport: "generate_content" };
			Object.assign(f.stage.wire, { model_answer_transport: "stream" });
			let deltaCalls = 0;
			f.call.mockImplementation(async (action) => {
				if (typeof failAt === "string" && action === failAt) {
					throw new ControlHTTPError(action, 422, {
						code: "invalid_answer_state",
						retryable: false,
					});
				}
				if (action === "answer/delta" && ++deltaCalls === failAt) {
					throw new TypeError("injected network failure");
				}
				return { disposition: "new" } as never;
			});
			vi.spyOn(globalThis, "fetch").mockResolvedValue(
				Response.json({
					schema_version: "model_runtime_config.v1",
					name: "primary_agent",
					provider: "google",
					api_protocol: "google.generate_content",
					api_key: "test",
					base_url: "https://provider.test",
					model: "test",
					target_sha256: "a".repeat(64),
				}),
			);
			const text = "😀中\n".repeat(400);
			vi.spyOn(gemini, "runGeminiModelTurn").mockImplementation(
				async (_input, _continuation, onDelta) => {
					if (!onDelta) {
						throw new Error("Missing streaming callback");
					}
					await onDelta(JSON.stringify({ result: { outcome: "answer", answer: text } }));
					return f.turn.turn as never;
				},
			);
			const env = new MockActivityEnvironment();
			if (typeof failAt === "string") {
				await expect(
					env.run(() => f.activities.modelTurn({ requestId: "run", stageRef: "stage", turn: 0 })),
				).rejects.toMatchObject({ type: "invalid_answer_state", nonRetryable: true });
				expect(f.call.mock.calls.some(([action]) => action === "invocation/complete")).toBe(false);
				if (failAt === "answer/started") {
					expect(deltaCalls).toBe(0);
				}
				return;
			}
			await env.run(() => f.activities.modelTurn({ requestId: "run", stageRef: "stage", turn: 0 }));
			const deltas = f.call.mock.calls
				.filter(([action]) => action === "answer/delta")
				.map(([, input]) => input as { answer_index: number; delta: string });
			if (failAt === 0) {
				expect(deltas.length).toBeGreaterThan(1);
				expect(deltas.map((d) => d.delta).join("")).toBe(text);
			} else {
				expect(deltas).toHaveLength(failAt);
			}
			expect(f.call.mock.calls.filter(([action]) => action === "answer/started")).toHaveLength(1);
			expect(gemini.runGeminiModelTurn).toHaveBeenCalledTimes(1);
			expect(f.rows.get("stage:turn:0")).toMatchObject({
				state: { result: { answerStarted: true, finalOutput: "hello" } },
				turn: { result: { finalOutput: "hello" } },
			});
			expect(f.call.mock.calls.some(([action]) => action === "invocation/complete")).toBe(true);
			expect(deltas.map((d) => d.answer_index)).toEqual(deltas.map((_, i) => i + 1));
			expect(deltas.every((d) => Array.from(d.delta).length <= 512)).toBe(true);
		},
	);

	it("persists and logs provider diagnostics in the model receipt", async () => {
		const f = fixture();
		const deadline = new Date(Date.now() + 60_000).toISOString();
		f.stage.input.workflow.deadline_at = deadline;
		f.stage.wire.deadline_at = deadline;
		f.stage.model = { provider: "google", model: "test", transport: "generate_content" };
		f.call.mockResolvedValue({ disposition: "new" });
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json({
				schema_version: "model_runtime_config.v1",
				name: "primary_agent",
				provider: "google",
				api_protocol: "google.generate_content",
				api_key: "test",
				base_url: "https://provider.test",
				model: "test",
				target_sha256: "a".repeat(64),
			}),
		);
		vi.spyOn(gemini, "runGeminiModelTurn").mockRejectedValue(
			new ApiError({ status: 400, message: "rejected" }),
		);
		const log = vi.fn();
		const env = new MockActivityEnvironment(
			{},
			{
				logger: {
					warn: log,
					trace: vi.fn(),
					debug: vi.fn(),
					info: vi.fn(),
					error: vi.fn(),
					log: vi.fn(),
				},
			},
		);
		await env.run(() => f.activities.modelTurn({ requestId: "run", stageRef: "stage", turn: 0 }));
		expect(f.rows.get("stage:turn:0")).toMatchObject({
			turn: {
				result: {
					failure: {
						code: "run_failed",
						httpStatus: 400,
						detail: "ApiError: HTTP 400",
						invocationId: "run:solve.initial:model:0",
					},
				},
			},
		});
		expect(log).toHaveBeenCalledWith(
			"Model invocation failed",
			expect.objectContaining({ error_http_status: 400, request_id: "run" }),
		);
	});

	it.each([false, true])(
		"projects persisted output after deadline without Model Config (failed=%s)",
		async (failed) => {
			const f = fixture();
			if (failed) {
				Object.assign(f.turn.state.result, {
					failure: { code: "agent_deadline_exceeded", operation: "workflow.solve" },
				});
			}
			const fetch = vi
				.spyOn(globalThis, "fetch")
				.mockRejectedValue(new Error("Model Config offline"));
			const env = new MockActivityEnvironment();
			const out = (await env.run(() =>
				f.activities.completeStage({ requestId: "run", stageRef: "stage", turnRef: "turn" }),
			)) as StageDecision;
			expect(out.status).toBe(failed ? "failed" : "completed");
			expect(fetch).not.toHaveBeenCalled();
			expect(f.call).toHaveBeenCalledWith(
				"project",
				expect.objectContaining({ completed_at: f.turn.completedAt }),
			);
			await env.run(() =>
				f.activities.completeStage({ requestId: "run", stageRef: "stage", turnRef: "turn" }),
			);
			expect(f.call).toHaveBeenCalledTimes(1);
		},
	);
	it("owns the decision and does not load Control output or complete a buffered answer twice", async () => {
		const f = fixture();
		f.call.mockImplementation(async (action, input) => {
			if (action === "project") {
				rowsFromProjection(input);
			}
			return { ref: "output" } as never;
		});
		function rowsFromProjection(input: Record<string, unknown>) {
			f.rows.set("output", { ...(input.payload as object), answer_started: true });
		}
		const out = await new MockActivityEnvironment().run(() =>
			f.activities.completeStage({ requestId: "run", stageRef: "stage", turnRef: "turn" }),
		);
		expect(out).toMatchObject({ answerStarted: true });
		expect(f.load.mock.calls.some(([, ref]) => ref === "output")).toBe(false);
		expect(f.call.mock.calls.map(([action]) => action)).toEqual(["project"]);
		expect(f.rows.get("stage:result")).toMatchObject({ result: { answerStarted: true } });
	});
	it.each([true, false])("preserves Control error retryability (%s)", async (retryable) => {
		const f = fixture();
		const error = new ControlHTTPError("terminal", retryable ? 503 : 422, {
			code: "citation_validation_failed",
			retryable,
		});
		f.call.mockRejectedValue(error);
		const result = new MockActivityEnvironment().run(() =>
			f.activities.finalizeFailure({
				workflow: { request_id: "run" } as never,
				code: "test",
				stage: "finalization.write",
				canceled: false,
			}),
		);
		if (retryable) {
			await expect(result).rejects.toBe(error);
		} else {
			await expect(result).rejects.toMatchObject({
				type: "citation_validation_failed",
				nonRetryable: true,
			});
		}
	});
	it("replays a completed model receipt after deadline without resolving a provider", async () => {
		const f = fixture();
		f.call.mockResolvedValue({ disposition: "replay", output: f.turn });
		const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
		const out = (await new MockActivityEnvironment().run(() =>
			f.activities.modelTurn({ requestId: "run", stageRef: "stage", turn: 0 }),
		)) as TurnDecision;
		expect(out.done).toBe(true);
		expect(fetch).not.toHaveBeenCalled();
		expect(f.call.mock.calls.map((c) => c[0])).toEqual(["invocation/get"]);
	});
	it("rejects a new invocation past its deadline without claiming it", async () => {
		const f = fixture();
		f.call.mockResolvedValue({ disposition: "new" });
		await expect(
			new MockActivityEnvironment().run(() =>
				f.activities.modelTurn({ requestId: "run", stageRef: "stage", turn: 0 }),
			),
		).rejects.toMatchObject({ type: "agent_deadline_exceeded", nonRetryable: true });
		expect(f.call.mock.calls.map((c) => c[0])).toEqual(["invocation/get"]);
	});
});
