import { z } from "zod";
import type { LlmDebugTraceConfig, RawCapturePolicy } from "./debug-trace.ts";
import {
	agentRunResultWire,
	agentRunStreamResponse,
	authorized,
	errorMessage,
	jsonResponse,
} from "./http-response.ts";
import type { PrimaryAgentRunResult, PrimaryAgentRuntime } from "./primary-agent.ts";

const providerConfigSchema = z.object({
	profile_id: z.string().min(1).optional(),
	revision: z.number().int().nonnegative().optional(),
	provider: z.string().min(1),
	transport: z.enum(["responses", "chat_completions"]),
	base_url: z.string().min(1).optional(),
	model: z.string().min(1),
	api_key: z.string().min(1),
	timeout_ms: z.number().int().positive().optional(),
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

const allowedKnowledgeScopeSchema = z.object({
	scope: z.string().min(1),
	description: z.string().min(1),
	allowed_query_modes: z.array(z.string().min(1)).default([]),
});

const truncationSummarySchema = z.object({
	schema_version: z.literal("truncation_summary.v1"),
	policy_version: z.string().min(1),
	reason: z.string().min(1),
	model_visible_before_count: z.number().int().nonnegative(),
	model_visible_after_count: z.number().int().nonnegative(),
	runtime_only_before_count: z.number().int().nonnegative(),
	runtime_only_after_count: z.number().int().nonnegative(),
	token_estimate_before: z.number().int().nonnegative(),
	token_estimate_after: z.number().int().nonnegative(),
	dropped_category_counts: z.record(z.string().min(1), z.number().int().nonnegative()),
});

const finalModelContextSchema = z.object({
	schema_version: z.literal("final_model_context.v1"),
	current_user_message: z.string().min(1),
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
			}),
		)
		.default([]),
	usage_summary: z.object({
		memory_recall_state: z.enum(["completed", "skipped"]),
		model_visible_item_count: z.number().int().nonnegative(),
		runtime_only_item_count: z.number().int().nonnegative(),
		token_estimate: z.number().int().nonnegative(),
		truncation_reason: z.string().min(1).optional(),
		truncation_summary: truncationSummarySchema.optional(),
	}),
});

const rawCapturePolicySchema = z
	.object({
		schema_version: z.literal("raw_capture_policy.v1"),
		mode: z.enum([
			"off",
			"sampled",
			"failure_triggered",
			"operator_window",
			"eval_case",
			"manual_run_capture",
		]),
		capture_reason: z.string().min(1),
		ttl_days: z.number().int().nonnegative(),
		allowed_sinks: z
			.array(z.enum(["s3_replay_packet", "langfuse_otlp", "openai_agents_trace"]))
			.default([]),
		allowed_raw_fields: z
			.array(
				z.enum([
					"rendered_messages",
					"provider_request_body",
					"provider_response_body",
					"provider_stream_deltas",
					"tool_calls",
					"tool_results",
					"selected_evidence_packet",
					"selected_memory_context",
					"output_schema",
				]),
			)
			.default([]),
		operator_principal: z.string().min(1).nullable().optional(),
		approval_ref: z.string().min(1).nullable().optional(),
		request_id: z.string().min(1).nullable().optional(),
		run_id: z.string().min(1).nullable().optional(),
		trace_id: z.string().min(1).nullable().optional(),
		audit_required: z.boolean(),
		dsar_delete_linkage_required: z.boolean(),
	})
	.superRefine((policy, context) => {
		const uniqueSinks = new Set(policy.allowed_sinks);
		if (uniqueSinks.size !== policy.allowed_sinks.length) {
			context.addIssue({
				code: "custom",
				message: "raw_capture_policy.allowed_sinks must not contain duplicates",
				path: ["allowed_sinks"],
			});
		}
		const uniqueFields = new Set(policy.allowed_raw_fields);
		if (uniqueFields.size !== policy.allowed_raw_fields.length) {
			context.addIssue({
				code: "custom",
				message: "raw_capture_policy.allowed_raw_fields must not contain duplicates",
				path: ["allowed_raw_fields"],
			});
		}
		if (policy.mode === "off") {
			if (
				policy.ttl_days !== 0 ||
				policy.allowed_sinks.length > 0 ||
				policy.allowed_raw_fields.length > 0 ||
				(policy.operator_principal !== undefined && policy.operator_principal !== null) ||
				(policy.approval_ref !== undefined && policy.approval_ref !== null) ||
				(policy.request_id !== undefined && policy.request_id !== null) ||
				(policy.run_id !== undefined && policy.run_id !== null) ||
				(policy.trace_id !== undefined && policy.trace_id !== null) ||
				policy.audit_required ||
				policy.dsar_delete_linkage_required
			) {
				context.addIssue({
					code: "custom",
					message: "raw_capture_policy mode off must not admit raw capture",
				});
			}
			return;
		}
		if (policy.ttl_days <= 0) {
			context.addIssue({
				code: "custom",
				message: "raw_capture_policy.ttl_days must be positive when mode is not off",
				path: ["ttl_days"],
			});
		}
		if (policy.allowed_sinks.length === 0) {
			context.addIssue({
				code: "custom",
				message: "raw_capture_policy.allowed_sinks must not be empty when mode is not off",
				path: ["allowed_sinks"],
			});
		}
		if (policy.allowed_raw_fields.length === 0) {
			context.addIssue({
				code: "custom",
				message: "raw_capture_policy.allowed_raw_fields must not be empty when mode is not off",
				path: ["allowed_raw_fields"],
			});
		}
		if (!policy.operator_principal) {
			context.addIssue({
				code: "custom",
				message: "raw_capture_policy.operator_principal is required when mode is not off",
				path: ["operator_principal"],
			});
		}
		if (!policy.approval_ref) {
			context.addIssue({
				code: "custom",
				message: "raw_capture_policy.approval_ref is required when mode is not off",
				path: ["approval_ref"],
			});
		}
		for (const field of ["request_id", "run_id", "trace_id"] as const) {
			if (!policy[field]) {
				context.addIssue({
					code: "custom",
					message: `raw_capture_policy.${field} is required when mode is not off`,
					path: [field],
				});
			}
		}
		if (!(policy.audit_required && policy.dsar_delete_linkage_required)) {
			context.addIssue({
				code: "custom",
				message: "raw_capture_policy requires audit and deletion linkage when mode is not off",
			});
		}
	});

const debugTraceBaseSchema = z.object({
	schema_version: z.literal("llm_debug_trace_config.v1"),
	include_model_io: z.boolean(),
	sample_ratio: z.number().min(0).max(1),
	raw_capture_policy: rawCapturePolicySchema.optional(),
});

const debugTraceConfigSchema = z
	.discriminatedUnion("mode", [
		debugTraceBaseSchema.extend({
			mode: z.literal("off"),
		}),
		debugTraceBaseSchema.extend({
			mode: z.literal("langfuse_otlp"),
			langfuse_otlp: z.object({
				endpoint: z.string().min(1),
				auth_header: z.string().min(1).startsWith("Basic "),
				public_trace_base_url: z.string().min(1).optional(),
			}),
		}),
	])
	.superRefine((config, context) => {
		if (!config.include_model_io) {
			return;
		}
		if (!config.raw_capture_policy || config.raw_capture_policy.mode === "off") {
			context.addIssue({
				code: "custom",
				message: "include_model_io=true requires admitted raw_capture_policy",
				path: ["raw_capture_policy"],
			});
			return;
		}
		if (
			!config.raw_capture_policy.allowed_sinks.some(
				(sink) => sink === "openai_agents_trace" || sink === "langfuse_otlp",
			)
		) {
			context.addIssue({
				code: "custom",
				message: "include_model_io=true requires model IO raw capture sink",
				path: ["raw_capture_policy", "allowed_sinks"],
			});
		}
		if (
			!config.raw_capture_policy.allowed_raw_fields.some(
				(field) =>
					field === "rendered_messages" ||
					field === "provider_request_body" ||
					field === "provider_response_body" ||
					field === "provider_stream_deltas",
			)
		) {
			context.addIssue({
				code: "custom",
				message: "include_model_io=true requires raw model IO field",
				path: ["raw_capture_policy", "allowed_raw_fields"],
			});
		}
	});

const runRequestSchema = z
	.object({
		run_id: z.string().min(1),
		request_id: z.string().min(1),
		conversation_id: z.string().min(1),
		turn_id: z.string().min(1),
		trace_id: z.string().min(1),
		input: z.string().min(1),
		visible_tool_names: z.array(z.string().min(1)).default([]),
		allowed_knowledge_scopes: z.array(allowedKnowledgeScopeSchema).optional(),
		tool_choice: z.literal("knowledge_query").optional(),
		provider_config: providerConfigSchema,
		debug_trace_config: debugTraceConfigSchema.optional(),
		final_model_context: finalModelContextSchema.optional(),
		memory_context: memoryContextSchema.optional(),
		memory_projection_refs: z.array(z.string().min(1)).optional(),
	})
	.superRefine((request, context) => {
		const policy = request.debug_trace_config?.raw_capture_policy;
		if (!policy || policy.mode === "off") {
			return;
		}
		const checks = [
			{ actual: policy.request_id, expected: request.request_id, field: "request_id" },
			{ actual: policy.run_id, expected: request.run_id, field: "run_id" },
			{ actual: policy.trace_id, expected: request.trace_id, field: "trace_id" },
		];
		for (const check of checks) {
			if (check.actual !== check.expected) {
				context.addIssue({
					code: "custom",
					message: `raw_capture_policy.${check.field} must match run request`,
					path: ["debug_trace_config", "raw_capture_policy", check.field],
				});
			}
		}
	});

function mapTruncationSummary(summary: z.infer<typeof truncationSummarySchema> | undefined) {
	if (!summary) {
		return;
	}
	return {
		droppedCategoryCounts: summary.dropped_category_counts,
		modelVisibleAfterCount: summary.model_visible_after_count,
		modelVisibleBeforeCount: summary.model_visible_before_count,
		policyVersion: summary.policy_version,
		reason: summary.reason,
		runtimeOnlyAfterCount: summary.runtime_only_after_count,
		runtimeOnlyBeforeCount: summary.runtime_only_before_count,
		schemaVersion: summary.schema_version,
		tokenEstimateAfter: summary.token_estimate_after,
		tokenEstimateBefore: summary.token_estimate_before,
	};
}

function mapAllowedKnowledgeScopes(
	scopes: z.infer<typeof allowedKnowledgeScopeSchema>[] | undefined,
) {
	return scopes?.map((scope) => ({
		allowedQueryModes: [...scope.allowed_query_modes],
		description: scope.description,
		scope: scope.scope,
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
		if (request.method === "GET" && url.pathname === "/readyz") {
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
					error: {
						code: "invalid_request",
						message: error instanceof Error ? error.message : "Invalid request body.",
					},
				});
			}
			let result: PrimaryAgentRunResult;
			try {
				result = await options.runtime.run({
					runId: parsed.run_id,
					requestId: parsed.request_id,
					conversationId: parsed.conversation_id,
					turnId: parsed.turn_id,
					traceId: parsed.trace_id,
					input: parsed.input,
					visibleToolNames: parsed.visible_tool_names,
					allowedKnowledgeScopes: mapAllowedKnowledgeScopes(parsed.allowed_knowledge_scopes),
					toolChoice: parsed.tool_choice,
					providerConfig: {
						profileId: parsed.provider_config.profile_id,
						revision: parsed.provider_config.revision,
						provider: parsed.provider_config.provider,
						transport: parsed.provider_config.transport,
						baseUrl: parsed.provider_config.base_url,
						model: parsed.provider_config.model,
						apiKey: parsed.provider_config.api_key,
						timeoutMs: parsed.provider_config.timeout_ms,
					},
					debugTraceConfig: debugTraceConfigFromParsed(parsed.debug_trace_config),
					finalModelContext: parsed.final_model_context
						? {
								schemaVersion: parsed.final_model_context.schema_version,
								currentUserMessage: parsed.final_model_context.current_user_message,
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
								previousToolResults: parsed.final_model_context.previous_tool_results.map(
									(result) => ({
										contentHash: result.content_hash,
										projectionRef: result.projection_ref,
										requestId: result.request_id,
										resultKind: result.result_kind,
										runId: result.run_id,
										status: result.status,
										summary: result.summary,
									}),
								),
								sessionState: parsed.final_model_context.session_state
									? {
											confirmedSlots: parsed.final_model_context.session_state.confirmed_slots.map(
												(slot) => ({
													confirmed: slot.confirmed,
													name: slot.name,
													value: slot.value,
												}),
											),
											selectedNoticeRef: parsed.final_model_context.session_state
												.selected_notice_ref
												? {
														noticeId:
															parsed.final_model_context.session_state.selected_notice_ref
																.notice_id,
														sourceFamily:
															parsed.final_model_context.session_state.selected_notice_ref
																.source_family,
														targetSurface:
															parsed.final_model_context.session_state.selected_notice_ref
																.target_surface,
														title:
															parsed.final_model_context.session_state.selected_notice_ref.title,
													}
												: null,
											turnCount: parsed.final_model_context.session_state.turn_count,
										}
									: undefined,
								usageSummary: {
									memoryRecallState: parsed.final_model_context.usage_summary.memory_recall_state,
									modelVisibleItemCount:
										parsed.final_model_context.usage_summary.model_visible_item_count,
									runtimeOnlyItemCount:
										parsed.final_model_context.usage_summary.runtime_only_item_count,
									tokenEstimate: parsed.final_model_context.usage_summary.token_estimate,
									truncationReason: parsed.final_model_context.usage_summary.truncation_reason,
									truncationSummary: mapTruncationSummary(
										parsed.final_model_context.usage_summary.truncation_summary,
									),
								},
							}
						: undefined,
					memoryContext: parsed.memory_context
						? {
								contextBlock: parsed.memory_context.context_block,
								memoryRef: parsed.memory_context.memory_ref,
								provider: parsed.memory_context.provider,
								retrievalMode: parsed.memory_context.retrieval_mode,
								schemaVersion: parsed.memory_context.schema_version,
								selectedMemoryChars: parsed.memory_context.selected_memory_chars,
								selectedMemoryCount: parsed.memory_context.selected_memory_count,
							}
						: undefined,
					memoryProjectionRefs: parsed.memory_projection_refs,
					signal: request.signal,
				});
			} catch (error) {
				return jsonResponse(500, {
					error: {
						code: "agent_runtime_failed",
						message: errorMessage(error),
					},
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
					error: {
						code: "invalid_request",
						message: error instanceof Error ? error.message : "Invalid request body.",
					},
				});
			}
			return agentRunStreamResponse(
				options.runtime.stream(runtimeInputFromParsedRunRequest(parsed, request.signal)),
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
		runId: parsed.run_id,
		requestId: parsed.request_id,
		conversationId: parsed.conversation_id,
		turnId: parsed.turn_id,
		traceId: parsed.trace_id,
		input: parsed.input,
		visibleToolNames: parsed.visible_tool_names,
		allowedKnowledgeScopes: mapAllowedKnowledgeScopes(parsed.allowed_knowledge_scopes),
		toolChoice: parsed.tool_choice,
		providerConfig: {
			profileId: parsed.provider_config.profile_id,
			revision: parsed.provider_config.revision,
			provider: parsed.provider_config.provider,
			transport: parsed.provider_config.transport,
			baseUrl: parsed.provider_config.base_url,
			model: parsed.provider_config.model,
			apiKey: parsed.provider_config.api_key,
			timeoutMs: parsed.provider_config.timeout_ms,
		},
		debugTraceConfig: debugTraceConfigFromParsed(parsed.debug_trace_config),
		finalModelContext: parsed.final_model_context
			? {
					schemaVersion: parsed.final_model_context.schema_version,
					currentUserMessage: parsed.final_model_context.current_user_message,
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
					usageSummary: {
						memoryRecallState: parsed.final_model_context.usage_summary.memory_recall_state,
						modelVisibleItemCount:
							parsed.final_model_context.usage_summary.model_visible_item_count,
						runtimeOnlyItemCount: parsed.final_model_context.usage_summary.runtime_only_item_count,
						tokenEstimate: parsed.final_model_context.usage_summary.token_estimate,
						truncationReason: parsed.final_model_context.usage_summary.truncation_reason,
						truncationSummary: mapTruncationSummary(
							parsed.final_model_context.usage_summary.truncation_summary,
						),
					},
				}
			: undefined,
		memoryContext: parsed.memory_context
			? {
					contextBlock: parsed.memory_context.context_block,
					memoryRef: parsed.memory_context.memory_ref,
					provider: parsed.memory_context.provider,
					retrievalMode: parsed.memory_context.retrieval_mode,
					schemaVersion: parsed.memory_context.schema_version,
					selectedMemoryChars: parsed.memory_context.selected_memory_chars,
					selectedMemoryCount: parsed.memory_context.selected_memory_count,
				}
			: undefined,
		memoryProjectionRefs: parsed.memory_projection_refs,
		signal,
	};
}

function debugTraceConfigFromParsed(
	value: z.infer<typeof debugTraceConfigSchema> | undefined,
): LlmDebugTraceConfig | undefined {
	if (!value) {
		return;
	}
	if (value.mode === "off") {
		return {
			includeModelIo: value.include_model_io,
			mode: value.mode,
			rawCapturePolicy: rawCapturePolicyFromParsed(value.raw_capture_policy),
			sampleRatio: value.sample_ratio,
			schemaVersion: value.schema_version,
		};
	}
	return {
		includeModelIo: value.include_model_io,
		langfuseOtlp: {
			authHeader: value.langfuse_otlp.auth_header,
			endpoint: value.langfuse_otlp.endpoint,
			publicTraceBaseUrl: value.langfuse_otlp.public_trace_base_url,
		},
		mode: value.mode,
		rawCapturePolicy: rawCapturePolicyFromParsed(value.raw_capture_policy),
		sampleRatio: value.sample_ratio,
		schemaVersion: value.schema_version,
	};
}

function rawCapturePolicyFromParsed(
	value: z.infer<typeof rawCapturePolicySchema> | undefined,
): RawCapturePolicy | undefined {
	if (!value) {
		return;
	}
	return {
		...value,
		approval_ref: value.approval_ref ?? null,
		operator_principal: value.operator_principal ?? null,
		request_id: value.request_id ?? null,
		run_id: value.run_id ?? null,
		trace_id: value.trace_id ?? null,
	};
}
