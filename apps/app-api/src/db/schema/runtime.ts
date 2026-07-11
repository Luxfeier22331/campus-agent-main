import {
	boolean,
	index,
	integer,
	jsonb,
	pgSchema,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
	ToolExecutionAnswerEvalFingerprint,
	ToolExecutionDebugTraceRef,
	ToolExecutionLlmIoFingerprint,
	ToolExecutionWorkflowTraceSummary,
} from "../../modules/integration/tool-execution-types";
import type { ObservedSourceTraceEntry } from "../../modules/source-trace";
import type { VersionQuery, VersionQueryMode } from "../../modules/version-query";

const runtime = pgSchema("runtime");

export const requestExecution = runtime.table(
	"request_execution",
	{
		requestId: text("request_id").primaryKey(),
		conversationId: text("conversation_id").notNull(),
		userMessageId: text("user_message_id").notNull(),
		assistantMessageId: text("assistant_message_id"),
		turnSequence: integer("turn_sequence").notNull().default(0),
		surface: text("surface").notNull(),
		actorUserId: text("actor_user_id").notNull(),
		actorPrincipalId: text("actor_principal_id").notNull(),
		actorRolesJson: jsonb("actor_roles_json").$type<string[]>().notNull(),
		actorDepartmentsJson: jsonb("actor_departments_json").$type<string[]>().notNull(),
		principalType: text("principal_type").notNull(),
		principalLabel: text("principal_label"),
		entitlementSnapshotId: text("entitlement_snapshot_id"),
		entitlementGroupsJson: jsonb("entitlement_groups_json").$type<string[]>().notNull().default([]),
		visibilityScope: text("visibility_scope"),
		applicabilityScope: text("applicability_scope"),
		idempotencyKey: text("idempotency_key"),
		requestFingerprintSha256: text("request_fingerprint_sha256"),
		traceId: text("trace_id").notNull(),
		runId: text("run_id"),
		safetyIdentifier: text("safety_identifier"),
		requestedTool: text("requested_tool"),
		requestedScope: text("requested_scope"),
		versionQueryJson: jsonb("version_query_json").$type<VersionQuery | null>(),
		resolvedScope: text("resolved_scope"),
		selectedTool: text("selected_tool"),
		status: text("status").notNull(),
		errorCode: text("error_code"),
		questionPreview: text("question_preview").notNull(),
		answerPreview: text("answer_preview"),
		sourceDocIdsJson: jsonb("source_doc_ids_json").$type<string[] | null>(),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		durationMs: integer("duration_ms"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		conversationStartedAtIndex: index("runtime_request_execution_conversation_started_at_idx").on(
			table.conversationId,
			table.startedAt,
		),
		conversationTurnSequenceIndex: index(
			"runtime_request_execution_conversation_turn_sequence_idx",
		).on(table.conversationId, table.turnSequence),
		statusStartedAtIndex: index("runtime_request_execution_status_started_at_idx").on(
			table.status,
			table.startedAt,
		),
		runStartedAtIndex: index("runtime_request_execution_run_started_at_idx").on(
			table.runId,
			table.startedAt,
		),
		safetyIdentifierStartedAtIndex: index(
			"runtime_request_execution_safety_identifier_started_at_idx",
		).on(table.safetyIdentifier, table.startedAt),
		actorIdempotencyUnique: uniqueIndex("runtime_request_execution_actor_idempotency_idx").on(
			table.actorUserId,
			table.idempotencyKey,
		),
	}),
);

export const projectionOutbox = runtime.table(
	"projection_outbox",
	{
		eventId: text("event_id").primaryKey(),
		requestId: text("request_id").notNull(),
		eventType: text("event_type").notNull(),
		payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
		occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
		availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
		processedAt: timestamp("processed_at", { withTimezone: true }),
		attemptCount: integer("attempt_count").notNull().default(0),
		lastError: text("last_error"),
	},
	(table) => ({
		processedAvailableIndex: index("runtime_projection_outbox_processed_available_idx").on(
			table.processedAt,
			table.availableAt,
		),
		requestOccurredIndex: index("runtime_projection_outbox_request_occurred_idx").on(
			table.requestId,
			table.occurredAt,
		),
	}),
);

export const requestObservabilityFact = runtime.table(
	"request_observability_fact",
	{
		requestId: text("request_id").primaryKey(),
		traceId: text("trace_id").notNull(),
		safetyIdentifier: text("safety_identifier"),
		conversationId: text("conversation_id").notNull(),
		surface: text("surface").notNull(),
		principalType: text("principal_type").notNull(),
		entitlementSnapshotId: text("entitlement_snapshot_id"),
		policyProjectionVersion: text("policy_projection_version"),
		policyReason: text("policy_reason"),
		requestedTool: text("requested_tool"),
		requestedScopeSummary: text("requested_scope_summary"),
		versionQueryMode: text("version_query_mode").$type<VersionQueryMode | null>(),
		versionQuerySummary: text("version_query_summary"),
		resolvedScopeSummary: text("resolved_scope_summary"),
		selectedTool: text("selected_tool"),
		status: text("status").notNull(),
		errorCode: text("error_code"),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		durationMs: integer("duration_ms"),
		supportingSourcesJson: jsonb("supporting_sources_json")
			.$type<ObservedSourceTraceEntry[]>()
			.notNull()
			.default([]),
		refusalClass: text("refusal_class"),
		semanticOutcome: text("semantic_outcome"),
		scopeClass: text("scope_class"),
		aclDecision: text("acl_decision"),
		aclAnomalyCode: text("acl_anomaly_code"),
		failClosed: boolean("fail_closed"),
		workflowTraceSummaryJson: jsonb(
			"workflow_trace_summary_json",
		).$type<ToolExecutionWorkflowTraceSummary | null>(),
		stageTimingJson: jsonb("stage_timing_json")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		debugTraceRefsJson: jsonb("debug_trace_refs_json")
			.$type<ToolExecutionDebugTraceRef[]>()
			.notNull()
			.default([]),
		answerEvalFingerprintJson: jsonb(
			"answer_eval_fingerprint_json",
		).$type<ToolExecutionAnswerEvalFingerprint | null>(),
		llmIoFingerprintJson: jsonb(
			"llm_io_fingerprint_json",
		).$type<ToolExecutionLlmIoFingerprint | null>(),
		modelProvider: text("model_provider"),
		modelName: text("model_name"),
		promptId: text("prompt_id"),
		promptVersion: text("prompt_version"),
		templateSha256: text("template_sha256"),
		traceAvailable: boolean("trace_available").notNull().default(false),
		projectionLagMs: integer("projection_lag_ms"),
		measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		startedAtIndex: index("runtime_request_observability_started_at_idx").on(table.startedAt),
		statusStartedAtIndex: index("runtime_request_observability_status_started_at_idx").on(
			table.status,
			table.startedAt,
		),
		surfaceStartedAtIndex: index("runtime_request_observability_surface_started_at_idx").on(
			table.surface,
			table.startedAt,
		),
		selectedToolStartedAtIndex: index(
			"runtime_request_observability_selected_tool_started_at_idx",
		).on(table.selectedTool, table.startedAt),
		principalTypeStartedAtIndex: index(
			"runtime_request_observability_principal_type_started_at_idx",
		).on(table.principalType, table.startedAt),
		modelNameStartedAtIndex: index("runtime_request_observability_model_name_started_at_idx").on(
			table.modelName,
			table.startedAt,
		),
		safetyIdentifierStartedAtIndex: index(
			"runtime_request_observability_safety_identifier_started_at_idx",
		).on(table.safetyIdentifier, table.startedAt),
	}),
);
