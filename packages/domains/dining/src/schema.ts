import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgSchema,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";

export const dining = pgSchema("dining");
const timestamps = {
	createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
};

export const diningHalls = dining.table(
	"halls",
	{
		campus: text("campus").notNull(),
		hallId: text("hall_id").primaryKey(),
		name: text("name").notNull(),
		status: text("status").notNull().default("active"),
		...timestamps,
	},
	(table) => [check("dining_halls_status_check", sql`${table.status} = 'active'`)],
);

export const diningFloors = dining.table(
	"floors",
	{
		floorId: text("floor_id").primaryKey(),
		hallId: text("hall_id")
			.notNull()
			.references(() => diningHalls.hallId, { onDelete: "cascade" }),
		label: text("label").notNull(),
		floorplanId: text("floorplan_id").notNull(),
		floorplanKind: text("floorplan_kind").notNull(),
		sortKey: text("sort_key").notNull(),
		...timestamps,
	},
	(table) => [
		index("dining_floors_hall_idx").on(table.hallId),
		unique("dining_floors_hall_floor_unique").on(table.hallId, table.floorId),
		check("dining_floors_kind_check", sql`${table.floorplanKind} in ('asset', 'placeholder')`),
	],
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
	(table) => [
		index("dining_windows_floor_idx").on(table.hallId, table.floorId),
		uniqueIndex("dining_windows_floor_anchor_uidx")
			.on(table.floorId, table.svgAnchorId)
			.where(sql`${table.svgAnchorId} is not null`),
		foreignKey({
			columns: [table.hallId, table.floorId],
			foreignColumns: [diningFloors.hallId, diningFloors.floorId],
			name: "dining_windows_floor_fk",
		}).onDelete("cascade"),
		check(
			"dining_windows_status_check",
			sql`${table.status} in ('active', 'closed', 'maintenance')`,
		),
	],
);

export const diningStallProfiles = dining.table(
	"stall_profiles",
	{
		stallProfileId: text("stall_profile_id").primaryKey(),
		displayName: text("display_name").notNull(),
		stallType: text("stall_type").notNull(),
		tagsJson: jsonb("tags_json").$type<string[]>().notNull().default([]),
		status: text("status").notNull().default("active"),
		...timestamps,
	},
	(table) => [check("dining_stall_profiles_status_check", sql`${table.status} = 'active'`)],
);

export const diningWindowAssignments = dining.table(
	"window_assignments",
	{
		assignmentId: text("assignment_id").primaryKey(),
		windowId: text("window_id")
			.notNull()
			.references(() => diningWindows.windowId, { onDelete: "cascade" }),
		stallProfileId: text("stall_profile_id")
			.notNull()
			.references(() => diningStallProfiles.stallProfileId),
		status: text("status").notNull().default("active"),
		...timestamps,
	},
	(table) => [
		uniqueIndex("dining_assignments_window_uidx").on(table.windowId),
		check("dining_assignments_status_check", sql`${table.status} = 'active'`),
	],
);

export const diningMenuItems = dining.table(
	"menu_items",
	{
		menuItemId: text("menu_item_id").primaryKey(),
		name: text("name").notNull(),
		tagsJson: jsonb("tags_json").$type<string[]>().notNull().default([]),
		status: text("status").notNull().default("active"),
		...timestamps,
	},
	(table) => [check("dining_menu_items_status_check", sql`${table.status} = 'active'`)],
);

export const diningMenuOfferings = dining.table(
	"menu_offerings",
	{
		offeringId: text("offering_id").primaryKey(),
		assignmentId: text("assignment_id")
			.notNull()
			.references(() => diningWindowAssignments.assignmentId, { onDelete: "cascade" }),
		menuItemId: text("menu_item_id")
			.notNull()
			.references(() => diningMenuItems.menuItemId),
		priceLabel: text("price_label"),
		...timestamps,
	},
	(table) => [
		index("dining_offerings_assignment_idx").on(table.assignmentId),
		uniqueIndex("dining_offerings_assignment_item_uidx").on(table.assignmentId, table.menuItemId),
	],
);

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
	(table) => [
		index("dining_releases_created_idx").on(table.createdAt),
		foreignKey({
			columns: [table.predecessorReleaseId],
			foreignColumns: [table.releaseId],
			name: "dining_releases_predecessor_fk",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.rollbackOfReleaseId],
			foreignColumns: [table.releaseId],
			name: "dining_releases_rollback_fk",
		}).onDelete("set null"),
		check("dining_releases_revision_check", sql`${table.draftRevision} > 0`),
	],
);

export const diningCatalogState = dining.table(
	"catalog_state",
	{
		scope: text("scope").primaryKey(),
		draftRevision: integer("draft_revision").notNull(),
		baseReleaseId: text("base_release_id").references(() => diningReleases.releaseId, {
			onDelete: "set null",
		}),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		updatedBy: text("updated_by").notNull(),
	},
	(table) => [
		check("dining_catalog_state_scope_check", sql`${table.scope} = 'global'`),
		check("dining_catalog_state_revision_check", sql`${table.draftRevision} > 0`),
	],
);

export const diningPublication = dining.table(
	"publication",
	{
		scope: text("scope").primaryKey(),
		catalogReleaseId: text("catalog_release_id").references(() => diningReleases.releaseId),
		reviewRevision: integer("review_revision").notNull().default(0),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	},
	(table) => [
		check("dining_publication_scope_check", sql`${table.scope} = 'global'`),
		check("dining_publication_revision_check", sql`${table.reviewRevision} >= 0`),
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
		totalCount: integer("total_count").notNull().default(0),
		acceptedCount: integer("accepted_count").notNull().default(0),
		blockedCount: integer("blocked_count").notNull().default(0),
		staleCount: integer("stale_count").notNull().default(0),
		errorCode: text("error_code"),
		errorMessage: text("error_message"),
	},
	(table) => [
		index("dining_sync_runs_started_idx").on(table.sourceType, table.startedAt),
		check(
			"dining_sync_runs_source_check",
			sql`${table.sourceType} in ('feishu_catalog', 'feishu_review')`,
		),
		check(
			"dining_sync_runs_status_check",
			sql`${table.status} in ('running', 'succeeded', 'failed')`,
		),
		check(
			"dining_sync_runs_counts_check",
			sql`${table.totalCount} >= 0 and ${table.acceptedCount} >= 0 and ${table.blockedCount} >= 0 and ${table.staleCount} >= 0`,
		),
	],
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
		processingHash: text("processing_hash").notNull(),
		status: text("status").notNull(),
		observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
		firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
		lastSeenRunId: text("last_seen_run_id")
			.notNull()
			.references(() => diningSourceSyncRuns.runId),
		staleAt: timestamp("stale_at", { withTimezone: true }),
	},
	(table) => [
		index("dining_observations_source_idx").on(table.sourceType, table.status, table.staleAt),
		index("dining_observations_record_idx").on(
			table.sourceType,
			table.sourceTableId,
			table.sourceRecordId,
		),
		check(
			"dining_observations_source_check",
			sql`${table.sourceType} in ('feishu_catalog', 'feishu_review')`,
		),
		check(
			"dining_observations_status_check",
			sql`${table.status} in ('accepted', 'blocked', 'observed')`,
		),
	],
);

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
	(table) => [
		index("dining_catalog_overrides_target_idx")
			.on(table.targetKind, table.targetId)
			.where(sql`${table.active}`),
	],
);

export const diningReviews = dining.table(
	"reviews",
	{
		reviewId: text("review_id").primaryKey(),
		sourceRecordId: text("source_record_id").notNull(),
		sourceHash: text("source_hash").notNull(),
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
		uniqueIndex("dining_reviews_source_uidx").on(table.sourceRecordId),
		check("dining_reviews_rating_check", sql`${table.rating} between 1 and 5`),
		check(
			"dining_reviews_moderation_check",
			sql`${table.moderationStatus} in ('safe', 'blocked', 'uncertain')`,
		),
		check("dining_reviews_visibility_check", sql`${table.visibility} in ('published', 'hidden')`),
		check(
			"dining_reviews_publication_check",
			sql`${table.visibility} <> 'published' or (${table.moderationStatus} = 'safe' and ${table.hallId} is not null and ${table.stallProfileId} is not null and ${table.windowId} is not null and ${table.offeringId} is not null)`,
		),
	],
);

export const diningReviewOverrides = dining.table("review_overrides", {
	reviewId: text("review_id")
		.primaryKey()
		.references(() => diningReviews.reviewId, { onDelete: "cascade" }),
	offeringId: text("offering_id"),
	visibility: text("visibility"),
	reason: text("reason").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	updatedBy: text("updated_by").notNull(),
});

export const diningReviewRecheckRequests = dining.table(
	"review_recheck_requests",
	{
		requestId: text("request_id").primaryKey(),
		reviewId: text("review_id")
			.notNull()
			.references(() => diningReviews.reviewId, { onDelete: "cascade" }),
		status: text("status").notNull(),
		attemptCount: integer("attempt_count").notNull().default(0),
		availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
		claimedAt: timestamp("claimed_at", { withTimezone: true }),
		requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
		requestedBy: text("requested_by").notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		errorMessage: text("error_message"),
	},
	(table) => [
		index("dining_review_recheck_status_idx").on(table.status, table.availableAt),
		uniqueIndex("dining_review_recheck_active_uidx")
			.on(table.reviewId)
			.where(sql`${table.status} in ('pending', 'processing')`),
		check(
			"dining_review_recheck_status_check",
			sql`${table.status} in ('pending', 'processing', 'completed', 'failed')`,
		),
		check("dining_review_recheck_attempt_check", sql`${table.attemptCount} >= 0`),
	],
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
