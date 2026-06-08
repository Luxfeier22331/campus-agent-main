import { boolean, index, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

const dining = pgSchema("dining");

export const diningHalls = dining.table("halls", {
	campus: text("campus").notNull(),
	hallId: text("hall_id").primaryKey(),
	name: text("name").notNull(),
	status: text("status").notNull().default("active"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const diningFloors = dining.table(
	"floors",
	{
		floorId: text("floor_id").primaryKey(),
		hallId: text("hall_id").notNull(),
		label: text("label").notNull(),
		svgAssetUrl: text("svg_asset_url").notNull(),
		sortKey: text("sort_key").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		hallIndex: index("dining_floors_hall_idx").on(table.hallId),
	}),
);

export const diningWindows = dining.table(
	"windows",
	{
		windowId: text("window_id").primaryKey(),
		hallId: text("hall_id").notNull(),
		floorId: text("floor_id").notNull(),
		label: text("label").notNull(),
		locationLabel: text("location_label").notNull(),
		geometryJson: jsonb("geometry_json").$type<Record<string, unknown>>().notNull(),
		tagsJson: jsonb("tags_json").$type<string[]>().notNull().default([]),
		status: text("status").notNull().default("active"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		floorIndex: index("dining_windows_floor_idx").on(table.hallId, table.floorId),
		statusIndex: index("dining_windows_status_idx").on(table.status),
	}),
);

export const diningStallProfiles = dining.table(
	"stall_profiles",
	{
		stallProfileId: text("stall_profile_id").primaryKey(),
		displayName: text("display_name").notNull(),
		stallType: text("stall_type").notNull(),
		tagsJson: jsonb("tags_json").$type<string[]>().notNull().default([]),
		status: text("status").notNull().default("active"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		statusIndex: index("dining_stall_profiles_status_idx").on(table.status),
	}),
);

export const diningWindowAssignments = dining.table(
	"window_assignments",
	{
		assignmentId: text("assignment_id").primaryKey(),
		windowId: text("window_id").notNull(),
		stallProfileId: text("stall_profile_id").notNull(),
		status: text("status").notNull().default("active"),
		effectiveFrom: timestamp("effective_from", { withTimezone: true }),
		effectiveTo: timestamp("effective_to", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		windowStatusIndex: index("dining_window_assignments_window_status_idx").on(
			table.windowId,
			table.status,
		),
		stallProfileIndex: index("dining_window_assignments_stall_profile_idx").on(
			table.stallProfileId,
		),
	}),
);

export const diningMenuItems = dining.table(
	"menu_items",
	{
		menuItemId: text("menu_item_id").primaryKey(),
		name: text("name").notNull(),
		tagsJson: jsonb("tags_json").$type<string[]>().notNull().default([]),
		status: text("status").notNull().default("active"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		nameIndex: index("dining_menu_items_name_idx").on(table.name),
		statusIndex: index("dining_menu_items_status_idx").on(table.status),
	}),
);

export const diningMenuOfferings = dining.table(
	"menu_offerings",
	{
		offeringId: text("offering_id").primaryKey(),
		assignmentId: text("assignment_id").notNull(),
		menuItemId: text("menu_item_id").notNull(),
		priceLabel: text("price_label").notNull(),
		specLabel: text("spec_label"),
		saleStatus: text("sale_status").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		assignmentIndex: index("dining_menu_offerings_assignment_idx").on(table.assignmentId),
		menuItemIndex: index("dining_menu_offerings_menu_item_idx").on(table.menuItemId),
	}),
);

export const diningSourceObservations = dining.table(
	"source_observations",
	{
		observationId: text("observation_id").primaryKey(),
		sourceType: text("source_type").notNull(),
		targetKind: text("target_kind").notNull(),
		targetId: text("target_id"),
		payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
		status: text("status").notNull(),
		observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
		reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
		reviewedBy: text("reviewed_by"),
	},
	(table) => ({
		statusObservedIndex: index("dining_source_observations_status_observed_idx").on(
			table.status,
			table.observedAt,
		),
		targetIndex: index("dining_source_observations_target_idx").on(
			table.targetKind,
			table.targetId,
		),
	}),
);

export const diningReleases = dining.table(
	"releases",
	{
		releaseId: text("release_id").primaryKey(),
		notes: text("notes").notNull(),
		status: text("status").notNull(),
		published: boolean("published").notNull().default(false),
		publishedAt: timestamp("published_at", { withTimezone: true }),
		publishedBy: text("published_by"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		createdBy: text("created_by").notNull(),
	},
	(table) => ({
		statusCreatedIndex: index("dining_releases_status_created_idx").on(
			table.status,
			table.createdAt,
		),
		publishedIndex: index("dining_releases_published_idx").on(table.published, table.publishedAt),
	}),
);

export const diningReleaseSnapshots = dining.table(
	"release_snapshots",
	{
		snapshotId: text("snapshot_id").primaryKey(),
		releaseId: text("release_id").notNull(),
		payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		releaseIndex: index("dining_release_snapshots_release_idx").on(table.releaseId),
	}),
);

export const diningAuditEvents = dining.table(
	"audit_events",
	{
		auditEventId: text("audit_event_id").primaryKey(),
		action: text("action").notNull(),
		actorDisplayName: text("actor_display_name").notNull(),
		actorPrincipalId: text("actor_principal_id").notNull(),
		objectId: text("object_id").notNull(),
		objectKind: text("object_kind").notNull(),
		afterJson: jsonb("after_json").$type<Record<string, unknown> | null>(),
		beforeJson: jsonb("before_json").$type<Record<string, unknown> | null>(),
		occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		actionOccurredIndex: index("dining_audit_events_action_occurred_idx").on(
			table.action,
			table.occurredAt,
		),
		objectOccurredIndex: index("dining_audit_events_object_occurred_idx").on(
			table.objectKind,
			table.objectId,
			table.occurredAt,
		),
	}),
);
