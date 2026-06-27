import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildScoreReportFromAgentEvalCaseResults, validateLangfuseScoreReport } from "../src";
import {
	type AgentEvalStagingChatResult,
	buildAgentEvalCaseResults,
	loadAgentEvalCaseSet,
	loadAgentEvalObservations,
	runAgentEvalStaging,
} from "../src/agent-eval";
import { main as runLangfuseCli } from "../src/cli";

const repoRoot = resolve(import.meta.dirname, "../../..");

afterEach(() => {
	vi.doUnmock("node:child_process");
	vi.restoreAllMocks();
});

function fixturePath(name: string): string {
	return resolve(repoRoot, "packages/evals/fixtures/agent", name);
}

function completedChat(input: {
	agentRuntimeEvalProjection?: Record<string, unknown>;
	runId: string;
	status?: string;
	traceId: string;
}): AgentEvalStagingChatResult {
	return {
		conversationId: `conv-${input.runId}`,
		requestId: `req-${input.runId}`,
		runId: input.runId,
		status: input.status ?? "completed",
		traceId: input.traceId,
		agentRuntimeEvalProjection: input.agentRuntimeEvalProjection,
	};
}

function agentEvalTempPaths(prefix: string) {
	const tmp = mkdtempSync(join(tmpdir(), prefix));
	return {
		observationsPath: join(tmp, "observations.json"),
		resultsPath: join(tmp, "case-results.json"),
		scoreReportPath: join(tmp, "score-report.json"),
	};
}

describe("agent eval TS runner", () => {
	it("loads all four agent eval fixture families", () => {
		expect(loadAgentEvalCaseSet(fixturePath("routing_trajectory_cases.v1.json")).caseFamily).toBe(
			"agent_routing_trajectory.v1",
		);
		expect(loadAgentEvalCaseSet(fixturePath("rag_answer_cases.v1.json")).caseFamily).toBe(
			"agent_rag_answer.v1",
		);
		expect(loadAgentEvalCaseSet(fixturePath("retrieval_planning_cases.v1.json")).caseFamily).toBe(
			"agent_retrieval_planning.v1",
		);
		expect(loadAgentEvalCaseSet(fixturePath("multiturn_memory_cases.v1.json")).caseFamily).toBe(
			"agent_multiturn_memory.v1",
		);
	});

	it("rejects forbidden raw payload field variants in observations", () => {
		expect(() =>
			loadAgentEvalObservations({
				schema_version: "agent_eval_observations.v1",
				case_family: "agent_routing_trajectory.v1",
				observations: [
					{
						case_id: "bad",
						trace_id: "trace_bad",
						sourceBody: "secret",
					},
				],
			}),
		).toThrow("sourceBody is forbidden");
	});

	it("scores routing, rag answer contract, retrieval planning, and memory typed observations", () => {
		const routing = buildAgentEvalCaseResults({
			caseSet: loadAgentEvalCaseSet(fixturePath("routing_trajectory_cases.v1.json")),
			observations: loadAgentEvalObservations({
				schema_version: "agent_eval_observations.v1",
				case_family: "agent_routing_trajectory.v1",
				observations: [
					{
						case_id: "agent-routing-network-password-knowledge",
						direct_answer: false,
						requires_clarification: false,
						selected_tool: "knowledge_query",
						terminal_outcome: "completed",
						trace_id: "trace-routing-001",
					},
				],
			}),
			sourceGitHead: "abc123",
		});
		expect(routing.items[0]?.scores).toMatchObject({
			"clarification.correct": 1,
			"fail_close.correct": 1,
			"tool_selection.correct": 1,
			"trajectory.correct": 1,
		});

		const rag = buildAgentEvalCaseResults({
			caseSet: loadAgentEvalCaseSet(fixturePath("rag_answer_cases.v1.json")),
			observations: loadAgentEvalObservations({
				schema_version: "agent_eval_observations.v1",
				case_family: "agent_rag_answer.v1",
				observations: [
					{
						case_id: "agent-rag-student-scholarship-condition",
						required_facts: ["学习成绩", "综合测评"],
						source_titles: ["中央民族大学本科学生国家奖学金评审办法"],
						terminal_outcome: "completed",
						trace_id: "trace-rag-001",
					},
				],
			}),
			sourceGitHead: "abc123",
		});
		expect(rag.items[0]?.scores).toMatchObject({
			"rag.source_identity.correct": 1,
			"rag.required_facts.projected": 1,
		});

		const planning = buildAgentEvalCaseResults({
			caseSet: loadAgentEvalCaseSet(fixturePath("retrieval_planning_cases.v1.json")),
			observations: loadAgentEvalObservations({
				schema_version: "agent_eval_observations.v1",
				case_family: "agent_retrieval_planning.v1",
				observations: [
					{
						case_id: "agent-planning-unsupported-live-source",
						decomposition: ["unsupported_external_source"],
						fail_close_reason: "unsupported_source",
						final_status: "fail_close",
						freshness_branch: "unsupported_source",
						planned_steps: ["detect_unsupported_source", "fail_close_without_live_fetch"],
						trace_id: "trace-planning-001",
					},
				],
			}),
			sourceGitHead: "abc123",
		});
		const planningItem = planning.items.find(
			(item) => item.case_id === "agent-planning-unsupported-live-source",
		);
		expect(planningItem?.scores).toMatchObject({
			"planning.decomposition.correct": 1,
			"planning.freshness_branch.correct": 1,
			"planning.steps.coverage": 1,
			"planning.stop_condition.correct": 1,
		});

		const memory = buildAgentEvalCaseResults({
			caseSet: loadAgentEvalCaseSet(fixturePath("multiturn_memory_cases.v1.json")),
			observations: loadAgentEvalObservations({
				schema_version: "agent_eval_observations.v1",
				case_family: "agent_multiturn_memory.v1",
				observations: [
					{
						case_id: "agent-memory-user-isolation",
						final_status: "completed",
						memory_behavior: "user_isolation",
						observed_tokens: ["isolation_checked"],
						trace_id: "trace-memory-001",
					},
				],
			}),
			sourceGitHead: "abc123",
		});
		const memoryItem = memory.items.find((item) => item.case_id === "agent-memory-user-isolation");
		expect(memoryItem?.scores).toMatchObject({
			"memory.context_inheritance.correct": 1,
			"memory.forbidden_tokens.absent": 1,
			"memory.hindsight_usage.correct": 1,
			"memory.previous_evidence.correct": 1,
			"memory.user_isolation.correct": 1,
		});
	});

	it("runs staging cases and writes Langfuse-ready artifacts", async () => {
		const paths = agentEvalTempPaths("agent-eval-staging-");
		const prompts: string[] = [];

		const result = await runAgentEvalStaging({
			casesPath: fixturePath("routing_trajectory_cases.v1.json"),
			environment: "staging",
			outputObservationsPath: paths.observationsPath,
			outputResultsPath: paths.resultsPath,
			outputScoreReportPath: paths.scoreReportPath,
			runChat: async (input) => {
				prompts.push(input.prompt);
				return completedChat({
					agentRuntimeEvalProjection: {
						schema_version: "agent_runtime_eval_projection.v1",
						run: {
							status: "completed",
						},
						trajectory: {
							direct_answer: false,
							requires_clarification: false,
							selected_tool: "knowledge_query",
						},
					},
					runId: "routing-network-password",
					traceId: "trace-routing-network-password",
				});
			},
			sourceGitHead: "abc123",
			split: "release_gate",
			variantId: "baseline-agent-policy-v1",
		});

		const observations = JSON.parse(readFileSync(paths.observationsPath, "utf8")) as {
			observations: Record<string, unknown>[];
		};
		const caseResults = JSON.parse(readFileSync(paths.resultsPath, "utf8"));
		const scoreReport = validateLangfuseScoreReport(
			JSON.parse(readFileSync(paths.scoreReportPath, "utf8")),
		);
		const serialized = JSON.stringify(observations);

		expect(result.passed).toBe(true);
		expect(prompts).toEqual(["校园网密码怎么改"]);
		expect(observations.observations[0]).toMatchObject({
			case_id: "agent-routing-network-password-knowledge",
			selected_tool: "knowledge_query",
			trace_id: "trace-routing-network-password",
		});
		expect(caseResults.schema_version).toBe("agent_eval_case_results.v1");
		expect(scoreReport.eval_kind).toBe("agent_eval");
		expect(serialized).not.toContain("raw_transcript");
		expect(serialized).not.toContain("provider_raw_response");
	});

	it("fails closed when the typed agent runtime eval projection is missing", async () => {
		const paths = agentEvalTempPaths("agent-eval-staging-missing-");

		const result = await runAgentEvalStaging({
			casesPath: fixturePath("rag_answer_cases.v1.json"),
			environment: "staging",
			outputObservationsPath: paths.observationsPath,
			outputResultsPath: paths.resultsPath,
			outputScoreReportPath: paths.scoreReportPath,
			runChat: async () =>
				completedChat({
					runId: "rag-without-sources",
					traceId: "trace-rag-without-sources",
				}),
			sourceGitHead: "abc123",
			split: "release_gate",
			variantId: "baseline-agent-policy-v1",
		});

		const observations = JSON.parse(readFileSync(paths.observationsPath, "utf8")) as {
			observations: Record<string, unknown>[];
		};
		const caseResults = JSON.parse(readFileSync(paths.resultsPath, "utf8")) as {
			items: Array<{
				errors?: Array<{ reason: string }>;
				scores: Record<string, number>;
				verdict: string;
			}>;
		};

		expect(result.passed).toBe(false);
		expect(observations.observations[0]?.projection_error).toBe(
			"agent_runtime_eval_projection_missing",
		);
		expect(caseResults.items[0]?.verdict).toBe("fail");
		expect(caseResults.items[0]?.errors?.[0]?.reason).toBe("agent_runtime_eval_projection_missing");
		expect(caseResults.items[0]?.scores["rag.required_facts.projected"]).toBe(0);
		expect(caseResults.items[0]?.scores["rag.source_identity.correct"]).toBe(0);
	});

	it("extracts agent observations only from the typed agent runtime eval projection", async () => {
		const paths = agentEvalTempPaths("agent-eval-staging-projections-");

		const result = await runAgentEvalStaging({
			casesPath: fixturePath("retrieval_planning_cases.v1.json"),
			environment: "staging",
			outputObservationsPath: paths.observationsPath,
			outputResultsPath: paths.resultsPath,
			outputScoreReportPath: paths.scoreReportPath,
			runChat: async () =>
				completedChat({
					agentRuntimeEvalProjection: {
						schema_version: "agent_runtime_eval_projection.v1",
						run: {
							status: "fail_close",
							fail_close_reason: "unsupported_source",
						},
						trajectory: {
							selected_tool: "knowledge_query",
						},
						planning: {
							decomposition: ["unsupported_external_source"],
							freshness_branch: "unsupported_source",
							planned_steps: ["detect_unsupported_source", "fail_close_without_live_fetch"],
							stop_condition: "unsupported_source",
						},
					},
					runId: "planning-unsupported",
					traceId: "trace-planning-unsupported",
				}),
			sourceGitHead: "abc123",
			split: "regression_locked",
			variantId: "baseline-agent-policy-v1",
		});

		const observations = JSON.parse(readFileSync(paths.observationsPath, "utf8")) as {
			observations: Record<string, unknown>[];
		};

		expect(result.passed).toBe(true);
		expect(observations.observations[0]).toMatchObject({
			decomposition: ["unsupported_external_source"],
			fail_close_reason: "unsupported_source",
			final_status: "fail_close",
			freshness_branch: "unsupported_source",
			planned_steps: ["detect_unsupported_source", "fail_close_without_live_fetch"],
		});
	});

	it("uses typed rag source and fact projections from the app-api staging script output", async () => {
		const paths = agentEvalTempPaths("agent-eval-staging-default-");
		const spawnSync = vi.fn(() => ({
			status: 0,
			stdout: JSON.stringify({
				passed: true,
				run: {
					conversationId: "conv_01",
					requestId: "req_01",
					runId: "run_01",
					status: "completed",
					traceId: "trace_01",
				},
				agentRuntimeEvalProjection: {
					schema_version: "agent_runtime_eval_projection.v1",
					run: {
						status: "completed",
					},
					trajectory: {
						selected_tool: "knowledge_query",
					},
					rag: {
						source_refs: [
							{
								title: "中央民族大学本科学生国家奖学金评审办法",
							},
						],
					},
				},
				conversation: {
					assistantAnswerText: "申请时需要看学习成绩、综合测评排名。",
					id: "conv_01",
				},
				runtimeStepResults: [
					{
						resultKind: "knowledge_result",
						sanitizedPayload: {
							status: "this must not become final_status",
							sources: [{ source_title: "wrong legacy source title" }],
						},
					},
				],
				workflowTraceSummary: {
					selected_tool: "knowledge_query",
					trace_steps: [
						{ status: "completed", step_id: "memory.recall" },
						{ selected_tool: "knowledge_query", status: "completed", step_id: "agent.primary" },
						{ status: "completed", step_id: "finalization.write" },
					],
				},
			}),
			stderr: "",
		}));
		vi.doMock("node:child_process", () => ({ spawnSync }));

		const result = await runAgentEvalStaging({
			casesPath: fixturePath("rag_answer_cases.v1.json"),
			environment: "staging",
			outputObservationsPath: paths.observationsPath,
			outputResultsPath: paths.resultsPath,
			outputScoreReportPath: paths.scoreReportPath,
			sourceGitHead: "abc123",
			split: "release_gate",
			variantId: "baseline-agent-policy-v1",
		});

		const observations = JSON.parse(readFileSync(paths.observationsPath, "utf8")) as {
			observations: Record<string, unknown>[];
		};

		expect(result.passed).toBe(true);
		expect(spawnSync).toHaveBeenCalledWith(
			"node",
			expect.arrayContaining([
				"./scripts/run-with-staging-smoke-env.mjs",
				"pnpm",
				"exec",
				"tsx",
				"./scripts/chat-durable-e2e-staging.ts",
				"--chat-base-url",
				"https://api-staging.mucwiki-edge.link",
				"--prompt",
			]),
			expect.objectContaining({ cwd: resolve(repoRoot, "apps/app-api"), encoding: "utf8" }),
		);
		expect(observations.observations[0]).toMatchObject({
			required_facts: ["学习成绩", "综合测评"],
			source_titles: ["中央民族大学本科学生国家奖学金评审办法"],
		});
		expect(observations.observations[0]?.final_status).toBe("completed");
	});

	it("turns failed durable staging artifacts into failing agent observations", async () => {
		const paths = agentEvalTempPaths("agent-eval-staging-failed-");
		const spawnSync = vi.fn(() => ({
			status: 1,
			stdout: JSON.stringify({
				conversation: null,
				passed: false,
				run: {
					conversationId: "conv_failed",
					requestId: "req_failed",
					runId: "run_failed",
					status: "failed",
					traceId: "trace_failed",
				},
				runtimeStepResults: [],
				workflowTraceSummary: null,
			}),
			stderr: "",
		}));
		vi.doMock("node:child_process", () => ({ spawnSync }));

		const result = await runAgentEvalStaging({
			casesPath: fixturePath("rag_answer_cases.v1.json"),
			environment: "staging",
			outputObservationsPath: paths.observationsPath,
			outputResultsPath: paths.resultsPath,
			outputScoreReportPath: paths.scoreReportPath,
			sourceGitHead: "abc123",
			split: "release_gate",
			variantId: "baseline-agent-policy-v1",
		});

		const observations = JSON.parse(readFileSync(paths.observationsPath, "utf8")) as {
			observations: Record<string, unknown>[];
		};
		const caseResults = JSON.parse(readFileSync(paths.resultsPath, "utf8")) as {
			items: Array<{ verdict: string }>;
		};

		expect(result.passed).toBe(false);
		expect(observations.observations[0]).toMatchObject({
			case_id: "agent-rag-student-scholarship-condition",
			final_status: "failed",
			trace_id: "trace_failed",
		});
		expect(caseResults.items[0]?.verdict).toBe("fail");
	});

	it("marks completed staging artifacts without accepted proof as failed observations", async () => {
		const paths = agentEvalTempPaths("agent-eval-staging-no-answer-");
		const spawnSync = vi.fn(() => ({
			status: 1,
			stdout: JSON.stringify({
				conversation: null,
				passed: false,
				run: {
					conversationId: "conv_no_answer",
					requestId: "req_no_answer",
					runId: "run_no_answer",
					status: "completed",
					traceId: "trace_no_answer",
				},
				agentRuntimeEvalProjection: {
					schema_version: "agent_runtime_eval_projection.v1",
					run: {
						status: "completed",
					},
					trajectory: {
						selected_tool: "knowledge_query",
					},
					planning: {
						decomposition: ["campus_card", "current_policy"],
						freshness_branch: "current",
						planned_steps: ["indexed_lookup"],
					},
				},
				runtimeStepResults: [
					{
						resultKind: "agent_plan_result",
						sanitizedPayload: {
							status: "this must not become final_status",
						},
					},
				],
				workflowTraceSummary: {
					selected_tool: "knowledge_query",
					trace_steps: [
						{ selected_tool: "knowledge_query", status: "completed", step_id: "rag.plan" },
					],
				},
			}),
			stderr: "",
		}));
		vi.doMock("node:child_process", () => ({ spawnSync }));

		const result = await runAgentEvalStaging({
			casesPath: fixturePath("retrieval_planning_cases.v1.json"),
			environment: "staging",
			outputObservationsPath: paths.observationsPath,
			outputResultsPath: paths.resultsPath,
			outputScoreReportPath: paths.scoreReportPath,
			sourceGitHead: "abc123",
			split: "release_gate",
			variantId: "baseline-agent-policy-v1",
		});

		const observations = JSON.parse(readFileSync(paths.observationsPath, "utf8")) as {
			observations: Record<string, unknown>[];
		};

		expect(result.passed).toBe(false);
		expect(observations.observations[0]).toMatchObject({
			final_status: "failed",
			trace_id: "trace_no_answer",
		});
	});

	it("reuses the accepted conversation for same-user multi-turn memory staging runs", async () => {
		const paths = agentEvalTempPaths("agent-eval-staging-memory-default-");
		const spawnSync = vi
			.fn()
			.mockReturnValueOnce({
				status: 0,
				stdout: JSON.stringify({
					conversation: {
						assistantAnswerText: "第一轮回答。",
						id: "conv_memory_01",
					},
					run: {
						conversationId: "conv_memory_01",
						requestId: "req_memory_01",
						runId: "run_memory_01",
						status: "completed",
						traceId: "trace_memory_01",
					},
					runtimeStepResults: [],
					workflowTraceSummary: {
						selected_tool: "knowledge_query",
						trace_steps: [{ status: "completed", step_id: "memory.recall" }],
					},
				}),
				stderr: "",
			})
			.mockReturnValueOnce({
				status: 0,
				stdout: JSON.stringify({
					conversation: {
						assistantAnswerText: "第二轮回答。",
						id: "conv_memory_01",
					},
					run: {
						conversationId: "conv_memory_01",
						requestId: "req_memory_02",
						runId: "run_memory_02",
						status: "completed",
						traceId: "trace_memory_02",
					},
					agentRuntimeEvalProjection: {
						schema_version: "agent_runtime_eval_projection.v1",
						run: {
							status: "completed",
						},
						trajectory: {
							selected_tool: "knowledge_query",
						},
						memory: {
							behavior: "previous_evidence_reuse",
							observed_tokens: ["previous_evidence_ref", "source_hash"],
						},
					},
					runtimeStepResults: [],
					workflowTraceSummary: {
						selected_tool: "knowledge_query",
						trace_steps: [{ status: "completed", step_id: "memory.recall" }],
					},
				}),
				stderr: "",
			});
		vi.doMock("node:child_process", () => ({ spawnSync }));

		const result = await runAgentEvalStaging({
			casesPath: fixturePath("multiturn_memory_cases.v1.json"),
			environment: "staging",
			outputObservationsPath: paths.observationsPath,
			outputResultsPath: paths.resultsPath,
			outputScoreReportPath: paths.scoreReportPath,
			sourceGitHead: "abc123",
			split: "release_gate",
			variantId: "baseline-agent-policy-v1",
		});

		expect(result.passed).toBe(true);
		expect(spawnSync).toHaveBeenNthCalledWith(
			1,
			"node",
			expect.not.arrayContaining(["--conversation-id", "conv_memory_01"]),
			expect.objectContaining({ encoding: "utf8" }),
		);
		expect(spawnSync).toHaveBeenNthCalledWith(
			2,
			"node",
			expect.arrayContaining([
				"--password",
				"AgentEvalMemory!agentmemoryfollowuppreviousevidence",
				"--conversation-id",
				"conv_memory_01",
				"--no-reset-identity",
			]),
			expect.objectContaining({ encoding: "utf8" }),
		);
	});

	it("keeps user-isolation memory cases on separate reset identities", async () => {
		const calls: Array<{
			conversationId?: string;
			password?: string;
			resetIdentity?: boolean;
			userEmail?: string;
		}> = [];
		const paths = agentEvalTempPaths("agent-eval-staging-isolation-");

		await runAgentEvalStaging({
			casesPath: fixturePath("multiturn_memory_cases.v1.json"),
			environment: "staging",
			outputObservationsPath: paths.observationsPath,
			outputResultsPath: paths.resultsPath,
			outputScoreReportPath: paths.scoreReportPath,
			runChat: async (input) => {
				calls.push({
					conversationId: input.conversationId,
					password: input.password,
					resetIdentity: input.resetIdentity,
					userEmail: input.userEmail,
				});
				return completedChat({
					agentRuntimeEvalProjection:
						input.turnIndex === 1
							? {
									schema_version: "agent_runtime_eval_projection.v1",
									run: {
										status: "completed",
									},
									trajectory: {
										selected_tool: "knowledge_query",
									},
									memory: {
										behavior: "user_isolation",
										observed_tokens: ["isolation_checked"],
									},
								}
							: undefined,
					runId: `isolation-${input.turnIndex}`,
					traceId: `trace-isolation-${input.turnIndex}`,
				});
			},
			sourceGitHead: "abc123",
			split: "regression_locked",
			variantId: "baseline-agent-policy-v1",
		});

		expect(calls).toEqual([
			{
				conversationId: undefined,
				password: "AgentEvalMemory!agentmemoryuserisolation",
				resetIdentity: true,
				userEmail: "help_bot@outlook.com",
			},
			{
				conversationId: undefined,
				password: "AgentEvalMemory!agentmemoryuserisolation",
				resetIdentity: true,
				userEmail: "eval-benchmark@example.edu",
			},
		]);
	});

	it("converts TS agent eval case results to a Langfuse score report", () => {
		const caseResults = buildAgentEvalCaseResults({
			caseSet: loadAgentEvalCaseSet(fixturePath("routing_trajectory_cases.v1.json")),
			observations: loadAgentEvalObservations({
				schema_version: "agent_eval_observations.v1",
				case_family: "agent_routing_trajectory.v1",
				observations: [
					{
						case_id: "agent-routing-network-password-knowledge",
						direct_answer: false,
						requires_clarification: false,
						selected_tool: "knowledge_query",
						terminal_outcome: "completed",
						trace_id: "trace-routing-001",
					},
				],
			}),
			sourceGitHead: "abc123",
		});

		const report = buildScoreReportFromAgentEvalCaseResults({
			agentEvalCaseResultsPath: "agent-results.json",
			agentEvalCaseResultsPayload: caseResults,
			environment: "staging",
		});

		expect(report.schema_version).toBe("langfuse_score_report.v1");
		expect(report.eval_kind).toBe("agent_eval");
		expect(report.expected_publish_denominator).toBe(4);
		expect(report.score_items.map((item) => item.name)).toEqual([
			"trajectory.correct",
			"tool_selection.correct",
			"clarification.correct",
			"fail_close.correct",
		]);
	});

	it("builds local agent eval artifacts without Langfuse API keys", async () => {
		const paths = agentEvalTempPaths("agent-eval-cli-local-");
		const previousEnv = {
			LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL,
			LANGFUSE_ENVIRONMENT: process.env.LANGFUSE_ENVIRONMENT,
			LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
			LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
		};
		process.env.LANGFUSE_BASE_URL = "";
		process.env.LANGFUSE_ENVIRONMENT = "staging";
		process.env.LANGFUSE_PUBLIC_KEY = "";
		process.env.LANGFUSE_SECRET_KEY = "";
		try {
			const observations = {
				schema_version: "agent_eval_observations.v1",
				case_family: "agent_routing_trajectory.v1",
				observations: [
					{
						case_id: "agent-routing-network-password-knowledge",
						direct_answer: false,
						requires_clarification: false,
						selected_tool: "knowledge_query",
						terminal_outcome: "completed",
						trace_id: "trace-routing-001",
					},
				],
			};
			await import("node:fs").then(({ writeFileSync }) =>
				writeFileSync(paths.observationsPath, JSON.stringify(observations), "utf8"),
			);
			const exitCode = await runLangfuseCli([
				"build-agent-eval-case-results",
				"--cases",
				fixturePath("routing_trajectory_cases.v1.json"),
				"--observations",
				paths.observationsPath,
				"--output",
				paths.resultsPath,
				"--source-git-head",
				"abc123",
			]);
			expect(exitCode).toBe(0);
			const scoreExitCode = await runLangfuseCli([
				"build-score-report-from-agent-eval",
				"--input",
				paths.resultsPath,
				"--score-report",
				paths.scoreReportPath,
			]);

			expect(scoreExitCode).toBe(0);
			expect(JSON.parse(readFileSync(paths.scoreReportPath, "utf8")).environment).toBe("staging");
		} finally {
			for (const [key, value] of Object.entries(previousEnv)) {
				if (value === undefined) {
					delete process.env[key];
				} else {
					process.env[key] = value;
				}
			}
		}
	});
});
