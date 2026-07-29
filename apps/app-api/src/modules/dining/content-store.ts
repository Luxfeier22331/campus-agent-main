import {
	type DiningMapResponse,
	DiningMapResponseSchema,
	type DiningReportReason,
	type DiningReview,
	type DiningReviewPage,
	DiningReviewPageSchema,
	DiningReviewSchema,
	type DiningWindowMenuResponse,
	DiningWindowMenuResponseSchema,
} from "@campus-agent/dining/domain";
import { and, asc, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Env } from "../../config";
import {
	createRuntimeDbGetter,
	type RuntimeDatabase,
	type RuntimeDbGetter,
} from "../../db/runtime";
import {
	diningMapPublication,
	diningMapReleases,
	diningMenuItems,
	diningReviewReports,
	diningReviews,
} from "../../db/schema";
import { AppApiRouteError } from "../../http";

const MEMBER_DAILY_REVIEW_LIMIT = 3;
const PRODUCT_TIME_ZONE = "Asia/Shanghai";

type DiningTransaction = Parameters<Parameters<RuntimeDatabase["transaction"]>[0]>[0];
type DiningExecutor = RuntimeDatabase | DiningTransaction;

export interface DiningReviewActor {
	displayName: string;
	kind: "member" | "operator";
	principalId: string;
}

export interface DiningContentService {
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

export function createPgDiningContentService(
	env: Env,
	options: { getDb?: RuntimeDbGetter; now?: () => Date } = {},
): DiningContentService {
	const getDb = options.getDb ?? createRuntimeDbGetter(env);
	const now = options.now ?? (() => new Date());

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
			const db = await getDb();
			await requirePublicMenuItem(db, input.menuItemId);
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
					reviewId: diningReviews.reviewId,
				})
				.from(diningReviews)
				.where(
					and(
						eq(diningReviews.menuItemId, input.menuItemId),
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
				toPublicReview(row, input.viewerUserId, Boolean(row.hasReported)),
			);
			const last = pageRows.at(-1);
			return DiningReviewPageSchema.parse({
				items,
				nextCursor:
					hasMore && last
						? encodeReviewCursor({ createdAt: last.createdAt, reviewId: last.reviewId })
						: null,
			});
		},

		async createReview(input) {
			const db = await getDb();
			const createdAt = now();
			const submissionDate = dateInTimeZone(createdAt, PRODUCT_TIME_ZONE);
			return db.transaction(async (tx) => {
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
						replay[0].menuItemId !== input.menuItemId ||
						replay[0].anonymous !== input.anonymous ||
						replay[0].body !== input.body
					) {
						throw conflict("dining_review_idempotency_conflict", "该提交标识已用于其他评价。");
					}
					return toPublicReview(replay[0], input.actor.principalId, false);
				}

				await requirePublicMenuItem(tx, input.menuItemId);
				if (input.actor.kind === "member") {
					const countRows = await tx
						.select({ count: sql<number>`count(*)::int` })
						.from(diningReviews)
						.where(
							and(
								eq(diningReviews.authorKind, "member"),
								eq(diningReviews.authorId, input.actor.principalId),
								eq(diningReviews.menuItemId, input.menuItemId),
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
						menuItemId: input.menuItemId,
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
				return DiningReviewSchema.parse(toPublicReview(review, input.actor.principalId, false));
			});
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
				const reviews = await tx
					.select({
						authorId: diningReviews.authorId,
						authorKind: diningReviews.authorKind,
						reviewId: diningReviews.reviewId,
					})
					.from(diningReviews)
					.where(
						and(
							eq(diningReviews.reviewId, input.reviewId),
							isNull(diningReviews.hiddenAt),
							isNull(diningReviews.deletedAt),
						),
					)
					.limit(1);
				const review = reviews[0];
				if (!review) {
					throw notFound("dining_review_not_found", "未找到可举报的评价。");
				}
				if (review.authorKind === "member" && review.authorId === input.userId) {
					throw new AppApiRouteError({
						code: "dining_review_self_report_forbidden",
						message: "不能举报自己的评价，可以直接删除。",
						retryable: false,
						status: 400,
					});
				}
				const reportId = `drp_${crypto.randomUUID().replaceAll("-", "")}`;
				const inserted = await tx
					.insert(diningReviewReports)
					.values({
						createdAt: now(),
						details: input.details,
						reason: input.reason,
						reporterUserId: input.userId,
						reportId,
						reviewId: input.reviewId,
					})
					.onConflictDoNothing({
						target: [diningReviewReports.reviewId, diningReviewReports.reporterUserId],
					})
					.returning({ reportId: diningReviewReports.reportId });
				if (inserted[0]) {
					return inserted[0];
				}
				const existing = await tx
					.select({ reportId: diningReviewReports.reportId })
					.from(diningReviewReports)
					.where(
						and(
							eq(diningReviewReports.reviewId, input.reviewId),
							eq(diningReviewReports.reporterUserId, input.userId),
						),
					)
					.limit(1);
				if (!existing[0]) {
					throw new Error("Dining report conflict did not return the existing report.");
				}
				return existing[0];
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

function publishedMapHasWindow(map: DiningMapResponse, windowId: string): boolean {
	return map.halls.some((hall) =>
		hall.floors.some((floor) => floor.windows.some((window) => window.windowId === windowId)),
	);
}

function toPublicReview(
	row: {
		anonymous: boolean;
		authorDisplayName: string;
		authorId: string;
		authorKind: string;
		body: string;
		createdAt: Date;
		editedAt: Date | null;
		menuItemId: string;
		reviewId: string;
	},
	viewerUserId: string | null,
	hasReported: boolean,
): DiningReview {
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
		menuItemId: row.menuItemId,
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
