import { boolean, index, integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";
import type { ToolExecutionWorkflowTraceSummary } from "../../modules/integration/tool-execution-types";
import type { ObservedSourceTraceEntry } from "../../modules/source-trace";

const runtime = pgSchema("runtime");

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
		resolvedTargetsJson: jsonb("resolved_targets_json").$type<string[]>().notNull().default([]),
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
