import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	foreignKey,
	index,
	integer,
	jsonb,
	pgSchema,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import type { DiningMapResponse } from "./domain/map.ts";
import type { DiningFloorplanBundleV1 } from "./floorplans/bundle.ts";

export const dining = pgSchema("dining");

export const diningMapDraft = dining.table(
	"map_draft",
	{
		bundleJson: jsonb("bundle_json").$type<DiningFloorplanBundleV1>().notNull(),
		fingerprint: text("fingerprint").notNull(),
		revision: integer("revision").notNull(),
		scope: text("scope").primaryKey(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		updatedBy: text("updated_by").notNull(),
	},
	(table) => [
		check(
			"dining_map_draft_fingerprint_check",
			sql`${table.fingerprint} ~ '^sha256:[0-9a-f]{64}$'`,
		),
		check("dining_map_draft_scope_check", sql`${table.scope} = 'global'`),
		check("dining_map_draft_revision_check", sql`${table.revision} > 0`),
	],
);

export const diningMapReleases = dining.table(
	"map_releases",
	{
		bundleJson: jsonb("bundle_json").$type<DiningFloorplanBundleV1>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		createdBy: text("created_by").notNull(),
		draftRevision: integer("draft_revision").notNull(),
		kind: text("kind").notNull(),
		publicPayloadJson: jsonb("public_payload_json").$type<DiningMapResponse>().notNull(),
		releaseId: text("release_id").primaryKey(),
		restoredFromReleaseId: text("restored_from_release_id"),
		snapshotHash: text("snapshot_hash").notNull(),
	},
	(table) => [
		check("dining_map_releases_revision_check", sql`${table.draftRevision} > 0`),
		check("dining_map_releases_kind_check", sql`${table.kind} in ('publish', 'restore')`),
		check(
			"dining_map_releases_snapshot_hash_check",
			sql`${table.snapshotHash} ~ '^sha256:[0-9a-f]{64}$'`,
		),
		foreignKey({
			columns: [table.restoredFromReleaseId],
			foreignColumns: [table.releaseId],
			name: "dining_map_releases_restored_from_release_id_fkey",
		}),
		index("dining_map_releases_created_idx").on(table.createdAt.desc(), table.releaseId.desc()),
	],
);

export const diningMapPublication = dining.table(
	"map_publication",
	{
		releaseId: text("release_id")
			.notNull()
			.references(() => diningMapReleases.releaseId),
		scope: text("scope").primaryKey(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		updatedBy: text("updated_by").notNull(),
	},
	(table) => [check("dining_map_publication_scope_check", sql`${table.scope} = 'global'`)],
);

export const diningMenuItems = dining.table(
	"menu_items",
	{
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		createdBy: text("created_by").notNull(),
		menuItemId: text("menu_item_id").primaryKey(),
		name: text("name").notNull(),
		priceText: text("price_text"),
		sortOrder: integer("sort_order").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		updatedBy: text("updated_by").notNull(),
		windowId: text("window_id").notNull(),
	},
	(table) => [
		check("dining_menu_items_name_check", sql`length(btrim(${table.name})) between 1 and 80`),
		check(
			"dining_menu_items_price_check",
			sql`${table.priceText} is null or length(btrim(${table.priceText})) between 1 and 40`,
		),
		check("dining_menu_items_sort_order_check", sql`${table.sortOrder} >= 0`),
		index("dining_menu_items_window_sort_idx").on(
			table.windowId,
			table.archivedAt,
			table.sortOrder,
			table.menuItemId,
		),
	],
);

export const diningReviews = dining.table(
	"reviews",
	{
		anonymous: boolean("anonymous").notNull(),
		authorDisplayName: text("author_display_name").notNull(),
		authorId: text("author_id").notNull(),
		authorKind: text("author_kind").notNull(),
		body: text("body").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
		deletedBy: text("deleted_by"),
		editedAt: timestamp("edited_at", { withTimezone: true }),
		hiddenAt: timestamp("hidden_at", { withTimezone: true }),
		hiddenBy: text("hidden_by"),
		idempotencyKey: text("idempotency_key").notNull(),
		menuItemId: text("menu_item_id")
			.notNull()
			.references(() => diningMenuItems.menuItemId, { onDelete: "restrict" }),
		reviewId: text("review_id").primaryKey(),
		submissionDate: date("submission_date", { mode: "string" }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		updatedBy: text("updated_by").notNull(),
	},
	(table) => [
		check("dining_reviews_author_kind_check", sql`${table.authorKind} in ('member', 'operator')`),
		check("dining_reviews_body_check", sql`length(btrim(${table.body})) between 1 and 500`),
		index("dining_reviews_menu_created_idx").on(
			table.menuItemId,
			table.createdAt.desc(),
			table.reviewId.desc(),
		),
		index("dining_reviews_member_limit_idx").on(
			table.authorKind,
			table.authorId,
			table.menuItemId,
			table.submissionDate,
		),
		uniqueIndex("dining_reviews_idempotency_uidx").on(
			table.authorKind,
			table.authorId,
			table.idempotencyKey,
		),
	],
);

export const diningReviewReports = dining.table(
	"review_reports",
	{
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		details: text("details"),
		reason: text("reason").notNull(),
		reportId: text("report_id").primaryKey(),
		reporterUserId: text("reporter_user_id").notNull(),
		resolution: text("resolution"),
		resolvedAt: timestamp("resolved_at", { withTimezone: true }),
		resolvedBy: text("resolved_by"),
		reviewId: text("review_id")
			.notNull()
			.references(() => diningReviews.reviewId, { onDelete: "cascade" }),
	},
	(table) => [
		check(
			"dining_review_reports_reason_check",
			sql`${table.reason} in ('spam', 'inappropriate', 'privacy', 'other')`,
		),
		check(
			"dining_review_reports_details_check",
			sql`${table.details} is null or length(${table.details}) <= 300`,
		),
		check(
			"dining_review_reports_resolution_check",
			sql`${table.resolution} is null or ${table.resolution} in ('keep', 'hide')`,
		),
		check(
			"dining_review_reports_resolution_state_check",
			sql`(${table.resolution} is null and ${table.resolvedAt} is null and ${table.resolvedBy} is null)
				or (${table.resolution} is not null and ${table.resolvedAt} is not null and ${table.resolvedBy} is not null)`,
		),
		uniqueIndex("dining_review_reports_reporter_uidx").on(table.reviewId, table.reporterUserId),
		index("dining_review_reports_pending_idx").on(
			table.resolvedAt,
			table.createdAt,
			table.reportId,
		),
	],
);

export const diningReviewEdits = dining.table(
	"review_edits",
	{
		editId: text("edit_id").primaryKey(),
		editedAt: timestamp("edited_at", { withTimezone: true }).notNull(),
		editedBy: text("edited_by").notNull(),
		nextBody: text("next_body").notNull(),
		previousBody: text("previous_body").notNull(),
		reviewId: text("review_id")
			.notNull()
			.references(() => diningReviews.reviewId, { onDelete: "cascade" }),
	},
	(table) => [
		index("dining_review_edits_review_idx").on(table.reviewId, table.editedAt, table.editId),
	],
);
