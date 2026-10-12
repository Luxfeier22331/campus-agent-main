import { createHash } from "node:crypto";
import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { z } from "zod";
import { beginActivity, currentActivityMetadata } from "./activity-metadata.ts";
import type {
	AgentRunnerResult,
	CompletedTaskStep,
	PromptProviderRuntimeConfig,
	ToolExecutionResult,
	WorkflowOperationResult,
} from "./agent-run-contract.ts";
import { createCampusSearchReporter } from "./campus-search-observer.ts";
import { type AgentControlClient, ControlHTTPError } from "./control-client.ts";
import {
	createDomainToolExecutor,
	type DomainToolConfig,
	type ToolContext,
} from "./domain-tools.ts";
import { createFunctionToolContext, invokeFunctionTool } from "./function-tools.ts";
import { runGeminiModelTurn } from "./gemini-runner.ts";
import type { GeminiSourceResolver } from "./gemini-source-resolver.ts";
import {
	agentRunResultWire,
	evidenceWire,
	structuredOutputWire,
	taskPlanStepWire,
} from "./http-response.ts";
import { agentRunRequestSchema, runtimeInputFromAgentRunRequest } from "./http-run-contract.ts";
import { resolveModelRuntimeConfig } from "./model-config-client.ts";
import { continueWithTools, type ModelTurn, type ProviderContinuation } from "./model-turn.ts";
import { normalizeStageResult } from "./operation-rules.ts";
import { partialJSONStringField } from "./runner-output.ts";
import {
	AgentRuntimeError,
	agentRuntimeErrorLogFields,
	agentRuntimeErrorPayload,
} from "./runtime-errors.ts";
import { runOpenAIModelTurn } from "./sdk-runner.ts";
import type { AgentActivities, StageDecision, StageInput } from "./temporal-contract.ts";
import type { ToolCatalog } from "./tool-catalog.ts";
import {
	defaultInstructions,
	operationResultFromRunner,
	prepareOperation,
} from "./workflow-runtime.ts";

interface StageRecord {
	input: StageInput;
	preparedRef: string;
	wire: unknown;
	model: Pick<PromptProviderRuntimeConfig, "provider" | "model" | "transport" | "hostedWebSearch">;
	toolContext: ToolContext;
	createdAt: string;
	startedAt: string;
}
interface TurnState {
	completedAt?: string;
	continuation?: ProviderContinuation;
	result: AgentRunnerResult;
	citation: number;
	excludedRefs: string[];
	reserved: number;
	sequence: number;
}
interface TurnRecord {
	state: TurnState;
	turn: ModelTurn;
	completedAt: string;
	turnIndex: number;
}
type StageResult = Pick<
	WorkflowOperationResult,
	| "operation"
	| "status"
	| "finalOutput"
	| "answerStarted"
	| "solveOutcome"
	| "plan"
	| "replan"
	| "remainingFacts"
	| "failure"
	| "evidence"
	| "sourceAttempts"
	| "usage"
>;
interface SavedStage {
	input: StageInput;
	result: StageResult;
	controlRef: string;
	decision: StageDecision;
}
export interface ActivityOptions {
	control: AgentControlClient;
	catalog: ToolCatalog;
	domains: DomainToolConfig;
	modelConfigUrl: string;
	release: string;
	resolveSources?: GeminiSourceResolver;
}
function emptyResult(): AgentRunnerResult {
	return {
		finalOutput: "",
		providerResponseId: "",
		toolResults: [],
		webEvidence: [],
		usage: {
			modelRequestCount: 0,
			inputTokens: 0,
			outputTokens: 0,
			cachedInputTokens: 0,
			usageObserved: false,
		},
	};
}
function sourceAttemptWire(attempt: WorkflowOperationResult["sourceAttempts"][number]) {
	return {
		source: attempt.source,
		status: attempt.status,
		...(attempt.failureCode ? { failure_code: attempt.failureCode } : {}),
	};
}
function mergeResult(previous: AgentRunnerResult, next: AgentRunnerResult): AgentRunnerResult {
	return {
		...next,
		toolResults: previous.toolResults,
		webEvidence: [...(previous.webEvidence ?? []), ...(next.webEvidence ?? [])],
		webSearchUsed: previous.webSearchUsed || next.webSearchUsed || false,
		usage: {
			modelRequestCount: previous.usage.modelRequestCount + next.usage.modelRequestCount,
			inputTokens: previous.usage.inputTokens + next.usage.inputTokens,
			outputTokens: previous.usage.outputTokens + next.usage.outputTokens,
			cachedInputTokens:
				(previous.usage.cachedInputTokens ?? 0) + (next.usage.cachedInputTokens ?? 0),
			usageObserved: previous.usage.usageObserved || next.usage.usageObserved,
		},
	};
}
async function heartbeating<T>(fn: () => Promise<T>): Promise<T> {
	beginActivity();
	const timer = setInterval(() => Context.current().heartbeat(), 10_000);
	try {
		return await fn();
	} catch (error) {
		if (error instanceof ControlHTTPError && !error.retryable) {
			throw ApplicationFailure.nonRetryable(error.message, error.code);
		}
		throw error;
	} finally {
		clearInterval(timer);
	}
}
export function createAgentActivities(options: ActivityOptions): AgentActivities {
	const { control, catalog } = options;
	function executionSignal(record: Pick<StageRecord, "input">) {
		Context.current().cancellationSignal.throwIfAborted();
		const remaining = Date.parse(record.input.workflow.deadline_at) - Date.now();
		if (remaining <= 0) {
			throw ApplicationFailure.nonRetryable("Agent deadline expired", "agent_deadline_exceeded");
		}
		return AbortSignal.any([Context.current().cancellationSignal, AbortSignal.timeout(remaining)]);
	}
	async function modelConfig(record: Pick<StageRecord, "input">, signal: AbortSignal) {
		try {
			return await resolveModelRuntimeConfig(
				{ baseUrl: options.modelConfigUrl },
				record.input.workflow.admission_snapshot.provider_config_sha256,
				signal,
			);
		} catch (error) {
			Context.current().cancellationSignal.throwIfAborted();
			if (signal.aborted) {
				throw ApplicationFailure.nonRetryable("Agent deadline expired", "agent_deadline_exceeded");
			}
			throw error;
		}
	}
	function hydrate(
		record: StageRecord,
		signal = Context.current().cancellationSignal,
		provider: PromptProviderRuntimeConfig = { ...record.model, apiKey: "" },
	) {
		const input = runtimeInputFromAgentRunRequest(
			agentRunRequestSchema.parse(record.wire),
			provider,
			signal,
		);
		const executor = createDomainToolExecutor(
			options.domains,
			record.toolContext,
			control,
			record.createdAt,
			input.conversationId,
		);
		Object.assign(executor, {
			observe: createCampusSearchReporter({
				baseUrl: control.baseUrl,
				sharedSecret: control.secret,
			}),
		});
		const prepared = prepareOperation(input, catalog, executor, defaultInstructions);
		return { input, prepared };
	}
	return {
		async prepareStage(input) {
			return heartbeating(async () => {
				const requestId = input.workflow.request_id;
				const ref = `stage:${input.key}`;
				if (await control.maybeLoad<StageRecord>(requestId, ref)) {
					return { ref };
				}
				const solved = input.solveRef
					? await control.load<SavedStage>(requestId, input.solveRef)
					: undefined;
				const completed = await Promise.all(
					input.completedRefs.map((r) => control.load<SavedStage>(requestId, r)),
				);
				const completedSteps: CompletedTaskStep[] = completed.map((s, index) => ({
					step: s.input.step!,
					executionIndex: index + 1,
					summary: s.result.finalOutput || s.result.failure?.code || "Step failed",
					remainingFacts:
						s.result.remainingFacts ??
						(s.result.status === "failed" ? [s.input.step!.objective] : []),
					evidence: s.result.evidence,
					sourceAttempts: s.result.sourceAttempts,
					...(s.result.failure ? { failure: s.result.failure } : {}),
				}));
				const priorEvidence = [...(solved?.result.evidence ?? [])];
				const priorAttempts = [...(solved?.result.sourceAttempts ?? [])];
				const allEvidence = [...priorEvidence, ...completedSteps.flatMap((s) => s.evidence)].filter(
					(e, index, all) => all.findIndex((x) => x.id === e.id) === index,
				);
				const allAttempts = [...priorAttempts, ...completedSteps.flatMap((s) => s.sourceAttempts)];
				const completedWire = completedSteps.map((s) => ({
					step: taskPlanStepWire(s.step),
					execution_index: s.executionIndex,
					summary: s.summary,
					remaining_facts: s.remainingFacts,
					evidence: s.evidence.map(evidenceWire),
					source_attempts: s.sourceAttempts.map(sourceAttemptWire),
					...(s.failure
						? { failure: { code: s.failure.code, operation: s.failure.operation } }
						: {}),
				}));
				let payload: Record<string, unknown> = {};
				if (input.operation === "solve") {
					payload = { max_steps: input.workflow.admission_snapshot.agent_budget.max_plan_steps };
				}
				if (input.operation === "execute_step") {
					payload = {
						plan: structuredOutputWire(input.plan!),
						step: taskPlanStepWire(input.step!),
						completed_steps: completedWire,
						citation_start: input.citationStart,
					};
				}
				if (input.operation === "replan") {
					payload = {
						plan: structuredOutputWire(input.plan!),
						completed_steps: completedWire,
						remaining_steps: (input.remaining ?? []).map(taskPlanStepWire),
						max_remaining_steps: Math.max(
							0,
							input.workflow.admission_snapshot.agent_budget.max_plan_steps - completedSteps.length,
						),
					};
				}
				if (input.operation === "synthesize") {
					payload = {
						mode: input.mode ?? "planned",
						evidence: allEvidence.map(evidenceWire),
						source_attempts: allAttempts.map(sourceAttemptWire),
						remaining_facts: completedSteps
							.filter((s) => s.remainingFacts.length)
							.map((s) => ({ objective: s.step.objective, facts: s.remainingFacts })),
						...(input.recoveryReason ? { recovery_reason: input.recoveryReason } : {}),
					};
				}
				const operationRequest = {
					request_id: requestId,
					conversation_id: input.workflow.conversation_id,
					admission_snapshot: input.workflow.admission_snapshot,
					operation: input.operation,
					step_id: input.key,
					step_kind:
						input.operation === "solve"
							? "solver"
							: input.operation === "replan"
								? "replanner"
								: input.operation === "synthesize"
									? "synthesizer"
									: "executor",
					payload,
					max_steps: input.workflow.admission_snapshot.agent_budget.max_plan_steps,
					prior_evidence: priorEvidence.map(evidenceWire),
					prior_source_attempts: priorAttempts.map(sourceAttemptWire),
					completed_steps: completedWire,
					citation_start: input.citationStart,
					...(input.plan ? { plan: structuredOutputWire(input.plan) } : {}),
					...(input.step ? { step: taskPlanStepWire(input.step) } : {}),
					...(input.operation === "replan"
						? {
								replan_index: input.replanIndex,
								max_remaining_steps: Math.max(
									0,
									input.workflow.admission_snapshot.agent_budget.max_plan_steps -
										completedSteps.length,
								),
								remaining_steps: (input.remaining ?? []).map(taskPlanStepWire),
							}
						: {}),
					...(input.operation === "synthesize"
						? {
								evidence: allEvidence.map(evidenceWire),
								source_attempts: allAttempts.map(sourceAttemptWire),
								mode: input.mode ?? "planned",
								remaining_facts: payload.remaining_facts,
								recovery_reason: input.recoveryReason ?? "",
							}
						: {}),
					stream: input.operation === "synthesize" || input.operation === "solve",
				};
				const preparedRef = `${ref}:prepared`;
				const out = await control.call<{
					prepared: { wire: unknown };
					tool_context: ToolContext;
					created_at: string;
				}>("prepare", {
					request_id: requestId,
					ref: preparedRef,
					operation_request: operationRequest,
				});
				const record = {
					input,
					preparedRef,
					wire: out.prepared.wire,
					toolContext: out.tool_context,
					createdAt: out.created_at,
					startedAt: new Date().toISOString(),
				};
				const signal = executionSignal(record);
				const provider = await modelConfig(record, signal);
				const { model, provider: providerName, transport, hostedWebSearch } = provider;
				await control.save(requestId, ref, {
					...record,
					model: {
						model,
						provider: providerName,
						transport,
						...(hostedWebSearch === undefined ? {} : { hostedWebSearch }),
					},
				} satisfies StageRecord);
				return { ref };
			});
		},
		async modelTurn(input) {
			return heartbeating(async () => {
				const stage = await control.load<StageRecord>(input.requestId, input.stageRef);
				const { prepared } = hydrate(stage);
				const initialContext = createFunctionToolContext(prepared.runnerInput);
				const state = input.stateRef
					? await control.load<TurnState>(input.requestId, input.stateRef)
					: {
							result: emptyResult(),
							citation: initialContext.campusSearch.nextCitationIndex,
							excludedRefs: [...initialContext.campusSearch.resultRefs],
							reserved: 0,
							sequence: 0,
						};
				const invocationId = `${input.requestId}:${stage.input.key}:model:${input.turn}`;
				const ref = `${input.stageRef}:turn:${input.turn}`;
				const identity = {
					request_id: input.requestId,
					invocation_id: invocationId,
					input_sha256: createHash("sha256")
						.update(JSON.stringify({ stageRef: input.stageRef, state }))
						.digest("hex"),
				};
				let claim = await control.call<{ disposition: string; output: TurnRecord | null }>(
					"invocation/get",
					identity,
				);
				let executionPrepared: ReturnType<typeof hydrate> | undefined;
				if (claim.disposition === "new") {
					const signal = executionSignal(stage);
					const provider = await modelConfig(stage, signal);
					executionPrepared = hydrate(stage, signal, provider);
					claim = await control.call("invocation/begin", identity);
				}
				let record: TurnRecord;
				if (claim.disposition === "ambiguous") {
					throw ApplicationFailure.nonRetryable(
						"Model invocation outcome is unknown",
						"workflow_attempt_uncertain",
					);
				}
				if (claim.disposition === "replay") {
					record = claim.output!;
				} else {
					const { prepared } = executionPrepared!;
					let raw = "";
					let emitted = "";
					let sequence = state.sequence;
					const onDelta = stage.input.bufferAnswer
						? undefined
						: async (delta: string) => {
								raw += delta;
								let text: string | undefined;
								if (stage.input.operation === "solve" && /"outcome"\s*:\s*"answer"/u.test(raw)) {
									text = partialJSONStringField(raw, "answer") ?? undefined;
								}
								if (stage.input.operation === "synthesize") {
									text = raw;
								}
								if (text?.startsWith(emitted) && text.length > emitted.length) {
									sequence++;
									await control.call("answer/delta", {
										request_id: input.requestId,
										invocation_id: `${input.requestId}:answer`,
										sequence,
										delta: text.slice(emitted.length),
									});
									emitted = text;
								}
							};
					const publishDeltas =
						stage.input.operation === "synthesize" ||
						(stage.input.operation === "solve" &&
							(stage.wire as { model_answer_transport?: string }).model_answer_transport ===
								"stream");
					let turn: ModelTurn;
					try {
						turn =
							prepared.runnerInput.providerConfig.provider === "google" ||
							prepared.runnerInput.providerConfig.provider === "gemini"
								? await runGeminiModelTurn(
										prepared.runnerInput,
										state.continuation,
										publishDeltas ? onDelta : undefined,
										{
											...(options.resolveSources ? { resolveSources: options.resolveSources } : {}),
										},
									)
								: await runOpenAIModelTurn(
										prepared.runnerInput,
										state.continuation,
										publishDeltas ? onDelta : undefined,
									);
					} catch (error) {
						Context.current().cancellationSignal.throwIfAborted();
						const failure = agentRuntimeErrorPayload(
							error,
							prepared.runnerInput.signal ? { deadlineSignal: prepared.runnerInput.signal } : {},
						);
						Context.current().log.warn("Model invocation failed", {
							request_id: input.requestId,
							invocation_id: invocationId,
							...agentRuntimeErrorLogFields(error, failure),
						});
						turn = {
							calls: [],
							continuation: state.continuation ?? { provider: "openai", items: [] },
							result: {
								...emptyResult(),
								failure: {
									code: failure.code,
									operation: failure.operation,
									...(failure.detail ? { detail: failure.detail } : {}),
									...(failure.http_status === undefined ? {} : { httpStatus: failure.http_status }),
									...(failure.reason ? { reason: failure.reason } : {}),
									...(failure.citation ? { citation: failure.citation } : {}),
									invocationId,
								},
								usage: { ...emptyResult().usage, modelRequestCount: 1 },
							},
						};
					}
					state.result = mergeResult(state.result, turn.result);
					state.sequence = sequence;
					if (emitted) {
						state.result.answerStarted = true;
					}
					record = { state, turn, completedAt: new Date().toISOString(), turnIndex: input.turn };
					await control.call("invocation/complete", {
						request_id: input.requestId,
						invocation_id: invocationId,
						payload: record,
					});
				}
				await control.save(input.requestId, ref, record);
				return {
					ref,
					calls: record.turn.calls.map((c, index) => ({ index, name: c.name })),
					done: record.turn.calls.length === 0,
				};
			});
		},
		async executeTool(input) {
			return heartbeating(async () => {
				const stage = await control.load<StageRecord>(input.requestId, input.stageRef);
				const record = await control.load<TurnRecord>(input.requestId, input.turnRef);
				const call = record.turn.calls[input.index];
				if (!call) {
					throw ApplicationFailure.nonRetryable("Tool index is invalid", "tool_contract_mismatch");
				}
				const ref = `${input.turnRef}:tool:${input.index}`;
				if (await control.maybeLoad(input.requestId, ref)) {
					return { ref };
				}
				const { prepared } = hydrate(stage, executionSignal(stage));
				const tool = prepared.runnerInput.tools.find((t) => t.name === call.name);
				if (!tool) {
					throw ApplicationFailure.nonRetryable(
						"Model called unavailable tool",
						"tool_contract_mismatch",
					);
				}
				const ctx = createFunctionToolContext(prepared.runnerInput);
				ctx.campusSearch.nextCitationIndex = record.state.citation;
				ctx.campusSearch.resultRefs = new Set(record.state.excludedRefs);
				ctx.functionToolBudget.reserved = record.state.reserved;
				for (const priorRef of input.priorToolRefs) {
					const prior = await control.load<{
						context: { citation: number; excludedRefs: string[]; reserved: number };
					}>(input.requestId, priorRef);
					ctx.campusSearch.nextCitationIndex = prior.context.citation;
					ctx.campusSearch.resultRefs = new Set(prior.context.excludedRefs);
					ctx.functionToolBudget.reserved = prior.context.reserved;
				}
				const id = `${stage.input.key}:turn:${record.turnIndex}:tool:${input.index}`;
				if (
					tool.parameters &&
					!z
						.fromJSONSchema(tool.parameters as Parameters<typeof z.fromJSONSchema>[0])
						.safeParse(call.arguments).success
				) {
					throw ApplicationFailure.nonRetryable(
						"Invalid function arguments",
						"tool_contract_mismatch",
					);
				}
				try {
					await invokeFunctionTool(tool, call.arguments, ctx, id);
				} catch (error) {
					if (error instanceof AgentRuntimeError) {
						throw ApplicationFailure.nonRetryable(error.message, error.code);
					}
					throw error;
				}
				const result = { ...ctx.functionToolResults.get(id)!, activity: currentActivityMetadata() };
				await control.save(input.requestId, ref, {
					result,
					context: {
						citation: ctx.campusSearch.nextCitationIndex,
						excludedRefs: [...ctx.campusSearch.resultRefs],
						reserved: ctx.functionToolBudget.reserved,
					},
				});
				return { ref };
			});
		},
		async completeTurn(input) {
			return heartbeating(async () => {
				const record = await control.load<TurnRecord>(input.requestId, input.turnRef);
				const results = await Promise.all(
					input.toolRefs.map((ref) =>
						control.load<{
							result: ToolExecutionResult;
							context: { citation: number; excludedRefs: string[]; reserved: number };
						}>(input.requestId, ref),
					),
				);
				const latest = results.at(-1)?.context;
				const state: TurnState = {
					...record.state,
					completedAt: record.completedAt,
					...(latest ?? {}),
					continuation: continueWithTools(
						record.turn,
						results.map((r) => r.result),
					),
					result: {
						...record.state.result,
						toolResults: [...record.state.result.toolResults, ...results.map((r) => r.result)],
					},
				};
				const ref = `${input.turnRef}:continuation`;
				await control.save(input.requestId, ref, state);
				return { ref };
			});
		},
		async completeStage(input) {
			return heartbeating(async () => {
				const stage = await control.load<StageRecord>(input.requestId, input.stageRef);
				const ref = `${input.stageRef}:result`;
				const saved = await control.maybeLoad<SavedStage>(input.requestId, ref);
				if (saved) {
					return saved.decision;
				}
				const loaded = await control.load<TurnRecord | TurnState>(input.requestId, input.turnRef);
				const record =
					"turn" in loaded
						? loaded
						: { state: loaded, completedAt: loaded.completedAt!, turnIndex: 0 };
				if (input.failureCode) {
					record.state.result = {
						...record.state.result,
						failure: { code: input.failureCode, operation: `workflow.${stage.input.operation}` },
					};
				}
				const { input: runtimeInput, prepared } = hydrate(stage);
				const localResult = normalizeStageResult(
					runtimeInput,
					operationResultFromRunner({
						input: runtimeInput,
						prepared,
						runnerResult: record.state.result,
						startedAt: new Date(stage.startedAt),
						completedAt: new Date(record.completedAt),
						toolContractFingerprint: catalog.contractFingerprint,
					}),
					stage.input.workflow.admission_snapshot,
				);
				const projected = await control.call<{ ref: string }>("project", {
					request_id: input.requestId,
					ref: stage.preparedRef,
					payload: agentRunResultWire(localResult, options.release),
					completed_at: record.completedAt,
				});
				const result: StageResult = {
					operation: localResult.operation,
					status: localResult.status,
					finalOutput: localResult.finalOutput,
					...(localResult.solveOutcome === undefined
						? {}
						: { solveOutcome: localResult.solveOutcome }),
					...(localResult.plan === undefined ? {} : { plan: localResult.plan }),
					...(localResult.replan === undefined ? {} : { replan: localResult.replan }),
					...(localResult.remainingFacts === undefined
						? {}
						: { remainingFacts: localResult.remainingFacts }),
					...(localResult.failure === undefined ? {} : { failure: localResult.failure }),
					evidence: localResult.evidence,
					sourceAttempts: localResult.sourceAttempts,
					usage: localResult.usage,
					// project emits the buffered solve answer before acknowledging completion.
					answerStarted:
						localResult.answerStarted === true ||
						(localResult.status === "completed" && localResult.solveOutcome === "answer"),
				};
				if (
					result.status === "completed" &&
					localResult.answerStarted &&
					(result.operation === "synthesize" || result.solveOutcome === "answer")
				) {
					await control.call("answer/completed", {
						request_id: input.requestId,
						invocation_id: `${input.requestId}:answer`,
					});
				}
				const evidence = result.evidence;
				const decision: StageDecision = {
					ref,
					status: result.status,
					...(result.solveOutcome ? { solveOutcome: result.solveOutcome } : {}),
					...(result.plan ? { plan: result.plan } : {}),
					...(result.replan ? { replan: result.replan } : {}),
					remainingFacts: result.remainingFacts ?? [],
					evidenceCount: evidence.length,
					nextCitation: Math.max(
						stage.input.citationStart,
						...evidence.map((e) => (e.citationIndex ?? 0) + 1),
					),
					sourceSucceeded: result.sourceAttempts.some(
						(a) =>
							a.status !== "failed" ||
							[
								"campus_search_failed",
								"campus_search_timeout",
								"personal_memory_recall_failed",
								"retrieval_budget_exhausted",
							].includes(a.failureCode ?? ""),
					),
					sourceAttempts: result.sourceAttempts,
					...(result.failure ? { failureCode: result.failure.code } : {}),
					answerStarted: result.answerStarted === true,
				};
				await control.save(input.requestId, ref, {
					input: stage.input,
					result,
					controlRef: projected.ref,
					decision,
				} satisfies SavedStage);
				return decision;
			});
		},
		async finalizeAnswer(input) {
			return heartbeating(async () => {
				const saved = await control.load<SavedStage>(input.workflow.request_id, input.ref);
				await control.call("finalize", {
					request_id: input.workflow.request_id,
					ref: saved.controlRef,
					operation_request: { admission_snapshot: input.workflow.admission_snapshot },
				});
			});
		},
		async finalizeFailure(input) {
			return heartbeating(async () => {
				await control.call("terminal", {
					request_id: input.workflow.request_id,
					payload: { code: input.code, canceled: input.canceled, stage: input.stage },
				});
			});
		},
	};
}
