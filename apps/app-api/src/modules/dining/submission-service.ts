import {
	DiningSubmissionCreateSchema,
	DiningSubmissionUpdateSchema,
} from "@campus-agent/dining/domain";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Env } from "../../config";
import type { RuntimeDbGetter } from "../../db/runtime";
import { diningSubmissionEdits, diningSubmissionPhotos, diningSubmissions } from "../../db/schema";
import { AppApiRouteError } from "../../http";
import { createDiningImageProcessor } from "./submission-images";
import type { DiningImageProcessor, DiningSubmissionObjects } from "./submission-media";
import { createDiningSubmissionObjects } from "./submission-objects";
import {
	projectOwnSubmission,
	projectPublicSubmission,
	toOwnSubmission,
	toPublicSubmission,
} from "./submission-projection";
import type { DiningSubmissionService } from "./submission-service-contract";
import {
	checkRevision,
	currentSubmissionPhoto,
	currentSubmissionPhotosBySubmission,
	loadOwnSubmission,
	lockSubmissionActor,
	publicSubmissionCondition,
	publishedWindowIds,
	RETENTION_MS,
	requireSubmissionWindow,
	type SubmissionExecutor,
	type SubmissionPhotoRow,
	type SubmissionRow,
	type SubmissionTransaction,
	submissionAuthorCanWrite,
	submissionDate,
	submissionError,
	submissionNotFound,
	submissionStateConflict,
	viewerReportedSubmissionIds,
} from "./submission-store";
import { bindSubmissionPhoto, createSubmissionMediaStore } from "./submission-store-media";

export function createPgDiningSubmissionService(
	env: Env,
	options: {
		getDb: RuntimeDbGetter;
		now?: () => Date;
		images?: DiningImageProcessor;
		objects?: DiningSubmissionObjects;
	},
): DiningSubmissionService {
	const getDb = options.getDb;
	const now = options.now ?? (() => new Date());
	const objects = () => options.objects ?? createDiningSubmissionObjects(env);
	const media = createSubmissionMediaStore({
		getDb,
		now,
		objects,
		images: () => options.images ?? createDiningImageProcessor(env.DINING_IMAGES),
	});

	async function publicRow(db: SubmissionExecutor, submissionId: string) {
		const [row] = await db
			.select()
			.from(diningSubmissions)
			.where(and(eq(diningSubmissions.submissionId, submissionId), publicSubmissionCondition))
			.limit(1);
		if (!(row?.windowId && (await publishedWindowIds(db)).has(row.windowId))) {
			throw submissionNotFound();
		}
		return row;
	}

	const service: DiningSubmissionService = {
		async create(input) {
			const metadata = DiningSubmissionCreateSchema.parse(input.metadata);
			validatePhotoAction(metadata.photoAction, input.photo);
			const inputSha = input.photo ? await sha256(input.photo) : null;
			const db = await getDb();
			async function check(tx: SubmissionTransaction) {
				await tx.execute(
					sql`select pg_advisory_xact_lock_shared(hashtextextended('dining-publication', 0))`,
				);
				await lockSubmissionActor(tx, input.actor.principalId);
				const at = now();
				const [existing] = await tx
					.select()
					.from(diningSubmissions)
					.where(
						and(
							eq(diningSubmissions.authorId, input.actor.principalId),
							eq(diningSubmissions.idempotencyKey, input.idempotencyKey),
						),
					)
					.for("update");
				if (existing) {
					if (
						existing.windowId !== input.windowId ||
						existing.createdName !== metadata.name ||
						existing.createdPriceText !== metadata.priceText ||
						existing.createdPhotoAction !== metadata.photoAction ||
						existing.createdInputSha256 !== inputSha
					) {
						throw submissionError(
							"dining_submission_idempotency_conflict",
							409,
							"该请求标识已用于不同投稿。",
						);
					}
					return { existing, at };
				}
				await requireSubmissionWindow(tx, input.windowId);
				const [count] = await tx
					.select({ count: sql<number>`count(*)::int` })
					.from(diningSubmissions)
					.where(
						and(
							eq(diningSubmissions.authorId, input.actor.principalId),
							eq(diningSubmissions.createdSubmissionDate, submissionDate(at)),
						),
					);
				if ((count?.count ?? 0) >= 3) {
					throw submissionError("dining_submission_daily_limit", 429, "今日最多新增三条投稿。");
				}
				return { existing: null, at };
			}
			const replay = await db.transaction(async (tx) => {
				const { existing, at } = await check(tx);
				return existing ? { submission: await projectOwnSubmission(tx, existing, at) } : null;
			});
			if (replay) {
				return replay;
			}
			let photo: SubmissionPhotoRow | null = null;
			try {
				if (input.photo) {
					photo = await media.upload(input.photo, input.actor.principalId);
				}
				return await db.transaction(async (tx) => {
					const { existing, at } = await check(tx);
					if (existing) {
						return { submission: await projectOwnSubmission(tx, existing, at) };
					}
					const submissionId = crypto.randomUUID();
					const [row] = await tx
						.insert(diningSubmissions)
						.values({
							submissionId,
							windowId: input.windowId,
							authorId: input.actor.principalId,
							authorDisplayName: input.actor.displayName,
							name: metadata.name,
							priceText: metadata.priceText,
							createdAt: at,
							updatedAt: at,
							createdBy: input.actor.principalId,
							updatedBy: input.actor.principalId,
							revision: 1,
							contentRevision: 1,
							status: "public",
							idempotencyKey: input.idempotencyKey,
							createdName: metadata.name,
							createdPriceText: metadata.priceText,
							createdPhotoAction: metadata.photoAction,
							createdInputSha256: inputSha,
							createdSubmissionDate: submissionDate(at),
						})
						.returning();
					if (!row) {
						throw submissionNotFound();
					}
					if (photo) {
						await bindSubmissionPhoto(tx, photo, submissionId, at);
					}
					return { submission: await projectOwnSubmission(tx, row, at) };
				});
			} finally {
				if (photo) {
					await media.discardOrphan(photo.photoId);
				}
			}
		},
		async update(input) {
			const metadata = DiningSubmissionUpdateSchema.parse(input.metadata);
			validatePhotoAction(metadata.photoAction, input.photo);
			const db = await getDb();
			async function check(tx: SubmissionTransaction) {
				await tx.execute(
					sql`select pg_advisory_xact_lock_shared(hashtextextended('dining-publication', 0))`,
				);
				await lockSubmissionActor(tx, input.actor.principalId);
				const row = await loadOwnSubmission(tx, input.actor.principalId, input.submissionId, true);
				checkRevision(row, input.expectedRevision);
				if (row.deletedAt || row.accountDeletingAt || !["public", "hidden"].includes(row.status)) {
					throw submissionStateConflict();
				}
				await requireSubmissionWindow(tx, row.windowId);
				return row;
			}
			await db.transaction(check);
			let photo: SubmissionPhotoRow | null = null;
			try {
				if (input.photo) {
					photo = await media.upload(input.photo, input.actor.principalId);
				}
				return await db.transaction(async (tx) => {
					const previous = await check(tx);
					const currentPhoto = await currentSubmissionPhoto(tx, previous.submissionId);
					const nextPhotoId =
						metadata.photoAction === "keep"
							? (currentPhoto?.photoId ?? null)
							: (photo?.photoId ?? null);
					const at = now();
					if (
						previous.name === metadata.name &&
						previous.priceText === metadata.priceText &&
						(currentPhoto?.photoId ?? null) === nextPhotoId
					) {
						return { submission: await projectOwnSubmission(tx, previous, at) };
					}
					const expiresAt = new Date(at.getTime() + RETENTION_MS);
					if (currentPhoto && metadata.photoAction !== "keep") {
						await tx
							.update(diningSubmissionPhotos)
							.set({ current: false, retiredAt: at, expiresAt })
							.where(eq(diningSubmissionPhotos.photoId, currentPhoto.photoId));
					}
					if (photo) {
						await bindSubmissionPhoto(tx, photo, previous.submissionId, at);
					}
					await tx.insert(diningSubmissionEdits).values({
						editId: crypto.randomUUID(),
						submissionId: previous.submissionId,
						editedAt: at,
						editedBy: input.actor.principalId,
						expiresAt,
						previousRevision: previous.contentRevision,
						nextRevision: previous.contentRevision + 1,
						previousName: previous.name,
						previousPriceText: previous.priceText,
						previousPhotoId: currentPhoto?.photoId ?? null,
						nextName: metadata.name,
						nextPriceText: metadata.priceText,
						nextPhotoId,
					});
					const [row] = await tx
						.update(diningSubmissions)
						.set({
							name: metadata.name,
							priceText: metadata.priceText,
							revision: previous.revision + 1,
							contentRevision: previous.contentRevision + 1,
							updatedAt: at,
							updatedBy: input.actor.principalId,
						})
						.where(eq(diningSubmissions.submissionId, previous.submissionId))
						.returning();
					if (!row) {
						throw submissionNotFound();
					}
					return { submission: await projectOwnSubmission(tx, row, at) };
				});
			} finally {
				if (photo) {
					await media.discardOrphan(photo.photoId);
				}
			}
		},
		async deleteOwn(input) {
			const db = await getDb();
			await db.transaction(async (tx) => {
				await lockSubmissionActor(tx, input.userId);
				const row = await loadOwnSubmission(tx, input.userId, input.submissionId, true);
				// A repeated request may carry the version preceding this deletion.
				// A subsequent restore/mutation prevents an older delete from succeeding.
				if (
					row.deletedAt &&
					(input.expectedRevision === row.revision ||
						(input.expectedRevision === row.revision - 1 &&
							row.deletedBy === input.userId &&
							row.updatedBy === input.userId &&
							row.updatedAt.getTime() === row.deletedAt.getTime()))
				) {
					return;
				}
				checkRevision(row, input.expectedRevision);
				if (row.accountDeletingAt || !["public", "hidden"].includes(row.status)) {
					throw submissionStateConflict();
				}
				const at = now();
				await tx
					.update(diningSubmissions)
					.set({
						deletedAt: at,
						deletedBy: input.userId,
						expiresAt: new Date(at.getTime() + RETENTION_MS),
						revision: row.revision + 1,
						status: "deleted",
						updatedAt: at,
						updatedBy: input.userId,
					})
					.where(eq(diningSubmissions.submissionId, row.submissionId));
			});
		},
		async getOwn(input) {
			const db = await getDb();
			return {
				submission: await projectOwnSubmission(
					db,
					await loadOwnSubmission(db, input.userId, input.submissionId),
					now(),
				),
			};
		},
		async listOwn(input) {
			const db = await getDb();
			const scope = `own:${input.userId}`;
			const rows = await db
				.select()
				.from(diningSubmissions)
				.where(
					and(
						eq(diningSubmissions.authorId, input.userId),
						isNull(diningSubmissions.purgedAt),
						cursorCondition(input.cursor, scope),
					),
				)
				.orderBy(desc(diningSubmissions.createdAt), desc(diningSubmissions.submissionId))
				.limit(input.limit + 1);
			const page = rows.slice(0, input.limit);
			const [windowIds, canWrite, photos] = await Promise.all([
				publishedWindowIds(db),
				submissionAuthorCanWrite(db, input.userId),
				currentSubmissionPhotosBySubmission(
					db,
					page.map((row) => row.submissionId),
				),
			]);
			return {
				items: page.map((row) =>
					toOwnSubmission(row, now(), {
						editable: canWrite && !row.accountDeletingAt,
						photo: photos.get(row.submissionId) ?? null,
						windowIds,
					}),
				),
				nextCursor: rows.length > input.limit ? encodeCursor(page.at(-1), scope) : null,
			};
		},
		async getPublic(input) {
			const db = await getDb();
			return {
				submission: await projectPublicSubmission(
					db,
					await publicRow(db, input.submissionId),
					input.viewerUserId,
				),
			};
		},
		async listPublic(input) {
			const db = await getDb();
			const scope = `window:${input.windowId}`;
			const cursor = cursorCondition(input.cursor, scope);
			const windowIds = await publishedWindowIds(db);
			if (!windowIds.has(input.windowId)) {
				throw submissionNotFound();
			}
			const rows = await db
				.select()
				.from(diningSubmissions)
				.where(
					and(publicSubmissionCondition, eq(diningSubmissions.windowId, input.windowId), cursor),
				)
				.orderBy(desc(diningSubmissions.createdAt), desc(diningSubmissions.submissionId))
				.limit(input.limit + 1);
			const page = rows.slice(0, input.limit);
			const [photos, reportedIds] = await Promise.all([
				currentSubmissionPhotosBySubmission(
					db,
					page.map((row) => row.submissionId),
				),
				input.viewerUserId
					? viewerReportedSubmissionIds(
							db,
							page.map((row) => row.submissionId),
							input.viewerUserId,
						)
					: Promise.resolve(new Set<string>()),
			]);
			return {
				items: page.map((row) =>
					toPublicSubmission(row, {
						hasReported: reportedIds.has(row.submissionId),
						photo: photos.get(row.submissionId) ?? null,
						viewerUserId: input.viewerUserId,
					}),
				),
				nextCursor: rows.length > input.limit ? encodeCursor(page.at(-1), scope) : null,
			};
		},
		async getPhoto(input) {
			const db = await getDb();
			let photo: SubmissionPhotoRow | null;
			try {
				const row = input.ownerUserId
					? await loadOwnSubmission(db, input.ownerUserId, input.submissionId)
					: await publicRow(db, input.submissionId);
				if (row.deletedAt || row.accountDeletingAt || !["public", "hidden"].includes(row.status)) {
					throw submissionNotFound();
				}
				if (input.ownerUserId && !(await submissionAuthorCanWrite(db, row.authorId))) {
					throw submissionNotFound();
				}
				photo = await currentSubmissionPhoto(db, row.submissionId);
				if (
					!photo ||
					photo.photoId !== input.photoId ||
					photo.submissionId !== input.submissionId
				) {
					throw submissionNotFound();
				}
			} catch (error) {
				if (error instanceof AppApiRouteError && error.status === 404) {
					throw photoNotFound();
				}
				throw error;
			}
			// Reached only after per-request authorization and state checks: a
			// matching validator skips the body transfer, never the checks.
			const etag = photoETag(photo.photoId);
			if (ifNoneMatchMatches(input.ifNoneMatch, etag)) {
				return { etag, notModified: true };
			}
			let bytes: Uint8Array | null;
			try {
				bytes = await objects().get(photo.objectKey);
			} catch {
				throw submissionError("dining_submission_storage_unavailable", 503, "照片读取暂不可用。");
			}
			if (!bytes) {
				throw photoNotFound();
			}
			return { bytes, etag, notModified: false };
		},
	};
	return {
		create: (input) => protect(() => service.create(input)),
		update: (input) => protect(() => service.update(input)),
		deleteOwn: (input) => protect(() => service.deleteOwn(input)),
		getOwn: (input) => protect(() => service.getOwn(input)),
		listOwn: (input) => protect(() => service.listOwn(input)),
		getPublic: (input) => protect(() => service.getPublic(input)),
		listPublic: (input) => protect(() => service.listPublic(input)),
		getPhoto: (input) => protect(() => service.getPhoto(input)),
	};
}

function photoNotFound() {
	return submissionError("dining_submission_photo_not_found", 404, "未找到该照片。");
}

function photoETag(photoId: string) {
	return `"${photoId}"`;
}

// If-None-Match uses weak comparison: W/"x" matches "x", and "*" matches any.
function ifNoneMatchMatches(header: string | null, etag: string) {
	if (!header) {
		return false;
	}
	return header.split(",").some((candidate) => {
		const trimmed = candidate.trim();
		return trimmed === "*" || trimmed.replace(/^W\//, "") === etag;
	});
}

async function sha256(value: Uint8Array) {
	const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encodeCursor(row: SubmissionRow | undefined, scope: string) {
	return row
		? btoa(
				String.fromCharCode(
					...new TextEncoder().encode(
						JSON.stringify([scope, row.createdAt.toISOString(), row.submissionId]),
					),
				),
			)
		: null;
}

function cursorCondition(value: string | undefined, scope: string) {
	if (!value) {
		return;
	}
	try {
		const parsed = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(
				Uint8Array.from(atob(value), (c) => c.charCodeAt(0)),
			),
		) as unknown;
		if (
			!Array.isArray(parsed) ||
			parsed.length !== 3 ||
			parsed[0] !== scope ||
			typeof parsed[1] !== "string" ||
			typeof parsed[2] !== "string" ||
			!parsed[2]
		) {
			throw new Error("cursor");
		}
		const at = new Date(parsed[1]);
		if (Number.isNaN(at.getTime())) {
			throw new Error("cursor");
		}
		return or(
			lt(diningSubmissions.createdAt, at),
			and(eq(diningSubmissions.createdAt, at), lt(diningSubmissions.submissionId, parsed[2])),
		);
	} catch {
		throw submissionError("dining_submission_request_invalid", 400, "投稿分页位置无效。");
	}
}

async function protect<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof AppApiRouteError) {
			throw error;
		}
		throw submissionError("internal_error", 500, "投稿操作未完成，请核实当前状态。");
	}
}

function validatePhotoAction(action: string, photo: Uint8Array | null) {
	if ((action === "replace") !== (photo !== null) || photo?.length === 0) {
		throw submissionError("dining_submission_request_invalid", 400, "图片动作与上传文件不一致。");
	}
}
