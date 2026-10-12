import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { bundleWorkflowCode, NativeConnection, Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
	AgentActivities,
	AgentWorkflowInput,
	StageDecision,
	StageInput,
} from "../src/temporal-contract.ts";
import {
	AGENT_MODEL_QUEUE,
	AGENT_TOOL_QUEUE,
	AGENT_WORKFLOW_QUEUE,
} from "../src/temporal-contract.ts";

describe("Agent Temporal orchestration", () => {
	let env: TestWorkflowEnvironment;
	let connection: NativeConnection;
	let bundle: Awaited<ReturnType<typeof bundleWorkflowCode>>;
	beforeAll(async () => {
		env = process.env.AGENT_TEST_TEMPORAL_ADDRESS
			? await TestWorkflowEnvironment.createFromExistingServer({
					address: process.env.AGENT_TEST_TEMPORAL_ADDRESS,
				})
			: await TestWorkflowEnvironment.createLocal();
		connection = await NativeConnection.connect({ address: env.address });
		bundle = await bundleWorkflowCode({
			workflowsPath: fileURLToPath(new URL("../src/workflows.ts", import.meta.url)),
		});
	}, 120_000);
	afterAll(async () => {
		await connection?.close();
		await env?.teardown();
	});
	const decision = (ref: string, extra: Partial<StageDecision> = {}): StageDecision => ({
		ref,
		status: "completed",
		remainingFacts: [],
		evidenceCount: 0,
		nextCitation: 1,
		sourceSucceeded: false,
		sourceAttempts: [],
		answerStarted: false,
		...extra,
	});
	async function run(
		scenario: (stage: StageInput) => StageDecision,
		toolFailure = false,
		mode?: "retry" | "cancel" | "permanent-finalization",
	) {
		let preparations = 0;
		const cancellations: boolean[] = [];
		const stages: StageInput[] = [];
		const finalized: string[] = [];
		const failures: string[] = [];
		const failureStages: string[] = [];
		const activities: AgentActivities = {
			prepareStage: async (s) => {
				preparations++;
				if (mode === "retry" && preparations === 1) {
					throw new Error("temporary control outage");
				}
				stages.push(s);
				return { ref: s.key };
			},
			modelTurn: async (i) => {
				if (mode === "cancel") {
					const context = Context.current();
					const timer = setInterval(() => context.heartbeat(), 50);
					try {
						await env.client.workflow.getHandle(input.workflow_id).cancel();
						return await context.cancelled;
					} finally {
						clearInterval(timer);
					}
				}
				return {
					ref: i.stageRef,
					calls:
						toolFailure && i.stageRef === "solve.initial"
							? [{ index: 0, name: "campus_search" }]
							: [],
					done: !(toolFailure && i.stageRef === "solve.initial"),
				};
			},
			executeTool: async () => {
				throw ApplicationFailure.nonRetryable("budget exhausted", "tool_call_budget_exhausted");
			},
			completeTurn: async (i) => ({ ref: i.turnRef }),
			completeStage: async (i) => scenario(stages.find((s) => s.key === i.stageRef)!),
			finalizeAnswer: async (i) => {
				finalized.push(i.ref);
				if (mode === "permanent-finalization") {
					throw ApplicationFailure.nonRetryable("Invalid citations", "citation_validation_failed");
				}
			},
			finalizeFailure: async (i) => {
				failures.push(i.code);
				failureStages.push(i.stage);
				cancellations.push(i.canceled);
			},
		};
		const workers = await Promise.all([
			Worker.create({ connection, taskQueue: AGENT_WORKFLOW_QUEUE, workflowBundle: bundle }),
			Worker.create({ connection, taskQueue: AGENT_MODEL_QUEUE, activities }),
			Worker.create({ connection, taskQueue: AGENT_TOOL_QUEUE, activities }),
		]);
		const input: AgentWorkflowInput = {
			request_id: randomUUID(),
			conversation_id: randomUUID(),
			workflow_id: randomUUID(),
			deadline_at: new Date(Date.now() + 60_000).toISOString(),
			admission_snapshot: {
				provider_config_sha256: "test",
				agent_budget: {
					max_plan_steps: 4,
					max_replans: 1,
					max_model_turns: 2,
					max_function_tool_calls: 2,
				},
				agent_capabilities: {
					visible_function_tool_names: ["campus_search", "personal_memory_recall"],
					hosted_web_search: false,
				},
				agent_limits: {
					agent_deadline_ms: 60_000,
					context_char_limit: 10000,
					current_input_char_limit: 1000,
					max_output_tokens: 1000,
				},
				tool_contract_fingerprint: {
					schema_version: "test",
					tools_sha256: "test",
					function_schema_sha256: "test",
				},
			},
		};
		await workers[0]!.runUntil(() =>
			workers[1]!.runUntil(() =>
				workers[2]!.runUntil(async () => {
					const result = env.client.workflow.execute("AgentWorkflow", {
						taskQueue: AGENT_WORKFLOW_QUEUE,
						workflowId: input.workflow_id,
						args: [input],
					});
					if (mode === "permanent-finalization") {
						// biome-ignore lint/suspicious/noMisplacedAssertion: Shared workflow runner verifies the expected terminal failure.
						await expect(result).rejects.toMatchObject({
							cause: { cause: { type: "citation_validation_failed" } },
						});
					} else {
						await result;
					}
				}),
			),
		);
		const history = await env.client.workflow.getHandle(input.workflow_id).fetchHistory();
		return { stages, finalized, failures, failureStages, cancellations, preparations, history };
	}
	it("finalizes a direct Solve answer", async () => {
		const result = await run((s) => decision(s.key, { solveOutcome: "answer" }));
		expect(result.stages.map((s) => s.operation)).toEqual(["solve"]);
		expect(result.finalized).toEqual(["solve.initial"]);
	}, 30_000);
	it("executes dependencies, replans, then synthesizes references", async () => {
		const step = {
			id: "step.first",
			objective: "find notice",
			candidateSources: ["campus_search" as const],
			dependsOn: [],
		};
		const result = await run((s) => {
			if (s.operation === "solve") {
				return decision(s.key, {
					solveOutcome: "plan",
					plan: { schemaVersion: "task_plan.v1", goal: "answer", steps: [step] },
				});
			}
			if (s.operation === "execute_step") {
				return decision(s.key, {
					evidenceCount: 1,
					remainingFacts: ["date"],
					sourceSucceeded: true,
					nextCitation: 2,
				});
			}
			if (s.operation === "replan") {
				return decision(s.key, {
					replan: {
						schemaVersion: "task_replan.v3",
						decision: "synthesize",
						reason: "enough",
						remainingSteps: [],
					},
				});
			}
			return decision(s.key);
		});
		expect(result.stages.map((s) => s.operation)).toEqual([
			"solve",
			"execute_step",
			"replan",
			"synthesize",
		]);
		expect(result.stages.at(-1)?.completedRefs).toEqual(["task.step.step.first"]);
		expect(result.finalized).toEqual(["answer.synthesize"]);
	}, 30_000);
	it("continues the admitted plan when Control rejects a replan", async () => {
		const first = {
			id: "step.first",
			objective: "find date",
			candidateSources: ["campus_search" as const],
			dependsOn: [],
		};
		const second = {
			...first,
			id: "step.second",
			objective: "find location",
			dependsOn: ["step.first"],
		};
		const result = await run((s) => {
			if (s.operation === "solve") {
				return decision(s.key, {
					solveOutcome: "plan",
					plan: { schemaVersion: "task_plan.v1", goal: "answer", steps: [first, second] },
				});
			}
			if (s.operation === "execute_step") {
				return decision(s.key, {
					evidenceCount: 1,
					sourceSucceeded: true,
					remainingFacts: s.step?.id === "step.first" ? ["location"] : [],
				});
			}
			if (s.operation === "replan") {
				return decision(s.key, { status: "failed", failureCode: "model_output_invalid" });
			}
			return decision(s.key);
		});
		expect(
			result.stages.filter((s) => s.operation === "execute_step").map((s) => s.step?.id),
		).toEqual(["step.first", "step.second"]);
		expect(result.finalized).toEqual(["answer.synthesize"]);
		expect(result.failures).toEqual([]);
	}, 30_000);
	it("finalizes a permanent citation failure without retrying finalization", async () => {
		const result = await run(
			(s) => decision(s.key, { solveOutcome: "answer" }),
			false,
			"permanent-finalization",
		);
		expect(result.finalized).toEqual(["solve.initial"]);
		expect(result.failures).toEqual(["citation_validation_failed"]);
		expect(result.failureStages).toEqual(["finalization.write"]);
	}, 30_000);
	it("keeps partial materials after tool budget failure and runs recovery synthesis", async () => {
		const result = await run(
			(s) =>
				s.operation === "solve"
					? decision(s.key, {
							status: "failed",
							failureCode: "tool_call_budget_exhausted",
							evidenceCount: 1,
						})
					: decision(s.key),
			true,
		);
		expect(result.stages.at(-1)?.mode).toBe("recovery");
		expect(result.finalized).toEqual(["answer.synthesize"]);
		expect(result.failures).toEqual([]);
	}, 30_000);
	it("recovers a failed preparation and replays completed history", async () => {
		const result = await run((s) => decision(s.key, { solveOutcome: "answer" }), false, "retry");
		expect(result.preparations).toBe(2);
		expect(result.finalized).toEqual(["solve.initial"]);
		await Worker.runReplayHistory({ workflowBundle: bundle }, result.history);
	}, 30_000);
	it("cancels an in-flight model activity and writes cancellation in a non-cancellable scope", async () => {
		const result = await run((s) => decision(s.key, { solveOutcome: "answer" }), false, "cancel");
		expect(result.finalized).toEqual([]);
		expect(result.cancellations).toEqual([true]);
	}, 30_000);
});
