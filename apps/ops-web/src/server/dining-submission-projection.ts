import {
	DiningMapResponseSchema,
	type DiningOpsSubmissionHistoricalPhoto,
	type DiningOpsSubmissionRecord,
	DiningOpsSubmissionRecordSchema,
	type DiningOpsSubmissionSnapshot,
} from "@campus-agent/dining/domain";
import {
	type DiningDatabase,
	isoDate,
	nullableIsoDate,
	nullableString,
} from "./dining-store-database.ts";
import { DiningStoreNotFoundError } from "./dining-store-errors.ts";

export const OPS_SUBMISSION_COLUMNS =
	"submission_id, window_id, author_id, author_display_name, name, price_text, status, revision, content_revision, created_at, updated_at, hidden_at, deleted_at, expires_at, account_deleting_at, purged_at, updated_by, hidden_by, deleted_by";

export async function opsPublishedWindowIds(db: DiningDatabase): Promise<Set<string>> {
	const result =
		await db.query(`select release.public_payload_json from dining.map_publication publication
		join dining.map_releases release on release.release_id = publication.release_id where publication.scope = 'global'`);
	const parsed = DiningMapResponseSchema.safeParse(result.rows[0]?.public_payload_json);
	return new Set(
		parsed.success
			? parsed.data.halls.flatMap((hall) =>
					hall.floors.flatMap((floor) => floor.windows.map((window) => window.windowId)),
				)
			: [],
	);
}

export function submissionExpired(row: Record<string, unknown>, now: Date): boolean {
	return (
		row.status === "expired" ||
		(row.expires_at != null && new Date(String(row.expires_at)).valueOf() <= now.valueOf())
	);
}

export function submissionContentAvailable(row: Record<string, unknown>, now: Date): boolean {
	return (
		row.purged_at == null &&
		row.status !== "purged" &&
		!submissionExpired(row, now) &&
		typeof row.name === "string"
	);
}

export async function loadOpsSubmissionRow(
	db: DiningDatabase,
	id: string,
	lock = false,
): Promise<Record<string, unknown>> {
	const result = await db.query(
		`select ${OPS_SUBMISSION_COLUMNS} from dining.submissions where submission_id = $1${lock ? " for update" : ""}`,
		[id],
	);
	if (!result.rows[0]) {
		throw new DiningStoreNotFoundError("未找到该投稿。");
	}
	return result.rows[0];
}

export async function projectOpsSubmission(
	db: DiningDatabase,
	row: Record<string, unknown>,
	now: Date,
): Promise<DiningOpsSubmissionRecord> {
	const id = String(row.submission_id);
	if (row.purged_at != null || row.status === "purged") {
		return DiningOpsSubmissionRecordSchema.parse({
			submissionId: id,
			status: "purged",
			revision: Number(row.revision),
			contentRevision: Number(row.content_revision),
			purgedAt: isoDate(row.purged_at),
			canDelete: false,
			canUnhide: false,
			canRestore: false,
		});
	}
	const expired = submissionExpired(row, now);
	const status = expired ? "expired" : String(row.status);
	const windowAvailable = (await opsPublishedWindowIds(db)).has(String(row.window_id));
	const reports = await db.query(
		"select count(*)::int as count from dining.submission_reports where submission_id = $1 and resolved_at is null",
		[id],
	);
	const photos = await db.query(
		`select photo_id, width, height, current, expires_at, cleanup_started_at, cleanup_status
		from dining.submission_photos where submission_id = $1 and current = true`,
		[id],
	);
	const photo = photos.rows[0];
	const cleanupStarted = photos.rows.some(
		(p) => p.cleanup_started_at != null || p.cleanup_status !== "pending",
	);
	const mutable = row.account_deleting_at == null;
	const base = {
		submissionId: id,
		status,
		revision: Number(row.revision),
		contentRevision: Number(row.content_revision),
		createdAt: isoDate(row.created_at),
		updatedAt: isoDate(row.updated_at),
		deletedAt: nullableIsoDate(row.deleted_at),
		expiresAt: nullableIsoDate(row.expires_at),
		hiddenAt: nullableIsoDate(row.hidden_at),
		deletedBy: nullableString(row.deleted_by),
		hiddenBy: nullableString(row.hidden_by),
		updatedBy: nullableString(row.updated_by),
		authorId: nullableString(row.author_id),
		authorDisplayName: nullableString(row.author_display_name),
		accountDeletingAt: nullableIsoDate(row.account_deleting_at),
		windowId: String(row.window_id),
		windowAvailable,
		pendingReportCount: Number(reports.rows[0]?.count ?? 0),
		canDelete: mutable && (status === "public" || status === "hidden"),
		canUnhide: mutable && status === "hidden" && windowAvailable && !cleanupStarted,
		canRestore: mutable && status === "deleted" && windowAvailable && !cleanupStarted,
	};
	return DiningOpsSubmissionRecordSchema.parse(
		expired
			? base
			: {
					...base,
					name: row.name,
					priceText: row.price_text,
					photo: photo && photoAvailable(photo, now) ? photoDto(id, photo) : null,
				},
	);
}

export function photoAvailable(row: Record<string, unknown>, now: Date): boolean {
	return (
		row.cleanup_started_at == null &&
		row.cleanup_status === "pending" &&
		(row.expires_at == null || new Date(String(row.expires_at)).valueOf() > now.valueOf())
	);
}

function photoDto(submissionId: string, row: Record<string, unknown>) {
	const photoId = String(row.photo_id);
	return {
		photoId,
		width: Number(row.width),
		height: Number(row.height),
		url: `/api/ops/dining/submissions/${submissionId}/photos/${photoId}`,
	};
}

async function historicalPhoto(
	db: DiningDatabase,
	submissionId: string,
	photoId: unknown,
	now: Date,
): Promise<DiningOpsSubmissionHistoricalPhoto | null> {
	if (photoId == null) {
		return null;
	}
	const result = await db.query(
		`select photo_id, width, height, expires_at, cleanup_started_at, cleanup_status from dining.submission_photos
		where submission_id = $1 and photo_id = $2`,
		[submissionId, photoId],
	);
	const photo = result.rows[0];
	if (!photo) {
		return { photoId: String(photoId), state: "expired", expiresAt: now.toISOString() };
	}
	if (!photoAvailable(photo, now)) {
		return {
			photoId: String(photoId),
			state: "expired",
			expiresAt: nullableIsoDate(photo.expires_at) ?? now.toISOString(),
		};
	}
	return {
		...photoDto(submissionId, photo),
		state: "available",
		expiresAt: nullableIsoDate(photo.expires_at),
	};
}

export async function resolveSubmissionSnapshot(
	db: DiningDatabase,
	row: Record<string, unknown>,
	revision: number,
	now: Date,
): Promise<DiningOpsSubmissionSnapshot> {
	if (!submissionContentAvailable(row, now)) {
		return { replayable: false };
	}
	const submissionId = String(row.submission_id);
	if (revision === Number(row.content_revision)) {
		const photos = await db.query(
			"select photo_id from dining.submission_photos where submission_id = $1 and current = true",
			[submissionId],
		);
		return {
			replayable: true,
			name: String(row.name),
			priceText: nullableString(row.price_text),
			photo: await historicalPhoto(db, submissionId, photos.rows[0]?.photo_id, now),
		};
	}
	const result = await db.query(
		`select previous_name, previous_price_text, previous_photo_id, expires_at from dining.submission_edits
		where submission_id = $1 and previous_revision = $2`,
		[submissionId, revision],
	);
	const edit = result.rows[0];
	if (!edit?.previous_name || new Date(String(edit.expires_at)).valueOf() <= now.valueOf()) {
		return { replayable: false };
	}
	return {
		replayable: true,
		name: String(edit.previous_name),
		priceText: nullableString(edit.previous_price_text),
		photo: await historicalPhoto(db, submissionId, edit.previous_photo_id, now),
	};
}
