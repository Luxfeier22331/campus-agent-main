import { z } from "zod";
import {
	agentRunResultWire,
	agentRunStreamResponse,
	authorized,
	jsonResponse,
} from "./http-response.ts";
import type { PrimaryAgentRunResult, PrimaryAgentRuntime } from "./primary-agent.ts";
import { agentRuntimeErrorPayload } from "./runtime-errors.ts";

const providerConfigSchema = z.object({
	profile_id: z.string().min(1).optional(),
	revision: z.number().int().nonnegative().optional(),
	provider: z.string().min(1),
	transport: z.enum(["responses", "chat_completions"]),
	base_url: z.string().min(1).optional(),
	model: z.string().min(1),
	api_key: z.string().min(1),
});

const memoryContextSchema = z.object({
	context_block: z.string().min(1),
	memory_ref: z.string().min(1),
	provider: z.string().min(1).optional(),
	retrieval_mode: z.string().min(1).optional(),
	schema_version: z.literal("memory_recall_result_v1"),
	selected_memory_chars: z.number().int().nonnegative(),
	selected_memory_count: z.number().int().nonnegative(),
});

const knowledgeTargetSchema = z.object({
	target: z.string().min(1),
	description: z.string().min(1),
});

const truncationSummarySchema = z.object({
	schema_version: z.literal("truncation_summary.v2"),
	policy_version: z.string().min(1),
	reason: z.string().min(1),
	context_chars_before: z.number().int().nonnegative(),
	context_chars_after: z.number().int().nonnegative(),
	model_visible_before_count: z.number().int().nonnegative(),
	model_visible_after_count: z.number().int().nonnegative(),
	runtime_only_before_count: z.number().int().nonnegative(),
	runtime_only_after_count: z.number().int().nonnegative(),
	dropped_category_counts: z.record(z.string().min(1), z.number().int().nonnegative()),
});

const finalModelContextSchema = z.object({
	schema_version: z.literal("final_model_context.v2"),
	recent_turns: z
		.array(
			z.object({
				message_id: z.string().min(1).optional(),
				role: z.enum(["assistant", "user"]),
				content: z.string().min(1),
			}),
		)
		.default([]),
	previous_evidence: z
		.array(
			z.object({
				access_scope: z.string().min(1),
				content_hash: z.string().min(1),
				document_id: z.string().min(1).optional(),
				evidence_id: z.string().min(1),
				section_title: z.string().min(1).optional(),
				snapshot_id: z.string().min(1).optional(),
				snippet: z.string().optional(),
				source_id: z.string().min(1),
				title: z.string().optional(),
				version_id: z.string().min(1).optional(),
			}),
		)
		.default([]),
	session_state: z
		.object({
			confirmed_slots: z
				.array(
					z.object({
						confirmed: z.boolean(),
						name: z.string().min(1),
						value: z.string().min(1),
					}),
				)
				.default([]),
			selected_notice_ref: z
				.object({
					notice_id: z.string().min(1),
					source_family: z.string().optional(),
					target_surface: z.string().optional(),
					title: z.string().optional(),
				})
				.nullable()
				.optional(),
			turn_count: z.number().int().nonnegative(),
		})
		.optional(),
	previous_tool_results: z
		.array(
			z.object({
				content_hash: z.string().min(1),
				projection_ref: z.string().min(1),
				request_id: z.string().min(1),
				result_kind: z.string().min(1),
				run_id: z.string().min(1),
				status: z.string().min(1),
				summary: z.string().optional(),
				tool: z.string().min(1),
			}),
		)
		.default([]),
	memory_context: memoryContextSchema.optional(),
	usage_summary: z.object({
		context_chars: z.number().int().nonnegative(),
		current_input_chars: z.number().int().nonnegative(),
		memory_recall_state: z.enum(["completed", "skipped"]),
		model_visible_item_count: z.number().int().nonnegative(),
		runtime_only_item_count: z.number().int().nonnegative(),
		truncation_reason: z.string().min(1).optional(),
		truncation_summary: truncationSummarySchema.optional(),
	}),
});

const runtimeLimitsSchema = z
	.object({
		agent_deadline_ms: z.number().int().positive(),
		context_char_limit: z.number().int().positive(),
		current_input_char_limit: z.number().int().positive(),
		max_knowledge_searches: z.number().int().positive().max(3),
		max_output_tokens: z.number().int().positive(),
		max_turns: z.number().int().positive(),
	})
	.strict();

const runRequestSchema = z
	.object({
		activity_attempt: z.number().int().positive(),
		run_id: z.string().min(1),
		request_id: z.string().min(1),
		conversation_id: z.string().min(1),
		turn_id: z.string().min(1),
		trace_id: z.string().min(1),
		input: z.string().min(1),
		visible_tool_names: z.array(z.string().min(1)).default([]),
		knowledge_targets: z.array(knowledgeTargetSchema).optional(),
		tool_choice: z.literal("knowledge_query").optional(),
		provider_config: providerConfigSchema,
		limits: runtimeLimitsSchema,
		final_model_context: finalModelContextSchema.optional(),
	})
	.strict()
	.superRefine((value, context) => {
		if ([...value.input].length > value.limits.current_input_char_limit) {
			context.addIssue({
				code: "custom",
				message: "input exceeds limits.current_input_char_limit",
				path: ["input"],
			});
		}
		if (
			value.final_model_context &&
			finalModelContextCharacterCount(value.final_model_context) > value.limits.context_char_limit
		) {
			context.addIssue({
				code: "custom",
				message: "final_model_context exceeds limits.context_char_limit",
				path: ["final_model_context"],
			});
		}
	});

function finalModelContextCharacterCount(context: z.infer<typeof finalModelContextSchema>): number {
	const { usage_summary: _usageSummary, ...modelContext } = context;
	return [...JSON.stringify(modelContext)].length;
}

function mapTruncationSummary(summary: z.infer<typeof truncationSummarySchema> | undefined) {
	if (!summary) {
		return;
	}
	return {
		contextCharsAfter: summary.context_chars_after,
		contextCharsBefore: summary.context_chars_before,
		droppedCategoryCounts: summary.dropped_category_counts,
		modelVisibleAfterCount: summary.model_visible_after_count,
		modelVisibleBeforeCount: summary.model_visible_before_count,
		policyVersion: summary.policy_version,
		reason: summary.reason,
		runtimeOnlyAfterCount: summary.runtime_only_after_count,
		runtimeOnlyBeforeCount: summary.runtime_only_before_count,
		schemaVersion: summary.schema_version,
	};
}

function mapKnowledgeTargets(targets: z.infer<typeof knowledgeTargetSchema>[] | undefined) {
	return targets?.map((target) => ({
		description: target.description,
		target: target.target,
	}));
}

export interface AgentRuntimeHandlerOptions {
	sharedSecret: string;
	runtime: PrimaryAgentRuntime;
}

export type AgentRuntimeHandler = (request: Request) => Promise<Response>;

export function createAgentRuntimeHandler(
	options: AgentRuntimeHandlerOptions,
): AgentRuntimeHandler {
	return async (request) => {
		const url = new URL(request.url);
		if (request.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/readyz")) {
			return jsonResponse(200, { status: "ok" });
		}
		if (request.method === "POST" && url.pathname === "/internal/agent-runs") {
			if (!authorized(request, options.sharedSecret)) {
				return jsonResponse(401, {
					error: {
						code: "unauthorized",
						message: "Internal worker authorization failed.",
					},
				});
			}
			let parsed: z.infer<typeof runRequestSchema>;
			try {
				parsed = runRequestSchema.parse(await request.json());
			} catch (error) {
				return jsonResponse(400, {
					error: requestValidationError(error),
				});
			}
			const signals = runtimeSignals(request.signal, parsed.limits.agent_deadline_ms);
			let result: PrimaryAgentRunResult;
			try {
				result = await options.runtime.run(
					runtimeInputFromParsedRunRequest(parsed, signals.signal),
				);
			} catch (error) {
				return jsonResponse(500, {
					error: agentRuntimeErrorPayload(error, { deadlineSignal: signals.deadlineSignal }),
				});
			}
			return jsonResponse(200, agentRunResultWire(result));
		}
		if (request.method === "POST" && url.pathname === "/internal/agent-runs/stream") {
			if (!authorized(request, options.sharedSecret)) {
				return jsonResponse(401, {
					error: {
						code: "unauthorized",
						message: "Internal worker authorization failed.",
					},
				});
			}
			let parsed: z.infer<typeof runRequestSchema>;
			try {
				parsed = runRequestSchema.parse(await request.json());
			} catch (error) {
				return jsonResponse(400, {
					error: requestValidationError(error),
				});
			}
			const signals = runtimeSignals(request.signal, parsed.limits.agent_deadline_ms);
			return agentRunStreamResponse(
				options.runtime.stream(runtimeInputFromParsedRunRequest(parsed, signals.signal)),
				{ deadlineSignal: signals.deadlineSignal },
			);
		}
		return jsonResponse(404, {
			error: {
				code: "not_found",
				message: "Route not found.",
			},
		});
	};
}

function runtimeInputFromParsedRunRequest(
	parsed: z.infer<typeof runRequestSchema>,
	signal: AbortSignal,
): Parameters<PrimaryAgentRuntime["run"]>[0] {
	return {
		activityAttempt: parsed.activity_attempt,
		runId: parsed.run_id,
		requestId: parsed.request_id,
		conversationId: parsed.conversation_id,
		turnId: parsed.turn_id,
		traceId: parsed.trace_id,
		input: parsed.input,
		visibleToolNames: parsed.visible_tool_names,
		knowledgeTargets: mapKnowledgeTargets(parsed.knowledge_targets),
		toolChoice: parsed.tool_choice,
		providerConfig: {
			profileId: parsed.provider_config.profile_id,
			revision: parsed.provider_config.revision,
			provider: parsed.provider_config.provider,
			transport: parsed.provider_config.transport,
			baseUrl: parsed.provider_config.base_url,
			model: parsed.provider_config.model,
			apiKey: parsed.provider_config.api_key,
		},
		limits: {
			agentDeadlineMs: parsed.limits.agent_deadline_ms,
			contextCharLimit: parsed.limits.context_char_limit,
			currentInputCharLimit: parsed.limits.current_input_char_limit,
			maxKnowledgeSearches: parsed.limits.max_knowledge_searches,
			maxOutputTokens: parsed.limits.max_output_tokens,
			maxTurns: parsed.limits.max_turns,
		},
		finalModelContext: parsed.final_model_context
			? {
					schemaVersion: parsed.final_model_context.schema_version,
					recentTurns: parsed.final_model_context.recent_turns.map((turn) => ({
						messageId: turn.message_id,
						role: turn.role,
						content: turn.content,
					})),
					previousEvidence: parsed.final_model_context.previous_evidence.map((evidence) => ({
						accessScope: evidence.access_scope,
						contentHash: evidence.content_hash,
						documentId: evidence.document_id,
						evidenceId: evidence.evidence_id,
						sectionTitle: evidence.section_title,
						snapshotId: evidence.snapshot_id,
						snippet: evidence.snippet,
						sourceId: evidence.source_id,
						title: evidence.title,
						versionId: evidence.version_id,
					})),
					previousToolResults: parsed.final_model_context.previous_tool_results.map((result) => ({
						contentHash: result.content_hash,
						projectionRef: result.projection_ref,
						requestId: result.request_id,
						resultKind: result.result_kind,
						runId: result.run_id,
						status: result.status,
						summary: result.summary,
						tool: result.tool,
					})),
					sessionState: parsed.final_model_context.session_state
						? {
								confirmedSlots: parsed.final_model_context.session_state.confirmed_slots.map(
									(slot) => ({
										confirmed: slot.confirmed,
										name: slot.name,
										value: slot.value,
									}),
								),
								selectedNoticeRef: parsed.final_model_context.session_state.selected_notice_ref
									? {
											noticeId:
												parsed.final_model_context.session_state.selected_notice_ref.notice_id,
											sourceFamily:
												parsed.final_model_context.session_state.selected_notice_ref.source_family,
											targetSurface:
												parsed.final_model_context.session_state.selected_notice_ref.target_surface,
											title: parsed.final_model_context.session_state.selected_notice_ref.title,
										}
									: null,
								turnCount: parsed.final_model_context.session_state.turn_count,
							}
						: undefined,
					memoryContext: parsed.final_model_context.memory_context
						? {
								contextBlock: parsed.final_model_context.memory_context.context_block,
								memoryRef: parsed.final_model_context.memory_context.memory_ref,
								provider: parsed.final_model_context.memory_context.provider,
								retrievalMode: parsed.final_model_context.memory_context.retrieval_mode,
								schemaVersion: parsed.final_model_context.memory_context.schema_version,
								selectedMemoryChars:
									parsed.final_model_context.memory_context.selected_memory_chars,
								selectedMemoryCount:
									parsed.final_model_context.memory_context.selected_memory_count,
							}
						: undefined,
					usageSummary: {
						contextChars: parsed.final_model_context.usage_summary.context_chars,
						currentInputChars: parsed.final_model_context.usage_summary.current_input_chars,
						memoryRecallState: parsed.final_model_context.usage_summary.memory_recall_state,
						modelVisibleItemCount:
							parsed.final_model_context.usage_summary.model_visible_item_count,
						runtimeOnlyItemCount: parsed.final_model_context.usage_summary.runtime_only_item_count,
						truncationReason: parsed.final_model_context.usage_summary.truncation_reason,
						truncationSummary: mapTruncationSummary(
							parsed.final_model_context.usage_summary.truncation_summary,
						),
					},
				}
			: undefined,
		signal,
	};
}

function requestValidationError(error: unknown) {
	const contextBudgetExceeded =
		error instanceof z.ZodError &&
		error.issues.some(
			(issue) =>
				issue.code === "custom" &&
				(issue.path[0] === "input" || issue.path[0] === "final_model_context"),
		);
	return {
		code: contextBudgetExceeded ? "context_budget_exceeded" : "invalid_request",
		message: error instanceof Error ? error.message : "Invalid request body.",
		retryable: false,
	};
}

function runtimeSignals(parent: AbortSignal, deadlineMs: number) {
	const deadlineSignal = AbortSignal.timeout(deadlineMs);
	return {
		deadlineSignal,
		signal: AbortSignal.any([parent, deadlineSignal]),
	};
}
