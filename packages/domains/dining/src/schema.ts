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

export const diningSubmissions = dining.table(
	"submissions",
	{
		accountDeletingAt: timestamp("account_deleting_at", { withTimezone: true }),
		accountDeletionRequestId: text("account_deletion_request_id"),
		authorDisplayName: text("author_display_name"),
		authorId: text("author_id"),
		contentRevision: integer("content_revision").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		createdBy: text("created_by"),
		createdInputSha256: text("created_input_sha256"),
		createdName: text("created_name"),
		createdPhotoAction: text("created_photo_action"),
		createdPriceText: text("created_price_text"),
		createdSubmissionDate: date("created_submission_date", { mode: "string" }).notNull(),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
		deletedBy: text("deleted_by"),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		hiddenAt: timestamp("hidden_at", { withTimezone: true }),
		hiddenBy: text("hidden_by"),
		idempotencyKey: text("idempotency_key"),
		name: text("name"),
		priceText: text("price_text"),
		purgedAt: timestamp("purged_at", { withTimezone: true }),
		revision: integer("revision").notNull(),
		status: text("status").notNull(),
		submissionId: text("submission_id").primaryKey(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		updatedBy: text("updated_by"),
		windowId: text("window_id"),
	},
	(table) => [
		check(
			"dining_submissions_status_check",
			sql`${table.status} in ('public', 'hidden', 'deleted', 'expired', 'purged')`,
		),
		check(
			"dining_submissions_revision_check",
			sql`${table.revision} > 0 and ${table.contentRevision} > 0 and ${table.contentRevision} <= ${table.revision}`,
		),
		check(
			"dining_submissions_name_check",
			sql`${table.name} is null or length(btrim(${table.name})) between 1 and 80`,
		),
		check(
			"dining_submissions_price_check",
			sql`${table.priceText} is null or length(btrim(${table.priceText})) between 1 and 40`,
		),
		index("dining_submissions_window_status_created_idx").on(
			table.windowId,
			table.status,
			table.createdAt.desc(),
			table.submissionId.desc(),
		),
		index("dining_submissions_author_date_idx").on(table.authorId, table.createdSubmissionDate),
		uniqueIndex("dining_submissions_author_idempotency_uidx").on(
			table.authorId,
			table.idempotencyKey,
		),
	],
);

export const diningSubmissionPhotos = dining.table(
	"submission_photos",
	{
		uploadOwnerId: text("upload_owner_id"),
		accountDeletionRequestId: text("account_deletion_request_id"),
		cleanupAttempts: integer("cleanup_attempts").notNull().default(0),
		cleanupLastError: text("cleanup_last_error"),
		cleanupStartedAt: timestamp("cleanup_started_at", { withTimezone: true }),
		cleanupStatus: text("cleanup_status").notNull(),
		current: boolean("current").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		height: integer("height").notNull(),
		objectKey: text("object_key").notNull(),
		objectVersionId: text("object_version_id"),
		photoId: text("photo_id").primaryKey(),
		retiredAt: timestamp("retired_at", { withTimezone: true }),
		submissionId: text("submission_id").references(() => diningSubmissions.submissionId, {
			onDelete: "restrict",
		}),
		width: integer("width").notNull(),
	},
	(table) => [
		check(
			"dining_submission_photos_cleanup_status_check",
			sql`${table.cleanupStatus} in ('pending', 'running', 'completed', 'failed')`,
		),
		check(
			"dining_submission_photos_dimensions_check",
			sql`${table.width} > 0 and ${table.height} > 0`,
		),
		uniqueIndex("dining_submission_photos_object_key_uidx").on(table.objectKey),
		index("dining_submission_photos_submission_current_idx").on(table.submissionId, table.current),
		index("dining_submission_photos_expiry_idx").on(table.expiresAt, table.cleanupStatus),
	],
);

export const diningSubmissionEdits = dining.table(
	"submission_edits",
	{
		editedAt: timestamp("edited_at", { withTimezone: true }).notNull(),
		editedBy: text("edited_by"),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		editId: text("edit_id").primaryKey(),
		nextName: text("next_name"),
		nextPhotoId: text("next_photo_id"),
		nextPriceText: text("next_price_text"),
		nextRevision: integer("next_revision").notNull(),
		previousName: text("previous_name"),
		previousPhotoId: text("previous_photo_id"),
		previousPriceText: text("previous_price_text"),
		previousRevision: integer("previous_revision").notNull(),
		submissionId: text("submission_id")
			.notNull()
			.references(() => diningSubmissions.submissionId, { onDelete: "restrict" }),
	},
	(table) => [
		check(
			"dining_submission_edits_revision_check",
			sql`${table.nextRevision} > ${table.previousRevision}`,
		),
		uniqueIndex("dining_submission_edits_submission_next_uidx").on(
			table.submissionId,
			table.nextRevision,
		),
	],
);

export const diningSubmissionReports = dining.table(
	"submission_reports",
	{
		contentExpiresAt: timestamp("content_expires_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		details: text("details"),
		reason: text("reason").notNull(),
		reportId: text("report_id").primaryKey(),
		reporterUserId: text("reporter_user_id"),
		resolution: text("resolution"),
		resolvedAt: timestamp("resolved_at", { withTimezone: true }),
		resolvedBy: text("resolved_by"),
		submissionId: text("submission_id")
			.notNull()
			.references(() => diningSubmissions.submissionId, { onDelete: "restrict" }),
		targetRevision: integer("target_revision").notNull(),
	},
	(table) => [
		check(
			"dining_submission_reports_reason_check",
			sql`${table.reason} in ('spam', 'inappropriate', 'privacy', 'other')`,
		),
		check(
			"dining_submission_reports_details_check",
			sql`${table.details} is null or length(${table.details}) <= 300`,
		),
		check(
			"dining_submission_reports_resolution_check",
			sql`${table.resolution} is null or ${table.resolution} in ('keep', 'hide')`,
		),
		check(
			"dining_submission_reports_resolution_state_check",
			sql`(${table.resolution} is null and ${table.resolvedAt} is null) or (${table.resolution} is not null and ${table.resolvedAt} is not null)`,
		),
		uniqueIndex("dining_submission_reports_reporter_uidx").on(
			table.submissionId,
			table.reporterUserId,
		),
		index("dining_submission_reports_pending_idx").on(
			table.resolvedAt,
			table.createdAt,
			table.reportId,
		),
	],
);

export const diningReviews = dining.table(
	"reviews",
	{
		anonymous: boolean("anonymous").notNull(),
		authorDisplayName: text("author_display_name"),
		authorId: text("author_id"),
		authorKind: text("author_kind").notNull(),
		body: text("body"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
		deletedBy: text("deleted_by"),
		editedAt: timestamp("edited_at", { withTimezone: true }),
		hiddenAt: timestamp("hidden_at", { withTimezone: true }),
		hiddenBy: text("hidden_by"),
		idempotencyKey: text("idempotency_key").notNull(),
		menuItemId: text("menu_item_id").references(() => diningMenuItems.menuItemId, {
			onDelete: "restrict",
		}),
		reviewId: text("review_id").primaryKey(),
		submissionId: text("submission_id").references(() => diningSubmissions.submissionId, {
			onDelete: "restrict",
		}),
		contentRevision: integer("content_revision").notNull().default(1),
		submissionDate: date("submission_date", { mode: "string" }).notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		updatedBy: text("updated_by"),
	},
	(table) => [
		check("dining_reviews_author_kind_check", sql`${table.authorKind} in ('member', 'operator')`),
		check(
			"dining_reviews_body_check",
			sql`${table.body} is null or length(btrim(${table.body})) between 1 and 500`,
		),
		check(
			"dining_reviews_target_check",
			sql`(${table.menuItemId} is null) <> (${table.submissionId} is null)`,
		),
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
		reporterUserId: text("reporter_user_id"),
		resolution: text("resolution"),
		resolvedAt: timestamp("resolved_at", { withTimezone: true }),
		resolvedBy: text("resolved_by"),
		contentExpiresAt: timestamp("content_expires_at", { withTimezone: true }),
		targetRevision: integer("target_revision"),
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
			sql`(${table.resolution} is null and ${table.resolvedAt} is null)
				or (${table.resolution} is not null and ${table.resolvedAt} is not null)`,
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
		editedBy: text("edited_by"),
		nextBody: text("next_body"),
		previousBody: text("previous_body"),
		nextRevision: integer("next_revision"),
		previousRevision: integer("previous_revision"),
		expiresAt: timestamp("expires_at"),
		reviewId: text("review_id")
			.notNull()
			.references(() => diningReviews.reviewId, { onDelete: "cascade" }),
	},
	(table) => [
		index("dining_review_edits_review_idx").on(table.reviewId, table.editedAt, table.editId),
	],
);
