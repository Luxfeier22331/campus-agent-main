import { propagateAttributes } from "@langfuse/tracing";
import { z } from "zod";
import {
	agentRunResultWire,
	agentRunStreamResponse,
	authorized,
	jsonResponse,
} from "./http-response.ts";
import type { PrimaryAgentRunResult, PrimaryAgentRuntime } from "./primary-agent.ts";
import { agentRuntimeErrorPayload } from "./runtime-errors.ts";
import { bindAsyncIterableToActiveContext } from "./telemetry.ts";
import type { ToolRuntimeFingerprint } from "./tool-catalog.ts";

const providerConfigSchema = z.object({
	provider: z.string().min(1),
	transport: z.enum(["responses", "chat_completions"]),
	base_url: z.string().min(1).optional(),
	model: z.string().min(1),
	api_key: z.string().min(1),
});

const toolRuntimeFingerprintSchema = z
	.object({
		combined_sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
		function_schema_sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
		function_schema_version: z.string().min(1),
		runtime_release: z.string().min(1),
		schema_version: z.literal("tool_runtime_fingerprint.v2"),
		tools_registry_version: z.string().min(1),
		tools_schema_version: z.string().min(1),
		tools_sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
	})
	.strict();

const sha256RefSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

const groundingEvidenceSchema = z
	.object({
		evidence_ref: z.string().regex(/^evidence:\/\/[0-9a-f]{64}$/),
		document_scope: z.string().trim().min(1),
		release_id: z.string().trim().min(1),
		chunk_id: z.string().trim().min(1),
		section_ref: z.string().trim().min(1),
		document_id: z.string().trim().min(1),
		section_id: z.string().trim().min(1),
		document_title: z.string().trim().min(1),
		section_title: z.string().trim().min(1),
		canonical_url: z.string().trim().min(1),
		text: z.string().trim().min(1),
		text_sha256: sha256RefSchema,
		token_count: z.number().int().positive().max(4096),
		rerank_score: z.number().min(0).max(1),
	})
	.strict();

const groundingContextSchema = z
	.object({
		schema_version: z.literal("grounding_context.v2"),
		run_id: z.string().trim().min(1),
		admission_sha256: sha256RefSchema,
		plan_sha256: z.string().regex(/^[0-9a-f]{64}$/),
		query_sha256: sha256RefSchema,
		prepared_at: z.string().datetime(),
		mode: z.enum(["none", "single_scope", "multi_scope"]),
		selected_scopes: z.array(z.string().trim().min(1)).max(32),
		covered_scopes: z.array(z.string().trim().min(1)).max(32),
		status: z.enum(["not_required", "ready", "partial", "empty"]),
		token_count: z.number().int().nonnegative().max(4096),
		model_context_chars: z.number().int().nonnegative(),
		evidence: z.array(groundingEvidenceSchema).max(8),
	})
	.strict()
	.superRefine((value, context) => {
		if (new Set(value.selected_scopes).size !== value.selected_scopes.length) {
			context.addIssue({
				code: "custom",
				message: "selected_scopes values must be unique",
				path: ["selected_scopes"],
			});
		}
		const coveredScopes = value.selected_scopes.filter((scope) =>
			value.evidence.some((item) => item.document_scope === scope),
		);
		if (JSON.stringify(value.covered_scopes) !== JSON.stringify(coveredScopes)) {
			context.addIssue({
				code: "custom",
				message: "covered_scopes does not match evidence",
				path: ["covered_scopes"],
			});
		}
		const expectedStatus =
			value.mode === "none"
				? "not_required"
				: coveredScopes.length === 0
					? "empty"
					: coveredScopes.length < value.selected_scopes.length
						? "partial"
						: "ready";
		if (value.status !== expectedStatus) {
			context.addIssue({
				code: "custom",
				message: "status does not match evidence",
				path: ["status"],
			});
		}
		const tokenCount = value.evidence.reduce((total, item) => total + item.token_count, 0);
		if (value.token_count !== tokenCount) {
			context.addIssue({
				code: "custom",
				message: "token_count does not match evidence",
				path: ["token_count"],
			});
		}
		if (new Set(value.evidence.map((item) => item.evidence_ref)).size !== value.evidence.length) {
			context.addIssue({
				code: "custom",
				message: "evidence_ref values must be unique",
				path: ["evidence"],
			});
		}
		if (
			(value.mode === "none" && value.selected_scopes.length > 0) ||
			(value.mode === "single_scope" && value.selected_scopes.length !== 1) ||
			(value.mode === "multi_scope" && value.selected_scopes.length < 2)
		) {
			context.addIssue({
				code: "custom",
				message: "mode does not match selected_scopes",
				path: ["mode"],
			});
		}
		if (value.evidence.some((item) => !value.selected_scopes.includes(item.document_scope))) {
			context.addIssue({
				code: "custom",
				message: "evidence document_scope must be selected",
				path: ["evidence"],
			});
		}
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
	schema_version: z.literal("final_model_context.v3"),
	recent_turns: z
		.array(
			z.object({
				message_id: z.string().min(1).optional(),
				role: z.enum(["assistant", "user"]),
				content: z.string().min(1),
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
	usage_summary: z.object({
		context_chars: z.number().int().nonnegative(),
		current_input_chars: z.number().int().nonnegative(),
		grounding_context_chars: z.number().int().nonnegative(),
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
		max_output_tokens: z.number().int().positive(),
		max_tool_calls: z.number().int().nonnegative(),
		max_turns: z.number().int().positive(),
	})
	.strict();

const runRequestSchema = z
	.object({
		activity_attempt: z.number().int().positive(),
		allow_ungrounded_answer: z.boolean(),
		user_id: z.string().min(1),
		run_id: z.string().min(1),
		request_id: z.string().min(1),
		conversation_id: z.string().min(1),
		turn_id: z.string().min(1),
		trace_id: z.string().min(1),
		input: z.string().min(1),
		visible_tool_names: z.array(z.string().min(1)).default([]),
		grounding_context: groundingContextSchema,
		expected_tool_runtime_fingerprint: toolRuntimeFingerprintSchema,
		provider_config: providerConfigSchema,
		limits: runtimeLimitsSchema,
		final_model_context: finalModelContextSchema.optional(),
	})
	.strict()
	.superRefine((value, context) => {
		if (value.grounding_context.run_id !== value.run_id) {
			context.addIssue({
				code: "custom",
				message: "grounding_context.run_id must match run_id",
				path: ["grounding_context", "run_id"],
			});
		}
		if ([...value.input].length > value.limits.current_input_char_limit) {
			context.addIssue({
				code: "custom",
				message: "input exceeds limits.current_input_char_limit",
				path: ["input"],
			});
		}
		const currentInputChars = [...value.input].length;
		if (
			value.final_model_context &&
			(value.final_model_context.usage_summary.current_input_chars !== currentInputChars ||
				value.final_model_context.usage_summary.grounding_context_chars !==
					value.grounding_context.model_context_chars)
		) {
			context.addIssue({
				code: "custom",
				message: "final_model_context usage does not match current input and grounding",
				path: ["final_model_context", "usage_summary"],
			});
		}
		if (
			value.final_model_context &&
			finalModelContextCharacterCount(value.final_model_context) +
				currentInputChars +
				value.grounding_context.model_context_chars >
				value.limits.context_char_limit
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

function mapTruncationSummary(summary: z.infer<typeof truncationSummarySchema>) {
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

function mapGroundingContext(value: z.infer<typeof groundingContextSchema>) {
	return {
		admissionSha256: value.admission_sha256,
		coveredScopes: value.covered_scopes,
		evidence: value.evidence.map((item) => ({
			canonicalUrl: item.canonical_url,
			chunkId: item.chunk_id,
			documentId: item.document_id,
			documentScope: item.document_scope,
			documentTitle: item.document_title,
			evidenceRef: item.evidence_ref,
			releaseId: item.release_id,
			rerankScore: item.rerank_score,
			sectionId: item.section_id,
			sectionRef: item.section_ref,
			sectionTitle: item.section_title,
			text: item.text,
			textSha256: item.text_sha256,
			tokenCount: item.token_count,
		})),
		mode: value.mode,
		modelContextChars: value.model_context_chars,
		planSha256: value.plan_sha256,
		preparedAt: value.prepared_at,
		querySha256: value.query_sha256,
		runId: value.run_id,
		schemaVersion: value.schema_version,
		selectedScopes: value.selected_scopes,
		status: value.status,
		tokenCount: value.token_count,
	};
}

function mapToolRuntimeFingerprint(
	fingerprint: z.infer<typeof toolRuntimeFingerprintSchema>,
): ToolRuntimeFingerprint {
	return {
		combinedSha256: fingerprint.combined_sha256,
		functionSchemaSha256: fingerprint.function_schema_sha256,
		functionSchemaVersion:
			fingerprint.function_schema_version as ToolRuntimeFingerprint["functionSchemaVersion"],
		runtimeRelease: fingerprint.runtime_release,
		schemaVersion: fingerprint.schema_version,
		toolsRegistryVersion: fingerprint.tools_registry_version,
		toolsSchemaVersion:
			fingerprint.tools_schema_version as ToolRuntimeFingerprint["toolsSchemaVersion"],
		toolsSha256: fingerprint.tools_sha256,
	};
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
		if (request.method === "GET" && url.pathname === "/healthz") {
			return jsonResponse(200, { status: "ok" });
		}
		if (request.method === "GET" && url.pathname === "/readyz") {
			return options.sharedSecret
				? jsonResponse(200, { status: "ready" })
				: jsonResponse(503, {
						error: {
							code: "dependency_not_ready",
							message: "Agent runtime authorization is not configured.",
						},
					});
		}
		if (request.method === "GET" && url.pathname === "/internal/readyz") {
			if (!authorized(request, options.sharedSecret)) {
				return jsonResponse(401, {
					error: {
						code: "unauthorized",
						message: "Internal worker authorization failed.",
					},
				});
			}
			return jsonResponse(200, { status: "ready" });
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
				result = await withAgentTraceAttributes(parsed, () =>
					options.runtime.run(runtimeInputFromParsedRunRequest(parsed, signals.signal)),
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
			return withAgentTraceAttributes(parsed, () =>
				agentRunStreamResponse(
					bindAsyncIterableToActiveContext(
						options.runtime.stream(runtimeInputFromParsedRunRequest(parsed, signals.signal)),
					),
					{ deadlineSignal: signals.deadlineSignal },
				),
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

function withAgentTraceAttributes<T>(
	parsed: z.infer<typeof runRequestSchema>,
	callback: () => T,
): T {
	return propagateAttributes(
		{
			asBaggage: false,
			metadata: {
				request_id: parsed.request_id,
				run_id: parsed.run_id,
				trace_id: parsed.trace_id,
				turn_id: parsed.turn_id,
			},
			sessionId: parsed.conversation_id,
			tags: ["surface:agent-runtime"],
			traceName: "online-answer",
			userId: parsed.user_id,
		},
		callback,
	);
}

function runtimeInputFromParsedRunRequest(
	parsed: z.infer<typeof runRequestSchema>,
	signal: AbortSignal,
): Parameters<PrimaryAgentRuntime["run"]>[0] {
	return {
		activityAttempt: parsed.activity_attempt,
		allowUngroundedAnswer: parsed.allow_ungrounded_answer,
		runId: parsed.run_id,
		requestId: parsed.request_id,
		conversationId: parsed.conversation_id,
		turnId: parsed.turn_id,
		traceId: parsed.trace_id,
		input: parsed.input,
		visibleToolNames: parsed.visible_tool_names,
		groundingContext: mapGroundingContext(parsed.grounding_context),
		expectedToolRuntimeFingerprint: mapToolRuntimeFingerprint(
			parsed.expected_tool_runtime_fingerprint,
		),
		providerConfig: {
			provider: parsed.provider_config.provider,
			transport: parsed.provider_config.transport,
			...(parsed.provider_config.base_url ? { baseUrl: parsed.provider_config.base_url } : {}),
			model: parsed.provider_config.model,
			apiKey: parsed.provider_config.api_key,
		},
		limits: {
			agentDeadlineMs: parsed.limits.agent_deadline_ms,
			contextCharLimit: parsed.limits.context_char_limit,
			currentInputCharLimit: parsed.limits.current_input_char_limit,
			maxOutputTokens: parsed.limits.max_output_tokens,
			maxToolCalls: parsed.limits.max_tool_calls,
			maxTurns: parsed.limits.max_turns,
		},
		...(parsed.final_model_context
			? {
					finalModelContext: {
						schemaVersion: parsed.final_model_context.schema_version,
						recentTurns: parsed.final_model_context.recent_turns.map((turn) => ({
							...(turn.message_id ? { messageId: turn.message_id } : {}),
							role: turn.role,
							content: turn.content,
						})),
						...(parsed.final_model_context.session_state
							? {
									sessionState: {
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
													...(parsed.final_model_context.session_state.selected_notice_ref
														.source_family
														? {
																sourceFamily:
																	parsed.final_model_context.session_state.selected_notice_ref
																		.source_family,
															}
														: {}),
													...(parsed.final_model_context.session_state.selected_notice_ref
														.target_surface
														? {
																targetSurface:
																	parsed.final_model_context.session_state.selected_notice_ref
																		.target_surface,
															}
														: {}),
													...(parsed.final_model_context.session_state.selected_notice_ref.title
														? {
																title:
																	parsed.final_model_context.session_state.selected_notice_ref
																		.title,
															}
														: {}),
												}
											: null,
										turnCount: parsed.final_model_context.session_state.turn_count,
									},
								}
							: {}),
						usageSummary: {
							contextChars: parsed.final_model_context.usage_summary.context_chars,
							currentInputChars: parsed.final_model_context.usage_summary.current_input_chars,
							groundingContextChars:
								parsed.final_model_context.usage_summary.grounding_context_chars,
							modelVisibleItemCount:
								parsed.final_model_context.usage_summary.model_visible_item_count,
							runtimeOnlyItemCount:
								parsed.final_model_context.usage_summary.runtime_only_item_count,
							...(parsed.final_model_context.usage_summary.truncation_reason
								? {
										truncationReason: parsed.final_model_context.usage_summary.truncation_reason,
									}
								: {}),
							...(parsed.final_model_context.usage_summary.truncation_summary
								? {
										truncationSummary: mapTruncationSummary(
											parsed.final_model_context.usage_summary.truncation_summary,
										),
									}
								: {}),
						},
					},
				}
			: {}),
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
		message: contextBudgetExceeded
			? "The agent runtime context exceeded its configured budget."
			: "The agent runtime request is invalid.",
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
