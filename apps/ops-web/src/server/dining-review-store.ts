import { randomUUID } from "node:crypto";
import type {
	DiningOpsContentReportRecord,
	DiningOpsContentReviewEditRecord,
	DiningOpsContentReviewPage,
	DiningOpsContentReviewRecord,
	DiningOpsReviewSnapshot,
	DiningReportReason,
} from "@campus-agent/dining/domain";
import type { PoolClient } from "pg";
import type { DiningReviewStore } from "./dining-store-contract.ts";
import {
	type DiningDatabase,
	type DiningDatabasePool,
	diningTransaction,
	isoDate,
	nullableIsoDate,
	nullableString,
	requiredString,
	withDiningStoreErrors,
} from "./dining-store-database.ts";
import {
	DiningStoreConflictError,
	DiningStoreNotFoundError,
	DiningStoreUnavailableError,
	DiningStoreValidationError,
} from "./dining-store-errors.ts";

import {
	loadOpsSubmissionRow,
	projectOpsSubmission,
	resolveSubmissionSnapshot,
} from "./dining-submission-projection.ts";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PRODUCT_TIME_ZONE = "Asia/Shanghai";

export function createPgDiningReviewStore(input: {
	now?: () => Date;
	pool: DiningDatabasePool;
}): DiningReviewStore {
	const now = input.now ?? (() => new Date());
	return {
		async listReviews(filters) {
			return withDiningStoreErrors(async () => {
				const { clause, values } = buildReviewWhere(filters);
				const result = await input.pool.query(
					`select review.*, item.name as menu_item_name, coalesce(item.window_id, submission.window_id) as window_id,
 submission.name as submission_name, submission.purged_at as submission_purged_at, submission.expires_at as submission_expires_at,
						(select count(*)::int from dining.review_edits edit where edit.review_id = review.review_id) as edit_count
					 from dining.reviews review
					 left join dining.menu_items item on item.menu_item_id = review.menu_item_id
 left join dining.submissions submission on submission.submission_id = review.submission_id
					 ${clause}
					 order by review.created_at desc, review.review_id desc
					 limit $${values.length + 1}`,
					[...values, Math.min(Math.max(filters.limit, 1), 100) + 1],
				);
				return reviewPage(result.rows, filters.limit, now());
			});
		},

		async getReview(reviewId) {
			return withDiningStoreErrors(() =>
				diningTransaction(input.pool, async (client) => {
					const review = await loadReview(client, reviewId, true);
					const edits = await client.query(
						"select * from dining.review_edits where review_id = $1 order by edited_at desc, edit_id desc",
						[reviewId],
					);
					const at = now();
					return {
						review: rowToOpsReview(review, at),
						edits: edits.rows.map((row) => rowToReviewEdit(row, at, review)),
					};
				}),
			);
		},

		async createReview(actor, value) {
			return withDiningStoreErrors(() =>
				diningTransaction(input.pool, async (client) => {
					const existing = await client.query(
						`select review.*, item.name as menu_item_name, coalesce(item.window_id, submission.window_id) as window_id,
 submission.name as submission_name, submission.purged_at as submission_purged_at, submission.expires_at as submission_expires_at,
							0::int as edit_count
						 from dining.reviews review left join dining.menu_items item on item.menu_item_id = review.menu_item_id
 left join dining.submissions submission on submission.submission_id = review.submission_id
						 where review.author_kind = 'operator' and review.author_id = $1 and review.idempotency_key = $2`,
						[actor.principalId, value.idempotencyKey],
					);
					if (existing.rows[0]) {
						const replay = existing.rows[0];
						if (
							replay.menu_item_id !== value.menuItemId ||
							replay.body !== value.body ||
							replay.anonymous !== value.anonymous
						) {
							throw new DiningStoreConflictError("该提交标识已用于其他评价。");
						}
						return rowToOpsReview(replay, now());
					}
					const menuItem = await loadMenuItem(client, value.menuItemId);
					if (menuItem.archivedAt) {
						throw new DiningStoreConflictError("已归档菜品不能新增评价。");
					}
					const createdAt = now();
					const result = await client.query(
						`insert into dining.reviews
						 (review_id, menu_item_id, author_kind, author_id, author_display_name,
						  anonymous, body, idempotency_key, submission_date, created_at, updated_at, updated_by)
						 values ($1, $2, 'operator', $3, $4, $5, $6, $7, $8, $9, $9, $3)
						 returning *, $10::text as menu_item_name, $11::text as window_id, 0::int as edit_count`,
						[
							`drv_${randomUUID().replaceAll("-", "")}`,
							value.menuItemId,
							actor.principalId,
							actor.displayName,
							value.anonymous,
							value.body,
							value.idempotencyKey,
							dateInTimeZone(createdAt, PRODUCT_TIME_ZONE),
							createdAt.toISOString(),
							menuItem.name,
							menuItem.windowId,
						],
					);
					return rowToOpsReview(result.rows[0], now());
				}),
			);
		},

		async updateReview(actor, reviewId, body) {
			return withDiningStoreErrors(() =>
				diningTransaction(input.pool, async (client) => {
					const current = await loadReview(client, reviewId, true);
					if (
						current.deleted_at ||
						!reviewContentAvailable(current, now()) ||
						current.body === null
					) {
						throw new DiningStoreConflictError("已删除的评价不能修改。");
					}
					if (current.body === body) {
						return rowToOpsReview(current, now());
					}
					const editedAt = now().toISOString();
					await client.query(
						`insert into dining.review_edits
					 (edit_id, review_id, previous_body, next_body, edited_at, edited_by, previous_revision, next_revision, expires_at)
					 values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
						[
							`dre_${randomUUID().replaceAll("-", "")}`,
							reviewId,
							current.body,
							body,
							editedAt,
							actor.principalId,
							Number(current.content_revision),
							Number(current.content_revision) + 1,
							current.submission_id
								? new Date(Date.parse(editedAt) + RETENTION_MS).toISOString()
								: null,
						],
					);
					const result = await client.query(
						`update dining.reviews set body = $1, content_revision = content_revision + 1, edited_at = $2, updated_at = $2, updated_by = $3
						 where review_id = $4 returning *`,
						[body, editedAt, actor.principalId, reviewId],
					);
					return hydrateReview(client, result.rows[0], now());
				}),
			);
		},

		async setReviewVisibility(actor, reviewId, visible) {
			return withDiningStoreErrors(() =>
				diningTransaction(input.pool, async (client) => {
					const current = await loadReview(client, reviewId, true);
					const at = now();
					if (current.deleted_at) {
						throw new DiningStoreNotFoundError("未找到可处理的评价。");
					}
					if (visible && (current.body == null || !reviewContentAvailable(current, at))) {
						throw new DiningStoreConflictError("已清理的评价不能恢复公开。");
					}
					const changedAt = at.toISOString();
					const result = await client.query(
						"update dining.reviews set hidden_at = $1, hidden_by = $2, updated_at = $3, updated_by = $4 where review_id = $5 returning *",
						visible
							? [null, null, changedAt, actor.principalId, reviewId]
							: [changedAt, actor.principalId, changedAt, actor.principalId, reviewId],
					);
					if (!visible) {
						await client.query(
							`update dining.review_reports set resolution = 'hide', resolved_at = $1, resolved_by = $2 where review_id = $3 and resolved_at is null`,
							[changedAt, actor.principalId, reviewId],
						);
					}
					return hydrateReview(client, result.rows[0], at);
				}),
			);
		},

		async deleteOperatorReview(actor, reviewId) {
			return withDiningStoreErrors(async () => {
				const deletedAt = now().toISOString();
				const result = await input.pool.query(
					`update dining.reviews set deleted_at = $1, deleted_by = $2,
					 updated_at = $1, updated_by = $2
					 where review_id = $3 and author_kind = 'operator' and deleted_at is null
					 returning review_id`,
					[deletedAt, actor.principalId, reviewId],
				);
				if (!result.rows[0]) {
					throw new DiningStoreNotFoundError("未找到可删除的运营评价。");
				}
			});
		},

		async listReports(filters) {
			return withDiningStoreErrors(async () => {
				validateTargetFilters(filters);
				const values: unknown[] = [];
				const conditions = [
					filters.status === "pending"
						? "report.resolved_at is null"
						: "report.resolved_at is not null",
				];
				for (const [value, column] of [
					[filters.targetType, "target_type"],
					[filters.submissionId, "submission_id"],
					[filters.menuItemId, "menu_item_id"],
				] as const) {
					if (value) {
						values.push(value);
						conditions.push(`report.${column} = $${values.length}`);
					}
				}
				if (filters.cursor) {
					const cursor = decodeReportCursor(filters.cursor);
					values.push(cursor.createdAt, cursor.id, cursor.kind);
					conditions.push(
						`(report.created_at, report.report_id, report.target_type) < ($${values.length - 2}::timestamptz, $${values.length - 1}, $${values.length})`,
					);
				}
				const size = Math.min(Math.max(filters.limit, 1), 100);
				values.push(size + 1);
				const result = await input.pool.query(
					`select * from (
					 select report.created_at, report.details, report.reason, report.report_id,
 report.reporter_user_id, report.resolution, report.resolved_at, report.resolved_by,
 report.content_expires_at, report.target_revision, report.review_id,
 'review'::text as target_type, review.submission_id, review.menu_item_id
					 from dining.review_reports report join dining.reviews review using (review_id)
					 union all
					 select report.created_at, report.details, report.reason, report.report_id,
					 report.reporter_user_id, report.resolution, report.resolved_at, report.resolved_by,
					 report.content_expires_at, report.target_revision, null::text as review_id,
					 'submission'::text as target_type, report.submission_id, null::text as menu_item_id
					 from dining.submission_reports report
					) report where ${conditions.join(" and ")}
					order by report.created_at desc, report.report_id desc, report.target_type desc limit $${values.length}`,
					values,
				);
				const rows = result.rows.slice(0, size);
				const last = rows.at(-1);
				return {
					items: await Promise.all(
						rows.map((row) =>
							diningTransaction(input.pool, (client) => rowToOpsReport(client, row, now())),
						),
					),
					nextCursor:
						result.rows.length > size && last
							? Buffer.from(
									JSON.stringify([
										isoDate(last.created_at),
										String(last.report_id),
										String(last.target_type),
									]),
								).toString("base64url")
							: null,
				};
			});
		},

		async resolveReports(actor, reviewId, resolution) {
			return withDiningStoreErrors(() =>
				diningTransaction(input.pool, async (client) => {
					await loadReview(client, reviewId, true);
					const resolvedAt = now().toISOString();
					const reports = await client.query(
						`update dining.review_reports set resolution = $1, resolved_at = $2, resolved_by = $3
						 where review_id = $4 and resolved_at is null returning report_id`,
						[resolution, resolvedAt, actor.principalId, reviewId],
					);
					if (reports.rowCount === 0) {
						throw new DiningStoreConflictError("该评价没有待处理举报。");
					}
					if (resolution === "hide") {
						await client.query(
							`update dining.reviews set hidden_at = $1, hidden_by = $2,
							 updated_at = $1, updated_by = $2 where review_id = $3 and deleted_at is null`,
							[resolvedAt, actor.principalId, reviewId],
						);
					}
				}),
			);
		},
	};
}

export function createUnavailableDiningReviewStore(error: unknown): DiningReviewStore {
	const unavailable = async (): Promise<never> => {
		throw new DiningStoreUnavailableError("食堂评价存储不可用。", { cause: error });
	};
	return {
		createReview: unavailable,
		deleteOperatorReview: unavailable,
		getReview: unavailable,
		listReports: unavailable,
		listReviews: unavailable,
		resolveReports: unavailable,
		setReviewVisibility: unavailable,
		updateReview: unavailable,
	};
}

async function loadMenuItem(
	db: Pick<PoolClient, "query">,
	menuItemId: string,
): Promise<{ archivedAt: string | null; name: string; windowId: string }> {
	const result = await db.query(
		"select archived_at, name, window_id from dining.menu_items where menu_item_id = $1",
		[menuItemId],
	);
	const row = result.rows[0];
	if (!row) {
		throw new DiningStoreNotFoundError("未找到该菜品。");
	}
	return {
		archivedAt: nullableIsoDate(row.archived_at),
		name: requiredString(row.name, "name"),
		windowId: requiredString(row.window_id, "window_id"),
	};
}

async function loadReview(db: Pick<PoolClient, "query">, reviewId: string, forUpdate: boolean) {
	const result = await db.query(
		`select review.*, item.name as menu_item_name, coalesce(item.window_id, submission.window_id) as window_id,
 submission.name as submission_name, submission.purged_at as submission_purged_at, submission.expires_at as submission_expires_at,
			(select count(*)::int from dining.review_edits edit where edit.review_id = review.review_id) as edit_count
		 from dining.reviews review left join dining.menu_items item on item.menu_item_id = review.menu_item_id
 left join dining.submissions submission on submission.submission_id = review.submission_id
		 where review.review_id = $1${forUpdate ? " for update of review" : ""}`,
		[reviewId],
	);
	if (!result.rows[0]) {
		throw new DiningStoreNotFoundError("未找到该评价。");
	}
	return result.rows[0] as Record<string, unknown>;
}

async function hydrateReview(
	db: DiningDatabase,
	review: Record<string, unknown>,
	now: Date,
): Promise<DiningOpsContentReviewRecord> {
	const result = await db.query(
		`select review.*, item.name as menu_item_name, coalesce(item.window_id, submission.window_id) as window_id,
 submission.name as submission_name, submission.purged_at as submission_purged_at, submission.expires_at as submission_expires_at,
			(select count(*)::int from dining.review_edits edit where edit.review_id = review.review_id) as edit_count
		 from dining.reviews review left join dining.menu_items item on item.menu_item_id = review.menu_item_id
 left join dining.submissions submission on submission.submission_id = review.submission_id
		 where review.review_id = $1`,
		[String(review.review_id)],
	);
	return rowToOpsReview(result.rows[0], now);
}

function buildReviewWhere(filters: {
	cursor?: string;
	menuItemId?: string;
	submissionId?: string;
	targetType?: "menu_item" | "submission";
	q?: string;
	visibility?: "visible" | "hidden" | "deleted";
	windowId?: string;
}) {
	const values: unknown[] = [];
	validateTargetFilters(filters);
	const conditions: string[] = [];
	if (filters.submissionId) {
		values.push(filters.submissionId);
		conditions.push(`review.submission_id = $${values.length}`);
	}
	if (filters.targetType) {
		conditions.push(
			filters.targetType === "submission"
				? "review.submission_id is not null"
				: "review.menu_item_id is not null",
		);
	}
	if (filters.menuItemId) {
		values.push(filters.menuItemId);
		conditions.push(`review.menu_item_id = $${values.length}`);
	}
	if (filters.windowId) {
		values.push(filters.windowId);
		conditions.push(`coalesce(item.window_id, submission.window_id) = $${values.length}`);
	}
	if (filters.q) {
		values.push(`%${filters.q}%`);
		conditions.push(
			`(review.body ilike $${values.length} or review.author_display_name ilike $${values.length} or item.name ilike $${values.length} or submission.name ilike $${values.length})`,
		);
	}
	if (filters.visibility === "visible") {
		conditions.push("review.hidden_at is null and review.deleted_at is null");
	}
	if (filters.visibility === "hidden") {
		conditions.push("review.hidden_at is not null and review.deleted_at is null");
	}
	if (filters.visibility === "deleted") {
		conditions.push("review.deleted_at is not null");
	}
	if (filters.cursor) {
		const cursor = decodeCursor(filters.cursor);
		values.push(cursor.createdAt, cursor.id);
		conditions.push(
			`(review.created_at < $${values.length - 1} or (review.created_at = $${values.length - 1} and review.review_id < $${values.length}))`,
		);
	}
	return { clause: conditions.length > 0 ? `where ${conditions.join(" and ")}` : "", values };
}

function reviewPage(
	rows: Record<string, unknown>[],
	requestedLimit: number,
	now: Date,
): DiningOpsContentReviewPage {
	const size = Math.min(Math.max(requestedLimit, 1), 100);
	const hasMore = rows.length > size;
	const pageRows = hasMore ? rows.slice(0, size) : rows;
	const last = pageRows.at(-1);
	return {
		items: pageRows.map((row) => rowToOpsReview(row, now)),
		nextCursor:
			hasMore && last
				? encodeCursor({ createdAt: isoDate(last.created_at), id: String(last.review_id) })
				: null,
	};
}

function reviewContentAvailable(row: Record<string, unknown>, now: Date): boolean {
	return (
		!row.submission_purged_at ||
		new Date(String(row.submission_purged_at)).valueOf() + RETENTION_MS > now.valueOf()
	);
}

function rowToOpsReview(row: Record<string, unknown>, now: Date): DiningOpsContentReviewRecord {
	if (!row) {
		throw new DiningStoreUnavailableError("数据库中的评价记录无效。");
	}
	const fields = {
		anonymous: row.anonymous === true,
		authorDisplayName: nullableString(row.author_display_name),
		authorId: nullableString(row.author_id),
		authorKind: row.author_kind === "operator" ? ("operator" as const) : ("member" as const),
		body: reviewContentAvailable(row, now) ? nullableString(row.body) : null,
		contentRevision: Number(row.content_revision),
		createdAt: isoDate(row.created_at),
		deletedAt: nullableIsoDate(row.deleted_at),
		editCount: Number(row.edit_count ?? 0),
		editedAt: nullableIsoDate(row.edited_at),
		hiddenAt: nullableIsoDate(row.hidden_at),
		hiddenBy: nullableString(row.hidden_by),
		reviewId: requiredString(row.review_id, "review_id"),
		updatedAt: isoDate(row.updated_at),
		updatedBy: nullableString(row.updated_by),
	};
	return row.submission_id
		? {
				...fields,
				targetKind: "submission",
				submissionId: String(row.submission_id),
				submissionName:
					row.submission_purged_at ||
					(row.submission_expires_at && new Date(String(row.submission_expires_at)) <= now)
						? null
						: nullableString(row.submission_name),
				windowId: row.submission_purged_at ? null : nullableString(row.window_id),
			}
		: {
				...fields,
				targetKind: "menu_item",
				menuItemId: requiredString(row.menu_item_id, "menu_item_id"),
				menuItemName: requiredString(row.menu_item_name, "menu_item_name"),
				windowId: requiredString(row.window_id, "window_id"),
			};
}

function rowToReviewEdit(
	row: Record<string, unknown>,
	now: Date,
	review: Record<string, unknown>,
): DiningOpsContentReviewEditRecord {
	const expiresAt = row.expires_at
		? isoDate(row.expires_at)
		: review.submission_id
			? new Date(new Date(String(row.edited_at)).valueOf() + RETENTION_MS).toISOString()
			: null;
	const fields = {
		editId: requiredString(row.edit_id, "edit_id"),
		editedAt: isoDate(row.edited_at),
		editedBy: nullableString(row.edited_by),
		expiresAt,
	};
	if (
		(expiresAt !== null && Date.parse(expiresAt) <= now.valueOf()) ||
		!reviewContentAvailable(review, now) ||
		!row.previous_body ||
		!row.next_body ||
		!row.previous_revision ||
		!row.next_revision
	) {
		return {
			...fields,
			nextRevision: row.next_revision ? Number(row.next_revision) : null,
			previousRevision: row.previous_revision ? Number(row.previous_revision) : null,
			replayable: false,
		};
	}
	return {
		...fields,
		nextBody: String(row.next_body),
		previousBody: String(row.previous_body),
		nextRevision: Number(row.next_revision),
		previousRevision: Number(row.previous_revision),
		replayable: true,
	};
}

async function reviewSnapshot(
	db: DiningDatabase,
	review: Record<string, unknown>,
	revision: number | null,
	now: Date,
): Promise<DiningOpsReviewSnapshot> {
	if (revision === null || !reviewContentAvailable(review, now)) {
		return { replayable: false };
	}
	if (revision === Number(review.content_revision)) {
		return review.body ? { replayable: true, body: String(review.body) } : { replayable: false };
	}
	// Formal menu-item review history is permanent; only submission targets expire.
	const retentionFilter = review.submission_id ? " and expires_at > $3" : "";
	const edits = await db.query(
		`select previous_body as body from dining.review_edits
	 where review_id = $1 and previous_revision = $2${retentionFilter} and previous_body is not null
	 union all select next_body as body from dining.review_edits
	 where review_id = $1 and next_revision = $2${retentionFilter} and next_body is not null limit 1`,
		review.submission_id
			? [review.review_id, revision, now.toISOString()]
			: [review.review_id, revision],
	);
	return edits.rows[0]
		? { replayable: true, body: String(edits.rows[0].body) }
		: { replayable: false };
}

async function rowToOpsReport(
	db: DiningDatabase,
	row: Record<string, unknown>,
	now: Date,
): Promise<DiningOpsContentReportRecord> {
	// Formal menu-item review reports are permanent; only submission targets expire.
	const available =
		row.target_type === "review" && row.menu_item_id != null
			? true
			: (row.content_expires_at
					? new Date(String(row.content_expires_at)).valueOf()
					: new Date(String(row.created_at)).valueOf() + RETENTION_MS) > now.valueOf();
	const targetRevision = row.target_revision == null ? null : Number(row.target_revision);
	const fields = {
		createdAt: isoDate(row.created_at),
		details: available ? nullableString(row.details) : null,
		reason: row.reason as DiningReportReason,
		reportId: requiredString(row.report_id, "report_id"),
		reporterUserId: nullableString(row.reporter_user_id),
		resolution: row.resolution === "keep" || row.resolution === "hide" ? row.resolution : null,
		resolvedAt: nullableIsoDate(row.resolved_at),
		resolvedBy: nullableString(row.resolved_by),
	} as const;
	if (row.target_type === "submission") {
		const submission = await loadOpsSubmissionRow(db, String(row.submission_id), true);
		const current = await projectOpsSubmission(db, submission, now);
		return {
			...fields,
			target: {
				kind: "submission",
				current,
				targetRevision: Number(targetRevision),
				reported: available
					? await resolveSubmissionSnapshot(db, submission, Number(targetRevision), now)
					: { replayable: false },
			},
		};
	}
	const review = await loadReview(db, String(row.review_id), true);
	return {
		...fields,
		target: {
			kind: "review",
			current: rowToOpsReview(review, now),
			targetRevision,
			reported: available
				? await reviewSnapshot(db, review, targetRevision, now)
				: { replayable: false },
		},
	};
}

function validateTargetFilters(filters: {
	menuItemId?: string;
	submissionId?: string;
	targetType?: string;
}) {
	if (
		(filters.menuItemId && filters.submissionId) ||
		(filters.targetType === "menu_item" && filters.submissionId) ||
		(filters.targetType === "submission" && filters.menuItemId)
	) {
		throw new DiningStoreValidationError("正式菜品与投稿筛选不能混用。");
	}
}

function decodeReportCursor(value: string): { createdAt: string; id: string; kind: string } {
	try {
		const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
		if (
			!Array.isArray(parsed) ||
			parsed.length !== 3 ||
			typeof parsed[0] !== "string" ||
			Number.isNaN(Date.parse(parsed[0])) ||
			typeof parsed[1] !== "string" ||
			!parsed[1] ||
			!["review", "submission"].includes(parsed[2])
		) {
			throw new Error("invalid cursor");
		}
		return { createdAt: parsed[0], id: parsed[1], kind: parsed[2] };
	} catch {
		throw new DiningStoreValidationError("分页位置无效。");
	}
}

function dateInTimeZone(value: Date, timeZone: string): string {
	const parts = new Intl.DateTimeFormat("en-US", {
		day: "2-digit",
		month: "2-digit",
		timeZone,
		year: "numeric",
	}).formatToParts(value);
	const map = new Map(parts.map((part) => [part.type, part.value]));
	return `${map.get("year")}-${map.get("month")}-${map.get("day")}`;
}

function encodeCursor(input: { createdAt: string; id: string }): string {
	return Buffer.from(JSON.stringify([input.createdAt, input.id]), "utf8").toString("base64url");
}

function decodeCursor(value: string): { createdAt: string; id: string } {
	try {
		const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
		if (
			!Array.isArray(parsed) ||
			parsed.length !== 2 ||
			typeof parsed[0] !== "string" ||
			typeof parsed[1] !== "string" ||
			!parsed[1] ||
			Number.isNaN(new Date(parsed[0]).valueOf())
		) {
			throw new Error("invalid cursor");
		}
		return { createdAt: parsed[0], id: parsed[1] };
	} catch {
		throw new DiningStoreValidationError("分页位置无效。");
	}
}
