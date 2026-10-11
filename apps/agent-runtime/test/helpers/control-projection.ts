// biome-ignore-all lint/suspicious/noMisplacedAssertion: Executed as a subprocess by the Go PostgreSQL test.
// Invoked by the Go PostgreSQL suite against its real control HTTP server.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { MockActivityEnvironment } from "@temporalio/testing";
import { createAgentActivities } from "../../src/activities.ts";
import { AgentControlClient } from "../../src/control-client.ts";
import { disableOpenAITracing } from "../../src/openai-telemetry.ts";
import type {
	AgentWorkflowInput,
	StageDecision,
	StageInput,
	TurnDecision,
} from "../../src/temporal-contract.ts";
import { loadToolCatalog } from "../../src/tool-catalog.ts";

disableOpenAITracing();
const control = new AgentControlClient(process.argv[2]!, "test");
const catalog = loadToolCatalog("../../configs/runtime/tools.v7.json");
const fp = catalog.contractFingerprint;
let text = "";
let available = true;
let providerCalls = 0;
const provider = createServer(async (req, res) => {
	if (!available) {
		res.writeHead(503);
		res.end();
		return;
	}
	if (req.url?.startsWith("/internal/model-configs")) {
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify({
				schema_version: "model_runtime_config.v1",
				name: "primary_agent",
				api_key: "test-secret",
				api_protocol: "openai.chat_completions",
				base_url: `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`,
				model: "test",
				provider: "openai",
				target_sha256: "a".repeat(64),
			}),
		);
		return;
	}
	providerCalls++;
	let body = "";
	for await (const chunk of req) {
		body += chunk;
	}
	const request = JSON.parse(body);
	const chunk = { id: "test-response", object: "chat.completion.chunk", created: 1, model: "test" };
	if (request.stream) {
		res.setHeader("content-type", "text/event-stream");
		res.write(
			`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] })}\n\n`,
		);
		res.write(
			`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } })}\n\ndata: [DONE]\n\n`,
		);
		res.end();
	} else {
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify({
				...chunk,
				object: "chat.completion",
				choices: [
					{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" },
				],
				usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
			}),
		);
	}
});
await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
const env = new MockActivityEnvironment();
const activities = createAgentActivities({
	control,
	catalog,
	domains: { searchUrl: "", searchToken: "", memoryUrl: "", memorySecret: "" },
	modelConfigUrl: `http://127.0.0.1:${(provider.address() as { port: number }).port}`,
	release: "test",
});
const step = {
	id: "step.first",
	objective: "查找信息",
	candidateSources: ["campus_search" as const],
	dependsOn: [],
};
const plan = { schemaVersion: "task_plan.v1" as const, goal: "查询", steps: [step] };
try {
	for (const scenario of [
		"direct",
		"plan",
		"execute",
		"synthesize",
		"recovery",
		"deadline",
		"replan-invalid",
		"replan-valid",
	]) {
		available = true;
		const requestId = `runtime-${scenario}`;
		const workflow: AgentWorkflowInput = {
			request_id: requestId,
			conversation_id: `conversation-${requestId}`,
			workflow_id: `workflow-${requestId}`,
			deadline_at: new Date(Date.now() + 60_000).toISOString(),
			admission_snapshot: {
				provider_config_sha256: "a".repeat(64),
				tool_contract_fingerprint: {
					schema_version: fp.schemaVersion,
					tools_sha256: fp.toolsSha256,
					function_schema_sha256: fp.functionSchemaSha256,
				},
				agent_capabilities: {
					visible_function_tool_names: ["campus_search", "personal_memory_recall"],
					hosted_web_search: false,
				},
				agent_budget: {
					max_model_turns: 3,
					max_function_tool_calls: 3,
					max_plan_steps: 4,
					max_replans: 1,
				},
				agent_limits: {
					agent_deadline_ms: 60000,
					context_char_limit: 16000,
					current_input_char_limit: 8000,
					max_output_tokens: 2048,
				},
			},
		};
		Object.assign(workflow.admission_snapshot.agent_capabilities, {
			schema_version: "agent_capabilities.v1",
		});
		Object.assign(workflow.admission_snapshot.agent_budget, {
			schema_version: "agent_runtime_budget.v1",
		});
		let input: StageInput = {
			workflow,
			key: "solve.initial",
			operation: "solve",
			completedRefs: [],
			citationStart: 1,
		};
		text = JSON.stringify({ result: { outcome: "answer", answer: "hello" } });
		if (scenario === "plan") {
			text = JSON.stringify({ result: { outcome: "plan", plan } });
		}
		if (scenario.startsWith("replan-")) {
			input = {
				...input,
				key: "solve.replan.1",
				operation: "replan",
				plan,
				remaining: [step],
				replanIndex: 1,
			};
			text = JSON.stringify({
				schemaVersion: "task_replan.v3",
				decision: "continue",
				reason: "more",
				remainingSteps: scenario === "replan-valid" ? [step] : [],
			});
		}
		if (scenario === "execute") {
			input = { ...input, key: "task.step.step.first", operation: "execute_step", plan, step };
			text = JSON.stringify({ summary: "done", remainingFacts: [] });
		}
		if (scenario === "synthesize" || scenario === "recovery") {
			const solveRef = "test-materials";
			await control.save(requestId, solveRef, {
				result: {
					evidence: [
						{
							schemaVersion: "workflow_evidence.v1",
							id: "memory:fact",
							source: "personal_memory_recall",
							title: "记忆",
							excerpt: "材料",
						},
					],
					sourceAttempts: [],
				},
			});
			input = {
				...input,
				key: "answer.synthesize",
				operation: "synthesize",
				solveRef,
				...(scenario === "recovery"
					? { mode: "recovery", recoveryReason: "run_failed", bufferAnswer: true }
					: { mode: "planned" }),
			};
			text = "hello";
		}
		const stage = (await env.run(() => activities.prepareStage(input))) as { ref: string };
		const turn = (await env.run(() =>
			activities.modelTurn({ requestId, stageRef: stage.ref, turn: 0 }),
		)) as TurnDecision;
		assert.equal(turn.done, true);
		const turnRecord = await control.load<{ state: { result: { failure?: unknown } } }>(
			requestId,
			turn.ref,
		);
		assert.equal(turnRecord.state.result.failure, undefined, JSON.stringify(turnRecord));
		available = false;
		if (scenario === "deadline") {
			// A persisted failure must still be projected after its execution budget expires.
			const saved = await control.load<{ input: StageInput }>(requestId, stage.ref);
			saved.input.workflow.deadline_at = new Date(Date.now() - 1000).toISOString();
			await control.save(requestId, "expired-stage", saved);
			stage.ref = "expired-stage";
		}
		const args = {
			requestId,
			stageRef: stage.ref,
			turnRef: turn.ref,
			...(scenario === "deadline" ? { failureCode: "agent_deadline_exceeded" } : {}),
		};
		if (scenario === "direct") {
			await assert.rejects(env.run(() => activities.completeStage(args)));
		}
		const result = (await env.run(() => activities.completeStage(args))) as StageDecision;
		assert.equal(
			result.status,
			scenario === "deadline" || scenario === "replan-invalid" ? "failed" : "completed",
		);
		if (scenario === "replan-invalid") {
			assert.equal(result.failureCode, "model_output_invalid");
			assert.equal(result.replan, undefined);
			const saved = await control.load<{
				result: { status: string; replan?: unknown; usage: { modelRequestCount: number } };
			}>(requestId, result.ref);
			assert.equal(saved.result.status, "failed");
			assert.equal(saved.result.replan, undefined);
			assert.equal(saved.result.usage.modelRequestCount, 1);
		}
		if (scenario === "replan-valid") {
			assert.deepEqual(result.replan?.remainingSteps, [step]);
		}
		if (scenario === "synthesize") {
			assert.equal(result.evidenceCount, 1);
		}
		assert.deepEqual(await env.run(() => activities.completeStage(args)), result);
		// Exercise HTTP projection replay too: the Activity cache alone would skip it.
		const preparedRef = `stage:${input.key}:prepared`;
		const completion = await control.load<{ payload: unknown; completed_at: string }>(
			requestId,
			`${preparedRef}:completion`,
		);
		await control.call("project", { request_id: requestId, ref: preparedRef, ...completion });
		if (scenario === "deadline") {
			// Replay the original receipt with expired workflow input and unavailable config.
			const saved = await control.load<{ input: StageInput }>(requestId, "stage:solve.initial");
			saved.input.workflow.deadline_at = new Date(Date.now() - 1000).toISOString();
			// Keep the original identity for the receipt and inject only the loaded deadline.
			const original = control.load.bind(control);
			control.load = async <T>(id: string, ref: string) =>
				ref === "stage:solve.initial" ? (saved as T) : original<T>(id, ref);
			const count = providerCalls;
			await env.run(() =>
				activities.modelTurn({ requestId, stageRef: "stage:solve.initial", turn: 0 }),
			);
			assert.equal(providerCalls, count);
			control.load = original;
		}
	}
	console.log("real Activities → control HTTP → PostgreSQL passed");
} finally {
	provider.close();
	provider.closeAllConnections();
}
