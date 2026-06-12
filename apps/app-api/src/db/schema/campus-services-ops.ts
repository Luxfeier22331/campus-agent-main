import { index, integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

import type {
	CampusServicesOpsActor,
	CampusServicesOpsCurrentEffectiveSnapshot,
} from "../../modules/campus-services-ops";

const campusServicesOps = pgSchema("campus_services_ops");

export const campusServicesOpsSourceAttestations = campusServicesOps.table(
	"source_attestations",
	{
		attestationId: text("attestation_id").primaryKey(),
		sourceType: text("source_type").notNull(),
		summary: text("summary").notNull(),
		operatorNotes: text("operator_notes"),
		confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull(),
		status: text("status").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		createdByJson: jsonb("created_by_json").$type<CampusServicesOpsActor>().notNull(),
	},
	(table) => ({
		confirmedAtIndex: index("campus_services_ops_attestations_confirmed_at_idx").on(
			table.confirmedAt,
		),
		sourceTypeConfirmedAtIndex: index("campus_services_ops_attestations_source_confirmed_idx").on(
			table.sourceType,
			table.confirmedAt,
		),
	}),
);

export const campusServicesOpsStatusOverrides = campusServicesOps.table(
	"status_overrides",
	{
		overrideId: text("override_id").primaryKey(),
		serviceId: text("service_id").notNull(),
		displayName: text("display_name").notNull(),
		status: text("status").notNull(),
		message: text("message").notNull(),
		effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
		effectiveUntil: timestamp("effective_until", { withTimezone: true }).notNull(),
		sourceAttestationIdsJson: jsonb("source_attestation_ids_json")
			.$type<string[]>()
			.notNull()
			.default([]),
		reviewState: text("review_state").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		createdByJson: jsonb("created_by_json").$type<CampusServicesOpsActor>().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		updatedByJson: jsonb("updated_by_json").$type<CampusServicesOpsActor>().notNull(),
	},
	(table) => ({
		effectiveWindowIndex: index("campus_services_ops_status_effective_window_idx").on(
			table.effectiveFrom,
			table.effectiveUntil,
		),
		reviewStateUpdatedAtIndex: index("campus_services_ops_status_review_updated_idx").on(
			table.reviewState,
			table.updatedAt,
		),
		serviceUpdatedAtIndex: index("campus_services_ops_status_service_updated_idx").on(
			table.serviceId,
			table.updatedAt,
		),
	}),
);

export const campusServicesOpsTransportOverrides = campusServicesOps.table(
	"transport_overrides",
	{
		overrideId: text("override_id").primaryKey(),
		routeId: text("route_id").notNull(),
		displayName: text("display_name").notNull(),
		serviceStatus: text("service_status").notNull(),
		message: text("message").notNull(),
		effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
		effectiveUntil: timestamp("effective_until", { withTimezone: true }).notNull(),
		sourceAttestationIdsJson: jsonb("source_attestation_ids_json")
			.$type<string[]>()
			.notNull()
			.default([]),
		reviewState: text("review_state").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		createdByJson: jsonb("created_by_json").$type<CampusServicesOpsActor>().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		updatedByJson: jsonb("updated_by_json").$type<CampusServicesOpsActor>().notNull(),
	},
	(table) => ({
		effectiveWindowIndex: index("campus_services_ops_transport_effective_window_idx").on(
			table.effectiveFrom,
			table.effectiveUntil,
		),
		reviewStateUpdatedAtIndex: index("campus_services_ops_transport_review_updated_idx").on(
			table.reviewState,
			table.updatedAt,
		),
		routeUpdatedAtIndex: index("campus_services_ops_transport_route_updated_idx").on(
			table.routeId,
			table.updatedAt,
		),
	}),
);

export const campusServicesOpsReleases = campusServicesOps.table(
	"releases",
	{
		releaseId: text("release_id").primaryKey(),
		status: text("status").notNull(),
		notes: text("notes"),
		itemCount: integer("item_count").notNull(),
		currentEffectiveJson: jsonb("current_effective_json")
			.$type<CampusServicesOpsCurrentEffectiveSnapshot>()
			.notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		createdByJson: jsonb("created_by_json").$type<CampusServicesOpsActor>().notNull(),
		publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
		publishedByJson: jsonb("published_by_json").$type<CampusServicesOpsActor>().notNull(),
	},
	(table) => ({
		publishedAtIndex: index("campus_services_ops_releases_published_at_idx").on(table.publishedAt),
	}),
);

export const campusServicesOpsAuditEvents = campusServicesOps.table(
	"audit_events",
	{
		auditEventId: text("audit_event_id").primaryKey(),
		action: text("action").notNull(),
		objectType: text("object_type").notNull(),
		objectId: text("object_id").notNull(),
		summary: text("summary").notNull(),
		beforeJson: jsonb("before_json").$type<Record<string, unknown> | null>(),
		afterJson: jsonb("after_json").$type<Record<string, unknown> | null>(),
		actorJson: jsonb("actor_json").$type<CampusServicesOpsActor>().notNull(),
		occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		actionOccurredAtIndex: index("campus_services_ops_audit_action_occurred_idx").on(
			table.action,
			table.occurredAt,
		),
		objectOccurredAtIndex: index("campus_services_ops_audit_object_occurred_idx").on(
			table.objectType,
			table.objectId,
			table.occurredAt,
		),
	}),
);
