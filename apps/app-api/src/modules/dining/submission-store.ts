import { DiningMapResponseSchema } from "@campus-agent/dining/domain";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { RuntimeDatabase } from "../../db/runtime";
import {
	accountDeletionRequests,
	diningMapPublication,
	diningMapReleases,
	diningSubmissionPhotos,
	diningSubmissionReports,
	diningSubmissions,
	user,
} from "../../db/schema";
import { AppApiRouteError } from "../../http";

export type SubmissionTransaction = Parameters<Parameters<RuntimeDatabase["transaction"]>[0]>[0];
export type SubmissionExecutor = RuntimeDatabase | SubmissionTransaction;
export type SubmissionRow = typeof diningSubmissions.$inferSelect;
export type SubmissionPhotoRow = typeof diningSubmissionPhotos.$inferSelect;
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function submissionError(code: string, status: number, message: string) {
	return new AppApiRouteError({ code, status, message, retryable: status >= 500 });
}

export function submissionNotFound() {
	return submissionError("dining_submission_not_found", 404, "未找到该投稿。");
}

export function submissionStateConflict() {
	return submissionError(
		"dining_submission_state_conflict",
		409,
		"当前投稿或窗口状态不允许此操作。",
	);
}

export function checkRevision(row: SubmissionRow, expectedRevision: number) {
	if (row.revision !== expectedRevision) {
		throw submissionError(
			"dining_submission_revision_conflict",
			412,
			"投稿已发生变化，请重新读取后修改。",
		);
	}
}

// Account lifecycle takes this same row lock before accepting deletion. Every
// submission mutation takes it first, including the final transaction after media.
// The 403 reuses the auth-domain "BANNED_USER" code so campus-web maps it to the
// shared banned-account handling instead of a dining-specific branch.
export async function lockSubmissionActor(tx: SubmissionTransaction, userId: string) {
	const [actor] = await tx.select().from(user).where(eq(user.id, userId)).for("update");
	if (!actor) {
		throw submissionError("session_required", 401, "请先登录。");
	}
	const [deletion] = await tx
		.select({ id: accountDeletionRequests.requestId })
		.from(accountDeletionRequests)
		.where(eq(accountDeletionRequests.ownerUserId, userId))
		.limit(1);
	if (actor.banned || deletion) {
		throw submissionError("BANNED_USER", 403, "当前账号无法执行此操作。");
	}
}

export async function loadOwnSubmission(
	db: SubmissionExecutor,
	userId: string,
	submissionId: string,
	lock = false,
) {
	const query = db
		.select()
		.from(diningSubmissions)
		.where(
			and(
				eq(diningSubmissions.submissionId, submissionId),
				eq(diningSubmissions.authorId, userId),
				isNull(diningSubmissions.purgedAt),
			),
		);
	const [row] = await (lock ? query.for("update") : query);
	if (!row || row.status === "purged" || !row.windowId) {
		throw submissionNotFound();
	}
	return row;
}

export async function currentSubmissionPhoto(db: SubmissionExecutor, submissionId: string) {
	const [photo] = await db
		.select()
		.from(diningSubmissionPhotos)
		.where(
			and(
				eq(diningSubmissionPhotos.submissionId, submissionId),
				eq(diningSubmissionPhotos.current, true),
				isNull(diningSubmissionPhotos.cleanupStartedAt),
				eq(diningSubmissionPhotos.cleanupStatus, "pending"),
				isNull(diningSubmissionPhotos.expiresAt),
			),
		)
		.limit(1);
	return photo ?? null;
}

// Batched form of currentSubmissionPhoto for list projections; one current
// photo per submission is the storage invariant.
export async function currentSubmissionPhotosBySubmission(
	db: SubmissionExecutor,
	submissionIds: string[],
): Promise<Map<string, SubmissionPhotoRow>> {
	const photos = new Map<string, SubmissionPhotoRow>();
	if (submissionIds.length === 0) {
		return photos;
	}
	const rows = await db
		.select()
		.from(diningSubmissionPhotos)
		.where(
			and(
				inArray(diningSubmissionPhotos.submissionId, submissionIds),
				eq(diningSubmissionPhotos.current, true),
				isNull(diningSubmissionPhotos.cleanupStartedAt),
				eq(diningSubmissionPhotos.cleanupStatus, "pending"),
				isNull(diningSubmissionPhotos.expiresAt),
			),
		);
	for (const photo of rows) {
		if (photo.submissionId && !photos.has(photo.submissionId)) {
			photos.set(photo.submissionId, photo);
		}
	}
	return photos;
}

// Batched form of the viewer report lookup used by public list projections.
export async function viewerReportedSubmissionIds(
	db: SubmissionExecutor,
	submissionIds: string[],
	viewerUserId: string,
): Promise<Set<string>> {
	if (submissionIds.length === 0) {
		return new Set();
	}
	const rows = await db
		.select({ submissionId: diningSubmissionReports.submissionId })
		.from(diningSubmissionReports)
		.where(
			and(
				inArray(diningSubmissionReports.submissionId, submissionIds),
				eq(diningSubmissionReports.reporterUserId, viewerUserId),
			),
		);
	return new Set(rows.map((row) => row.submissionId));
}

export async function publishedWindowIds(db: SubmissionExecutor): Promise<Set<string>> {
	const [row] = await db
		.select({ payload: diningMapReleases.publicPayloadJson })
		.from(diningMapPublication)
		.innerJoin(diningMapReleases, eq(diningMapPublication.releaseId, diningMapReleases.releaseId))
		.where(eq(diningMapPublication.scope, "global"))
		.limit(1);
	const parsed = DiningMapResponseSchema.safeParse(row?.payload);
	return new Set(
		parsed.success
			? parsed.data.halls.flatMap((hall) =>
					hall.floors.flatMap((floor) => floor.windows.map((window) => window.windowId)),
				)
			: [],
	);
}

export async function requireSubmissionWindow(db: SubmissionExecutor, windowId: string | null) {
	if (!(windowId && (await publishedWindowIds(db)).has(windowId))) {
		throw submissionStateConflict();
	}
}

export const publicSubmissionCondition = and(
	eq(diningSubmissions.status, "public"),
	isNull(diningSubmissions.hiddenAt),
	isNull(diningSubmissions.deletedAt),
	isNull(diningSubmissions.purgedAt),
	isNull(diningSubmissions.accountDeletingAt),
	sql`exists (select 1 from ${user} where ${user.id} = ${diningSubmissions.authorId}
		and ${user.banReason} is distinct from 'account_deletion_in_progress')`,
	sql`not exists (select 1 from ${accountDeletionRequests}
		where ${accountDeletionRequests.ownerUserId} = ${diningSubmissions.authorId})`,
);

export async function submissionAuthorCanWrite(db: SubmissionExecutor, authorId: string | null) {
	if (!authorId) {
		return false;
	}
	const [row] = await db
		.select({ banned: user.banned })
		.from(user)
		.where(
			and(
				eq(user.id, authorId),
				sql`not exists (select 1 from ${accountDeletionRequests} where ${accountDeletionRequests.ownerUserId} = ${user.id})`,
			),
		)
		.limit(1);
	return Boolean(row && !row.banned);
}

export function submissionDate(value: Date) {
	// Shanghai has a fixed UTC+8 offset throughout the product's supported dates.
	return new Date(value.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
