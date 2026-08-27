import { boolean, index, integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

const runtime = pgSchema("runtime");

export const requestObservabilityFact = runtime.table(
	"request_observability_fact",
	{
		requestId: text("request_id").primaryKey(),
		safetyIdentifier: text("safety_identifier"),
		conversationId: text("conversation_id").notNull(),
		surface: text("surface").notNull(),
		principalType: text("principal_type").notNull(),
		entitlementSnapshotId: text("entitlement_snapshot_id"),
		policyReason: text("policy_reason"),
		status: text("status").notNull(),
		errorCode: text("error_code"),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		durationMs: integer("duration_ms"),
		aclDecision: text("acl_decision"),
		aclAnomalyCode: text("acl_anomaly_code"),
		failClosed: boolean("fail_closed"),
		stageTimingJson: jsonb("stage_timing_json")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		modelProvider: text("model_provider"),
		modelName: text("model_name"),
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
