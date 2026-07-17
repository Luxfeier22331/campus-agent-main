import { boolean, index, integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

const dining = pgSchema("dining");
const timestamps = {
	createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
};

export const diningHalls = dining.table("halls", {
	campus: text("campus").notNull(),
	hallId: text("hall_id").primaryKey(),
	name: text("name").notNull(),
	status: text("status").notNull().default("active"),
	...timestamps,
});

export const diningFloors = dining.table(
	"floors",
	{
		floorId: text("floor_id").primaryKey(),
		hallId: text("hall_id").notNull(),
		label: text("label").notNull(),
		floorplanId: text("floorplan_id").notNull(),
		floorplanKind: text("floorplan_kind").notNull(),
		sortKey: text("sort_key").notNull(),
		...timestamps,
	},
	(table) => [index("dining_floors_hall_idx").on(table.hallId)],
);

export const diningWindows = dining.table(
	"windows",
	{
		windowId: text("window_id").primaryKey(),
		hallId: text("hall_id").notNull(),
		floorId: text("floor_id").notNull(),
		label: text("label").notNull(),
		locationLabel: text("location_label").notNull(),
		svgAnchorId: text("svg_anchor_id"),
		tagsJson: jsonb("tags_json").$type<string[]>().notNull().default([]),
		status: text("status").notNull().default("active"),
		...timestamps,
	},
	(table) => [index("dining_windows_floor_idx").on(table.hallId, table.floorId)],
);

export const diningStallProfiles = dining.table("stall_profiles", {
	stallProfileId: text("stall_profile_id").primaryKey(),
	displayName: text("display_name").notNull(),
	stallType: text("stall_type").notNull(),
	tagsJson: jsonb("tags_json").$type<string[]>().notNull().default([]),
	status: text("status").notNull().default("active"),
	...timestamps,
});

export const diningWindowAssignments = dining.table(
	"window_assignments",
	{
		assignmentId: text("assignment_id").primaryKey(),
		windowId: text("window_id").notNull(),
		stallProfileId: text("stall_profile_id").notNull(),
		status: text("status").notNull().default("active"),
		...timestamps,
	},
	(table) => [index("dining_assignments_window_idx").on(table.windowId)],
);

export const diningMenuItems = dining.table("menu_items", {
	menuItemId: text("menu_item_id").primaryKey(),
	name: text("name").notNull(),
	tagsJson: jsonb("tags_json").$type<string[]>().notNull().default([]),
	status: text("status").notNull().default("active"),
	...timestamps,
});

export const diningMenuOfferings = dining.table(
	"menu_offerings",
	{
		offeringId: text("offering_id").primaryKey(),
		assignmentId: text("assignment_id").notNull(),
		menuItemId: text("menu_item_id").notNull(),
		priceLabel: text("price_label"),
		...timestamps,
	},
	(table) => [index("dining_offerings_assignment_idx").on(table.assignmentId)],
);

export const diningCatalogState = dining.table("catalog_state", {
	scope: text("scope").primaryKey(),
	draftRevision: integer("draft_revision").notNull(),
	baseReleaseId: text("base_release_id"),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	updatedBy: text("updated_by").notNull(),
});

export const diningReleases = dining.table(
	"releases",
	{
		releaseId: text("release_id").primaryKey(),
		predecessorReleaseId: text("predecessor_release_id"),
		rollbackOfReleaseId: text("rollback_of_release_id"),
		draftRevision: integer("draft_revision").notNull(),
		notes: text("notes").notNull(),
		snapshotHash: text("snapshot_hash").notNull(),
		payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
		validationJson: jsonb("validation_json").$type<Record<string, unknown>>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		createdBy: text("created_by").notNull(),
	},
	(table) => [index("dining_releases_created_idx").on(table.createdAt)],
);

export const diningPublication = dining.table("publication", {
	scope: text("scope").primaryKey(),
	catalogReleaseId: text("catalog_release_id"),
	reviewRevision: integer("review_revision").notNull().default(0),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const diningReviews = dining.table(
	"reviews",
	{
		reviewId: text("review_id").primaryKey(),
		sourceRecordId: text("source_record_id").notNull(),
		campus: text("campus").notNull(),
		hallName: text("hall_name").notNull(),
		stallName: text("stall_name").notNull(),
		dishName: text("dish_name").notNull(),
		paidPriceLabel: text("paid_price_label"),
		rating: integer("rating"),
		comment: text("comment"),
		contributorName: text("contributor_name"),
		imagesJson: jsonb("images_json").$type<Record<string, unknown>[]>().notNull().default([]),
		submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
		moderationStatus: text("moderation_status").notNull(),
		visibility: text("visibility").notNull(),
		hallId: text("hall_id"),
		stallProfileId: text("stall_profile_id"),
		windowId: text("window_id"),
		offeringId: text("offering_id"),
		publishedAt: timestamp("published_at", { withTimezone: true }),
		...timestamps,
	},
	(table) => [
		index("dining_reviews_offering_idx").on(table.offeringId, table.visibility, table.submittedAt),
		index("dining_reviews_source_idx").on(table.sourceRecordId),
	],
);

export const diningReviewOverrides = dining.table("review_overrides", {
	reviewId: text("review_id").primaryKey(),
	offeringId: text("offering_id"),
	visibility: text("visibility"),
	reason: text("reason").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	updatedBy: text("updated_by").notNull(),
});

export const diningCatalogOverrides = dining.table(
	"catalog_overrides",
	{
		overrideId: text("override_id").primaryKey(),
		targetKind: text("target_kind").notNull(),
		targetId: text("target_id").notNull(),
		patchJson: jsonb("patch_json").$type<Record<string, unknown>>().notNull(),
		reason: text("reason").notNull(),
		active: boolean("active").notNull().default(true),
		...timestamps,
		updatedBy: text("updated_by").notNull(),
	},
	(table) => [index("dining_catalog_overrides_target_idx").on(table.targetKind, table.targetId)],
);

export const diningSourceObservations = dining.table(
	"source_observations",
	{
		observationId: text("observation_id").primaryKey(),
		sourceType: text("source_type").notNull(),
		sourceBaseToken: text("source_base_token"),
		sourceTableId: text("source_table_id"),
		sourceRecordId: text("source_record_id"),
		targetKind: text("target_kind").notNull(),
		targetId: text("target_id"),
		payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
		contentHash: text("content_hash").notNull(),
		status: text("status").notNull(),
		observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
		firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
		lastSeenRunId: text("last_seen_run_id").notNull(),
		staleAt: timestamp("stale_at", { withTimezone: true }),
	},
	(table) => [
		index("dining_observations_source_idx").on(table.sourceType, table.status, table.staleAt),
	],
);

export const diningSourceSyncRuns = dining.table(
	"source_sync_runs",
	{
		runId: text("run_id").primaryKey(),
		sourceType: text("source_type").notNull(),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		status: text("status").notNull(),
		totalCount: integer("total_count").notNull(),
		acceptedCount: integer("accepted_count").notNull(),
		blockedCount: integer("blocked_count").notNull(),
		staleCount: integer("stale_count").notNull().default(0),
		errorMessage: text("error_message"),
	},
	(table) => [index("dining_sync_runs_started_idx").on(table.sourceType, table.startedAt)],
);

export const diningReviewRecheckRequests = dining.table(
	"review_recheck_requests",
	{
		requestId: text("request_id").primaryKey(),
		reviewId: text("review_id").notNull(),
		status: text("status").notNull(),
		requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
		requestedBy: text("requested_by").notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		errorMessage: text("error_message"),
	},
	(table) => [index("dining_review_recheck_status_idx").on(table.status, table.requestedAt)],
);

export const diningOperationEvents = dining.table(
	"operation_events",
	{
		eventId: text("event_id").primaryKey(),
		action: text("action").notNull(),
		actorId: text("actor_id").notNull(),
		objectKind: text("object_kind").notNull(),
		objectId: text("object_id").notNull(),
		summaryJson: jsonb("summary_json").$type<Record<string, unknown>>().notNull(),
		occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
	},
	(table) => [index("dining_operation_events_occurred_idx").on(table.occurredAt)],
);
