import {
	type DiningMapResponse,
	DiningMapResponseSchema,
	type DiningReportReason,
	type DiningReview,
	type DiningReviewPage,
	DiningReviewPageSchema,
	DiningReviewSchema,
	type DiningSubmissionReview,
	type DiningSubmissionReviewPage,
	DiningSubmissionReviewPageSchema,
	DiningSubmissionReviewSchema,
	type DiningWindowMenuResponse,
	DiningWindowMenuResponseSchema,
} from "@campus-agent/dining/domain";
import { and, asc, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { RuntimeDatabase, RuntimeDbGetter } from "../../db/runtime";
import {
	diningMapPublication,
	diningMapReleases,
	diningMenuItems,
	diningReviewReports,
	diningReviews,
	diningSubmissionReports,
	diningSubmissions,
} from "../../db/schema";
import { AppApiRouteError } from "../../http";
import {
	lockSubmissionActor,
	publicSubmissionCondition,
	publishedWindowIds,
	RETENTION_MS,
	submissionNotFound,
} from "./submission-store";

const MEMBER_DAILY_REVIEW_LIMIT = 3;
const PRODUCT_TIME_ZONE = "Asia/Shanghai";

type DiningTransaction = Parameters<Parameters<RuntimeDatabase["transaction"]>[0]>[0];
type DiningExecutor = RuntimeDatabase | DiningTransaction;

export interface DiningReviewActor {
	displayName: string;
	kind: "member" | "operator";
	principalId: string;
}

type ReviewTarget =
	| { menuItemId: string; submissionId?: never }
	| { submissionId: string; menuItemId?: never };
interface ReviewCreate {
	actor: DiningReviewActor;
	anonymous: boolean;
	body: string;
	idempotencyKey: string;
}
interface ReviewList {
	cursor?: string;
	limit: number;
	viewerUserId: string | null;
}

export interface DiningContentService {
	createSubmissionReview(
		input: ReviewCreate & { submissionId: string },
	): Promise<DiningSubmissionReview>;
	listSubmissionReviews(
		input: ReviewList & { submissionId: string },
	): Promise<DiningSubmissionReviewPage>;
	reportSubmission(input: {
		details: string | null;
		reason: DiningReportReason;
		submissionId: string;
		userId: string;
	}): Promise<{ reportId: string }>;
	createReview(input: {
		actor: DiningReviewActor;
		anonymous: boolean;
		body: string;
		idempotencyKey: string;
		menuItemId: string;
	}): Promise<DiningReview>;
	deleteOwnReview(input: { reviewId: string; userId: string }): Promise<void>;
	getWindowMenu(windowId: string): Promise<DiningWindowMenuResponse>;
	listReviews(input: {
		cursor?: string;
		limit: number;
		menuItemId: string;
		viewerUserId: string | null;
	}): Promise<DiningReviewPage>;
	reportReview(input: {
		details: string | null;
		reason: DiningReportReason;
		reviewId: string;
		userId: string;
	}): Promise<{ reportId: string }>;
}

export function createPgDiningContentService(options: {
	getDb: RuntimeDbGetter;
	now?: () => Date;
}): DiningContentService {
	const getDb = options.getDb;
	const now = options.now ?? (() => new Date());

	async function listTargetReviews(input: ReviewList & ReviewTarget) {
		const db = await getDb();
		await requirePublicTarget(db, input);
		const cursor = input.cursor ? decodeReviewCursor(input.cursor) : null;
		const pageSize = Math.min(Math.max(input.limit, 1), 50);
		const cursorCondition = cursor
			? or(
					lt(diningReviews.createdAt, cursor.createdAt),
					and(
						eq(diningReviews.createdAt, cursor.createdAt),
						lt(diningReviews.reviewId, cursor.reviewId),
					),
				)
			: undefined;
		const rows = await db
			.select({
				anonymous: diningReviews.anonymous,
				authorDisplayName: diningReviews.authorDisplayName,
				authorId: diningReviews.authorId,
				authorKind: diningReviews.authorKind,
				body: diningReviews.body,
				createdAt: diningReviews.createdAt,
				editedAt: diningReviews.editedAt,
				hasReported: input.viewerUserId
					? sql<boolean>`exists (
							select 1 from ${diningReviewReports}
							where ${diningReviewReports.reviewId} = ${diningReviews.reviewId}
								and ${diningReviewReports.reporterUserId} = ${input.viewerUserId}
						)`
					: sql<boolean>`false`,
				menuItemId: diningReviews.menuItemId,
				submissionId: diningReviews.submissionId,
				reviewId: diningReviews.reviewId,
			})
			.from(diningReviews)
			.where(
				and(
					targetCondition(input),
					isNull(diningReviews.hiddenAt),
					isNull(diningReviews.deletedAt),
					cursorCondition,
				),
			)
			.orderBy(desc(diningReviews.createdAt), desc(diningReviews.reviewId))
			.limit(pageSize + 1);
		const hasMore = rows.length > pageSize;
		const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
		const items = pageRows.map((row) =>
			toPublicContentReview(row, input.viewerUserId, Boolean(row.hasReported)),
		);
		const last = pageRows.at(-1);
		return {
			items,
			nextCursor:
				hasMore && last
					? encodeReviewCursor({ createdAt: last.createdAt, reviewId: last.reviewId })
					: null,
		};
	}

	async function createTargetReview(input: ReviewCreate & ReviewTarget) {
		const db = await getDb();
		const createdAt = now();
		const submissionDate = dateInTimeZone(createdAt, PRODUCT_TIME_ZONE);
		return db.transaction(async (tx) => {
			if (input.actor.kind === "member") {
				await lockSubmissionActor(tx, input.actor.principalId);
			}
			await tx.execute(
				sql`select pg_advisory_xact_lock(hashtextextended(${`dining-review:${input.actor.kind}:${input.actor.principalId}`}, 0))`,
			);
			const replay = await tx
				.select()
				.from(diningReviews)
				.where(
					and(
						eq(diningReviews.authorKind, input.actor.kind),
						eq(diningReviews.authorId, input.actor.principalId),
						eq(diningReviews.idempotencyKey, input.idempotencyKey),
					),
				)
				.limit(1);
			if (replay[0]) {
				if (
					replay[0].menuItemId !== (input.menuItemId ?? null) ||
					replay[0].submissionId !== (input.submissionId ?? null) ||
					replay[0].anonymous !== input.anonymous ||
					replay[0].body !== input.body
				) {
					throw conflict("dining_review_idempotency_conflict", "该提交标识已用于其他评价。");
				}
				if (input.submissionId !== undefined) {
					await requirePublicTarget(tx, input, true);
					if (replay[0].hiddenAt || replay[0].deletedAt) {
						throw notFound("dining_review_not_found", "未找到该评价。");
					}
				}
				return toPublicContentReview(replay[0], input.actor.principalId, false);
			}

			await requirePublicTarget(tx, input, true);
			if (input.actor.kind === "member") {
				const countRows = await tx
					.select({ count: sql<number>`count(*)::int` })
					.from(diningReviews)
					.where(
						and(
							eq(diningReviews.authorKind, "member"),
							eq(diningReviews.authorId, input.actor.principalId),
							targetCondition(input),
							eq(diningReviews.submissionDate, submissionDate),
						),
					);
				if ((countRows[0]?.count ?? 0) >= MEMBER_DAILY_REVIEW_LIMIT) {
					throw conflict("dining_review_daily_limit", "每位用户每天最多为同一道菜提交三条评价。");
				}
			}

			const reviewId = `drv_${crypto.randomUUID().replaceAll("-", "")}`;
			const inserted = await tx
				.insert(diningReviews)
				.values({
					anonymous: input.anonymous,
					authorDisplayName: input.actor.displayName,
					authorId: input.actor.principalId,
					authorKind: input.actor.kind,
					body: input.body,
					createdAt,
					idempotencyKey: input.idempotencyKey,
					menuItemId: input.menuItemId ?? null,
					submissionId: input.submissionId ?? null,
					reviewId,
					submissionDate,
					updatedAt: createdAt,
					updatedBy: input.actor.principalId,
				})
				.returning();
			const review = inserted[0];
			if (!review) {
				throw new Error("Dining review insert returned no record.");
			}
			return toPublicContentReview(review, input.actor.principalId, false);
		});
	}

	return {
		async getWindowMenu(windowId) {
			const db = await getDb();
			const publishedMap = await loadPublishedMap(db);
			if (!publishedMapHasWindow(publishedMap, windowId)) {
				throw notFound("dining_window_not_found", "未找到该食堂窗口。");
			}
			const rows = await db
				.select({
					menuItemId: diningMenuItems.menuItemId,
					name: diningMenuItems.name,
					priceText: diningMenuItems.priceText,
					sortOrder: diningMenuItems.sortOrder,
				})
				.from(diningMenuItems)
				.where(and(eq(diningMenuItems.windowId, windowId), isNull(diningMenuItems.archivedAt)))
				.orderBy(asc(diningMenuItems.sortOrder), asc(diningMenuItems.menuItemId));
			return DiningWindowMenuResponseSchema.parse({ items: rows, windowId });
		},

		async listReviews(input) {
			return DiningReviewPageSchema.parse(await listTargetReviews(input));
		},
		async listSubmissionReviews(input) {
			return DiningSubmissionReviewPageSchema.parse(await listTargetReviews(input));
		},
		async createReview(input) {
			return DiningReviewSchema.parse(await createTargetReview(input));
		},
		async createSubmissionReview(input) {
			return DiningSubmissionReviewSchema.parse(await createTargetReview(input));
		},

		async deleteOwnReview(input) {
			const db = await getDb();
			const deletedAt = now();
			const rows = await db
				.update(diningReviews)
				.set({ deletedAt, deletedBy: input.userId, updatedAt: deletedAt, updatedBy: input.userId })
				.where(
					and(
						eq(diningReviews.reviewId, input.reviewId),
						eq(diningReviews.authorKind, "member"),
						eq(diningReviews.authorId, input.userId),
						isNull(diningReviews.deletedAt),
					),
				)
				.returning({ reviewId: diningReviews.reviewId });
			if (!rows[0]) {
				throw notFound("dining_review_not_found", "未找到可删除的评价。");
			}
		},

		async reportReview(input) {
			const db = await getDb();
			return db.transaction(async (tx) => {
				await lockSubmissionActor(tx, input.userId);
				const [review] = await tx
					.select()
					.from(diningReviews)
					.where(eq(diningReviews.reviewId, input.reviewId))
					.for("update");
				if (!review) {
					throw notFound("dining_review_not_found", "未找到可举报的评价。");
				}
				const [existing] = await tx
					.select({ reportId: diningReviewReports.reportId })
					.from(diningReviewReports)
					.where(
						and(
							eq(diningReviewReports.reviewId, input.reviewId),
							eq(diningReviewReports.reporterUserId, input.userId),
						),
					);
				if (existing) {
					return existing;
				}
				if (review.hiddenAt || review.deletedAt || review.body === null) {
					throw notFound("dining_review_not_found", "未找到可举报的评价。");
				}
				await requirePublicTarget(
					tx,
					review.submissionId === null
						? { menuItemId: review.menuItemId as string }
						: { submissionId: review.submissionId },
					true,
				);
				if (review.authorKind === "member" && review.authorId === input.userId) {
					throw new AppApiRouteError({
						code: "dining_review_self_report_forbidden",
						message: "不能举报自己的评价，可以直接删除。",
						retryable: false,
						status: 400,
					});
				}
				const createdAt = now();
				const [report] = await tx
					.insert(diningReviewReports)
					.values({
						createdAt,
						contentExpiresAt:
							review.submissionId === null ? null : new Date(createdAt.getTime() + RETENTION_MS),
						details: input.details,
						reason: input.reason,
						reporterUserId: input.userId,
						reportId: `drp_${crypto.randomUUID().replaceAll("-", "")}`,
						reviewId: input.reviewId,
						targetRevision: review.contentRevision,
					})
					.returning({ reportId: diningReviewReports.reportId });
				if (!report) {
					throw new Error("Dining report insert returned no record.");
				}
				return report;
			});
		},

		async reportSubmission(input) {
			const db = await getDb();
			return db.transaction(async (tx) => {
				await lockSubmissionActor(tx, input.userId);
				const [target] = await tx
					.select()
					.from(diningSubmissions)
					.where(eq(diningSubmissions.submissionId, input.submissionId))
					.for("update");
				if (!target) {
					throw submissionNotFound();
				}
				const [existing] = await tx
					.select({ reportId: diningSubmissionReports.reportId })
					.from(diningSubmissionReports)
					.where(
						and(
							eq(diningSubmissionReports.submissionId, input.submissionId),
							eq(diningSubmissionReports.reporterUserId, input.userId),
						),
					);
				if (existing) {
					return existing;
				}
				const submission = await requirePublicSubmission(tx, input.submissionId);
				if (submission.authorId === input.userId) {
					throw new AppApiRouteError({
						code: "dining_submission_self_report_forbidden",
						status: 403,
						message: "不能举报自己的投稿，可以直接删除。",
						retryable: false,
					});
				}
				const createdAt = now();
				const [report] = await tx
					.insert(diningSubmissionReports)
					.values({
						createdAt,
						contentExpiresAt: new Date(createdAt.getTime() + RETENTION_MS),
						details: input.details,
						reason: input.reason,
						reporterUserId: input.userId,
						reportId: `dsr_${crypto.randomUUID().replaceAll("-", "")}`,
						submissionId: input.submissionId,
						targetRevision: submission.contentRevision,
					})
					.returning({ reportId: diningSubmissionReports.reportId });
				if (!report) {
					throw new Error("Dining submission report insert returned no record.");
				}
				return report;
			});
		},
	};
}

async function loadPublishedMap(db: DiningExecutor): Promise<DiningMapResponse> {
	const rows = await db
		.select({ payload: diningMapReleases.publicPayloadJson })
		.from(diningMapPublication)
		.innerJoin(diningMapReleases, eq(diningMapPublication.releaseId, diningMapReleases.releaseId))
		.where(eq(diningMapPublication.scope, "global"))
		.limit(1);
	const parsed = DiningMapResponseSchema.safeParse(rows[0]?.payload);
	if (!parsed.success) {
		throw new AppApiRouteError({
			code: "dining_map_not_published",
			message: "食堂地图尚未发布。",
			retryable: false,
			status: 404,
		});
	}
	return parsed.data;
}

async function requirePublicMenuItem(db: DiningExecutor, menuItemId: string) {
	const rows = await db
		.select({ menuItemId: diningMenuItems.menuItemId, windowId: diningMenuItems.windowId })
		.from(diningMenuItems)
		.where(and(eq(diningMenuItems.menuItemId, menuItemId), isNull(diningMenuItems.archivedAt)))
		.limit(1);
	const item = rows[0];
	if (!item) {
		throw notFound("dining_menu_item_not_found", "未找到该菜品。");
	}
	const publishedMap = await loadPublishedMap(db);
	if (!publishedMapHasWindow(publishedMap, item.windowId)) {
		throw notFound("dining_menu_item_not_found", "未找到该菜品。");
	}
	return item;
}

function targetCondition(target: ReviewTarget) {
	return target.submissionId === undefined
		? eq(diningReviews.menuItemId, target.menuItemId)
		: eq(diningReviews.submissionId, target.submissionId);
}

async function requirePublicTarget(db: DiningExecutor, target: ReviewTarget, lock = false) {
	if (target.submissionId === undefined) {
		return requirePublicMenuItem(db, target.menuItemId);
	}
	return requirePublicSubmission(db, target.submissionId, lock);
}

async function requirePublicSubmission(db: DiningExecutor, submissionId: string, lock = false) {
	const query = db
		.select()
		.from(diningSubmissions)
		.where(and(eq(diningSubmissions.submissionId, submissionId), publicSubmissionCondition));
	const [row] = await (lock ? query.for("update") : query);
	if (!(row?.windowId && (await publishedWindowIds(db)).has(row.windowId))) {
		throw submissionNotFound();
	}
	return row;
}

function publishedMapHasWindow(map: DiningMapResponse, windowId: string): boolean {
	return map.halls.some((hall) =>
		hall.floors.some((floor) => floor.windows.some((window) => window.windowId === windowId)),
	);
}

function toPublicContentReview(
	row: {
		anonymous: boolean;
		authorDisplayName: string | null;
		authorId: string | null;
		authorKind: string;
		body: string | null;
		createdAt: Date;
		editedAt: Date | null;
		menuItemId: string | null;
		submissionId: string | null;
		reviewId: string;
	},
	viewerUserId: string | null,
	hasReported: boolean,
): DiningReview | DiningSubmissionReview {
	if (
		row.authorDisplayName === null ||
		row.authorId === null ||
		row.body === null ||
		(row.menuItemId === null && row.submissionId === null)
	) {
		throw new Error("Dining review has been purged or has no target.");
	}
	const owned = row.authorKind === "member" && row.authorId === viewerUserId;
	return {
		anonymous: row.anonymous,
		authorName: row.anonymous ? null : row.authorDisplayName,
		body: row.body,
		canDelete: owned,
		canReport: Boolean(viewerUserId) && !owned && !hasReported,
		createdAt: row.createdAt.toISOString(),
		edited: row.editedAt !== null,
		hasReported,
		...(row.menuItemId === null
			? { submissionId: row.submissionId as string }
			: { menuItemId: row.menuItemId }),
		reviewId: row.reviewId,
	};
}

function dateInTimeZone(value: Date, timeZone: string): string {
	const parts = new Intl.DateTimeFormat("en-US", {
		day: "2-digit",
		month: "2-digit",
		timeZone,
		year: "numeric",
	}).formatToParts(value);
	const byType = new Map(parts.map((part) => [part.type, part.value]));
	return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function encodeReviewCursor(input: { createdAt: Date; reviewId: string }): string {
	return btoa(JSON.stringify([input.createdAt.toISOString(), input.reviewId]));
}

function decodeReviewCursor(value: string): { createdAt: Date; reviewId: string } {
	try {
		const parsed = JSON.parse(atob(value)) as unknown;
		if (
			!Array.isArray(parsed) ||
			parsed.length !== 2 ||
			typeof parsed[0] !== "string" ||
			typeof parsed[1] !== "string" ||
			!parsed[1]
		) {
			throw new Error("invalid cursor");
		}
		const createdAt = new Date(parsed[0]);
		if (Number.isNaN(createdAt.valueOf())) {
			throw new Error("invalid cursor date");
		}
		return { createdAt, reviewId: parsed[1] };
	} catch {
		throw new AppApiRouteError({
			code: "dining_review_cursor_invalid",
			message: "评价分页位置无效。",
			retryable: false,
			status: 400,
		});
	}
}

function notFound(code: string, message: string): AppApiRouteError {
	return new AppApiRouteError({ code, message, retryable: false, status: 404 });
}

function conflict(code: string, message: string): AppApiRouteError {
	return new AppApiRouteError({ code, message, retryable: false, status: 409 });
}
