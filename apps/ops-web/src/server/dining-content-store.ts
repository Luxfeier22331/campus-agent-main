import { randomUUID } from "node:crypto";
import type {
	DiningMenuItemRecord,
	DiningOpsReportPage,
	DiningOpsReportRecord,
	DiningOpsReviewDetail,
	DiningOpsReviewPage,
	DiningOpsReviewRecord,
	DiningReportReason,
	DiningReviewEditRecord,
} from "@campus-agent/dining/domain";
import { canonicalizeDiningFloorplanBundle } from "@campus-agent/dining/floorplans";
import { Pool, type PoolClient } from "pg";
import type { DiningOpsActor, DiningStoreEnv } from "./dining-store.ts";
import {
	DiningStoreConflictError,
	DiningStoreNotFoundError,
	DiningStoreUnavailableError,
	DiningStoreValidationError,
} from "./dining-store.ts";
import { resolvePostgresTlsConfig } from "./postgres-tls.ts";

const PRODUCT_TIME_ZONE = "Asia/Shanghai";

export interface DiningContentStore {
	archiveMenuItem(actor: DiningOpsActor, menuItemId: string): Promise<DiningMenuItemRecord>;
	createMenuItem(
		actor: DiningOpsActor,
		input: { name: string; priceText: string | null; windowId: string },
	): Promise<DiningMenuItemRecord>;
	createReview(
		actor: DiningOpsActor,
		input: { anonymous: boolean; body: string; idempotencyKey: string; menuItemId: string },
	): Promise<DiningOpsReviewRecord>;
	deleteOperatorReview(actor: DiningOpsActor, reviewId: string): Promise<void>;
	getReview(reviewId: string): Promise<DiningOpsReviewDetail>;
	listMenuItems(): Promise<DiningMenuItemRecord[]>;
	listReports(input: {
		cursor?: string;
		limit: number;
		status: "pending" | "resolved";
	}): Promise<DiningOpsReportPage>;
	listReviews(input: {
		cursor?: string;
		limit: number;
		menuItemId?: string;
		q?: string;
		visibility?: "visible" | "hidden" | "deleted";
		windowId?: string;
	}): Promise<DiningOpsReviewPage>;
	moveMenuItem(
		actor: DiningOpsActor,
		menuItemId: string,
		windowId: string,
	): Promise<DiningMenuItemRecord>;
	reorderMenuItems(
		actor: DiningOpsActor,
		windowId: string,
		menuItemIds: string[],
	): Promise<DiningMenuItemRecord[]>;
	resolveReports(
		actor: DiningOpsActor,
		reviewId: string,
		resolution: "keep" | "hide",
	): Promise<void>;
	restoreMenuItem(actor: DiningOpsActor, menuItemId: string): Promise<DiningMenuItemRecord>;
	setReviewVisibility(
		actor: DiningOpsActor,
		reviewId: string,
		visible: boolean,
	): Promise<DiningOpsReviewRecord>;
	updateMenuItem(
		actor: DiningOpsActor,
		menuItemId: string,
		input: { name?: string; priceText?: string | null },
	): Promise<DiningMenuItemRecord>;
	updateReview(
		actor: DiningOpsActor,
		reviewId: string,
		body: string,
	): Promise<DiningOpsReviewRecord>;
	verifyReadiness(): Promise<void>;
}

export function createDiningContentStoreFromEnv(env: DiningStoreEnv): DiningContentStore {
	const databaseUrl = required(env.OPS_WEB_DATABASE_URL, "OPS_WEB_DATABASE_URL");
	const database = resolvePostgresTlsConfig({
		...(env.OPS_WEB_DATABASE_CA_CERT_PATH ? { caCertPath: env.OPS_WEB_DATABASE_CA_CERT_PATH } : {}),
		databaseUrl,
		...(env.DEPLOYMENT_ENVIRONMENT ? { deploymentEnvironment: env.DEPLOYMENT_ENVIRONMENT } : {}),
		...(env.NODE_ENV ? { nodeEnvironment: env.NODE_ENV } : {}),
		...(env.OPS_WEB_DATABASE_SSLMODE ? { sslMode: env.OPS_WEB_DATABASE_SSLMODE } : {}),
	});
	return createPgDiningContentStore({
		pool: new Pool({
			connectionString: database.connectionString,
			max: env.NODE_ENV === "test" ? 1 : 4,
			ssl: database.ssl,
		}),
	});
}

export function createPgDiningContentStore(input: {
	now?: () => Date;
	pool: Pick<Pool, "connect" | "query">;
}): DiningContentStore {
	const now = input.now ?? (() => new Date());
	return {
		async verifyReadiness() {
			await withErrors(() => input.pool.query("select 1 from dining.menu_items limit 1"));
		},

		async listMenuItems() {
			return withErrors(async () => {
				const result = await input.pool.query(`
					select menu_item_id, window_id, name, price_text, sort_order, archived_at,
						created_at, created_by, updated_at, updated_by
					from dining.menu_items
					order by archived_at nulls first, window_id, sort_order, menu_item_id
				`);
				return result.rows.map(rowToMenuItem);
			});
		},

		async createMenuItem(actor, value) {
			return withErrors(() =>
				transaction(input.pool, async (client) => {
					await assertDraftWindow(client, value.windowId);
					await lockMenuWindow(client, value.windowId);
					const createdAt = now().toISOString();
					const order = await client.query(
						`select coalesce(max(sort_order), -1) + 1 as next_order
						 from dining.menu_items where window_id = $1 and archived_at is null`,
						[value.windowId],
					);
					const result = await client.query(
						`insert into dining.menu_items
						 (menu_item_id, window_id, name, price_text, sort_order, created_at, created_by, updated_at, updated_by)
						 values ($1, $2, $3, $4, $5, $6, $7, $6, $7)
						 returning *`,
						[
							`dmi_${randomUUID().replaceAll("-", "")}`,
							value.windowId,
							value.name,
							value.priceText,
							Number(order.rows[0]?.next_order ?? 0),
							createdAt,
							actor.principalId,
						],
					);
					return rowToMenuItem(result.rows[0]);
				}),
			);
		},

		async updateMenuItem(actor, menuItemId, value) {
			return withErrors(async () => {
				const fields: string[] = [];
				const values: unknown[] = [];
				if (value.name !== undefined) {
					values.push(value.name);
					fields.push(`name = $${values.length}`);
				}
				if (value.priceText !== undefined) {
					values.push(value.priceText);
					fields.push(`price_text = $${values.length}`);
				}
				if (fields.length === 0) {
					throw new DiningStoreValidationError("没有需要修改的菜品字段。");
				}
				values.push(now().toISOString(), actor.principalId, menuItemId);
				const result = await input.pool.query(
					`update dining.menu_items set ${fields.join(", ")},
					 updated_at = $${values.length - 2}, updated_by = $${values.length - 1}
					 where menu_item_id = $${values.length} returning *`,
					values,
				);
				return requireMenuItem(result.rows[0]);
			});
		},

		async moveMenuItem(actor, menuItemId, windowId) {
			return withErrors(() =>
				transaction(input.pool, async (client) => {
					await assertDraftWindow(client, windowId);
					await lockMenuWindow(client, windowId);
					const order = await client.query(
						`select coalesce(max(sort_order), -1) + 1 as next_order
						 from dining.menu_items where window_id = $1 and archived_at is null`,
						[windowId],
					);
					const result = await client.query(
						`update dining.menu_items set window_id = $1, sort_order = $2,
						 updated_at = $3, updated_by = $4 where menu_item_id = $5 returning *`,
						[
							windowId,
							Number(order.rows[0]?.next_order ?? 0),
							now().toISOString(),
							actor.principalId,
							menuItemId,
						],
					);
					return requireMenuItem(result.rows[0]);
				}),
			);
		},

		async archiveMenuItem(actor, menuItemId) {
			return updateArchiveState(input.pool, actor, menuItemId, now(), true);
		},

		async restoreMenuItem(actor, menuItemId) {
			return withErrors(() =>
				transaction(input.pool, async (client) => {
					const existing = await loadMenuItem(client, menuItemId, true);
					await assertDraftWindow(client, existing.windowId);
					return updateArchiveState(client, actor, menuItemId, now(), false);
				}),
			);
		},

		async reorderMenuItems(actor, windowId, menuItemIds) {
			return withErrors(() =>
				transaction(input.pool, async (client) => {
					await assertDraftWindow(client, windowId);
					await lockMenuWindow(client, windowId);
					const current = await client.query(
						`select menu_item_id from dining.menu_items
						 where window_id = $1 and archived_at is null order by sort_order, menu_item_id for update`,
						[windowId],
					);
					const actual = current.rows.map((row) => String(row.menu_item_id)).sort();
					const requested = [...new Set(menuItemIds)].sort();
					if (actual.join("\u0000") !== requested.join("\u0000")) {
						throw new DiningStoreConflictError("菜品排序列表已变化，请刷新后重试。");
					}
					const updatedAt = now().toISOString();
					for (const [sortOrder, menuItemId] of menuItemIds.entries()) {
						await client.query(
							`update dining.menu_items set sort_order = $1, updated_at = $2, updated_by = $3
							 where menu_item_id = $4`,
							[sortOrder, updatedAt, actor.principalId, menuItemId],
						);
					}
					const result = await client.query(
						`select * from dining.menu_items
						 where window_id = $1 and archived_at is null order by sort_order, menu_item_id`,
						[windowId],
					);
					return result.rows.map(rowToMenuItem);
				}),
			);
		},

		async listReviews(filters) {
			return withErrors(async () => {
				const { clause, values } = buildReviewWhere(filters);
				const result = await input.pool.query(
					`select review.*, item.name as menu_item_name, item.window_id,
						(select count(*)::int from dining.review_edits edit where edit.review_id = review.review_id) as edit_count
					 from dining.reviews review
					 join dining.menu_items item on item.menu_item_id = review.menu_item_id
					 ${clause}
					 order by review.created_at desc, review.review_id desc
					 limit $${values.length + 1}`,
					[...values, Math.min(Math.max(filters.limit, 1), 100) + 1],
				);
				return reviewPage(result.rows, filters.limit);
			});
		},

		async getReview(reviewId) {
			return withErrors(async () => {
				const [reviewResult, editsResult] = await Promise.all([
					input.pool.query(
						`select review.*, item.name as menu_item_name, item.window_id,
							(select count(*)::int from dining.review_edits edit where edit.review_id = review.review_id) as edit_count
						 from dining.reviews review join dining.menu_items item on item.menu_item_id = review.menu_item_id
						 where review.review_id = $1`,
						[reviewId],
					),
					input.pool.query(
						`select edit_id, previous_body, next_body, edited_at, edited_by
						 from dining.review_edits where review_id = $1 order by edited_at desc, edit_id desc`,
						[reviewId],
					),
				]);
				if (!reviewResult.rows[0]) {
					throw new DiningStoreNotFoundError("未找到该评价。");
				}
				return {
					edits: editsResult.rows.map(rowToReviewEdit),
					review: rowToOpsReview(reviewResult.rows[0]),
				};
			});
		},

		async createReview(actor, value) {
			return withErrors(() =>
				transaction(input.pool, async (client) => {
					const existing = await client.query(
						`select review.*, item.name as menu_item_name, item.window_id,
							0::int as edit_count
						 from dining.reviews review join dining.menu_items item on item.menu_item_id = review.menu_item_id
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
						return rowToOpsReview(replay);
					}
					const menuItem = await loadMenuItem(client, value.menuItemId, false);
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
					return rowToOpsReview(result.rows[0]);
				}),
			);
		},

		async updateReview(actor, reviewId, body) {
			return withErrors(() =>
				transaction(input.pool, async (client) => {
					const current = await loadReview(client, reviewId, true);
					if (current.deleted_at) {
						throw new DiningStoreConflictError("已删除的评价不能修改。");
					}
					if (current.body === body) {
						return rowToOpsReview(current);
					}
					const editedAt = now().toISOString();
					await client.query(
						`insert into dining.review_edits
						 (edit_id, review_id, previous_body, next_body, edited_at, edited_by)
						 values ($1, $2, $3, $4, $5, $6)`,
						[
							`dre_${randomUUID().replaceAll("-", "")}`,
							reviewId,
							current.body,
							body,
							editedAt,
							actor.principalId,
						],
					);
					const result = await client.query(
						`update dining.reviews set body = $1, edited_at = $2, updated_at = $2, updated_by = $3
						 where review_id = $4 returning *`,
						[body, editedAt, actor.principalId, reviewId],
					);
					return hydrateReview(client, result.rows[0]);
				}),
			);
		},

		async setReviewVisibility(actor, reviewId, visible) {
			return withErrors(async () => {
				const changedAt = now().toISOString();
				const result = await input.pool.query(
					`update dining.reviews set hidden_at = $1, hidden_by = $2,
					 updated_at = $3, updated_by = $4
					 where review_id = $5 and deleted_at is null returning *`,
					visible
						? [null, null, changedAt, actor.principalId, reviewId]
						: [changedAt, actor.principalId, changedAt, actor.principalId, reviewId],
				);
				if (!result.rows[0]) {
					throw new DiningStoreNotFoundError("未找到可处理的评价。");
				}
				return hydrateReview(input.pool, result.rows[0]);
			});
		},

		async deleteOperatorReview(actor, reviewId) {
			return withErrors(async () => {
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
			return withErrors(async () => {
				const values: unknown[] = [];
				const where = [
					filters.status === "pending"
						? "report.resolved_at is null"
						: "report.resolved_at is not null",
				];
				if (filters.cursor) {
					const cursor = decodeCursor(filters.cursor);
					values.push(cursor.createdAt, cursor.id);
					where.push(
						`(report.created_at < $${values.length - 1} or (report.created_at = $${values.length - 1} and report.report_id < $${values.length}))`,
					);
				}
				values.push(Math.min(Math.max(filters.limit, 1), 100) + 1);
				const result = await input.pool.query(
					`select review.*, item.name as menu_item_name, item.window_id,
						report.report_id, report.reporter_user_id, report.reason as report_reason,
						report.details as report_details, report.created_at as report_created_at,
						report.resolution as report_resolution, report.resolved_at as report_resolved_at,
						report.resolved_by as report_resolved_by,
						(select count(*)::int from dining.review_edits edit where edit.review_id = review.review_id) as edit_count
					 from dining.review_reports report
					 join dining.reviews review on review.review_id = report.review_id
					 join dining.menu_items item on item.menu_item_id = review.menu_item_id
					 where ${where.join(" and ")}
					 order by report.created_at desc, report.report_id desc limit $${values.length}`,
					values,
				);
				const size = Math.min(Math.max(filters.limit, 1), 100);
				const hasMore = result.rows.length > size;
				const rows = hasMore ? result.rows.slice(0, size) : result.rows;
				const last = rows.at(-1);
				return {
					items: rows.map(rowToOpsReport),
					nextCursor:
						hasMore && last
							? encodeCursor({
									createdAt: isoDate(last.report_created_at),
									id: String(last.report_id),
								})
							: null,
				};
			});
		},

		async resolveReports(actor, reviewId, resolution) {
			return withErrors(() =>
				transaction(input.pool, async (client) => {
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

export function createUnavailableDiningContentStore(error: unknown): DiningContentStore {
	const unavailable = async (): Promise<never> => {
		throw new DiningStoreUnavailableError("食堂内容存储不可用。", { cause: error });
	};
	return {
		archiveMenuItem: unavailable,
		createMenuItem: unavailable,
		createReview: unavailable,
		deleteOperatorReview: unavailable,
		getReview: unavailable,
		listMenuItems: unavailable,
		listReports: unavailable,
		listReviews: unavailable,
		moveMenuItem: unavailable,
		reorderMenuItems: unavailable,
		resolveReports: unavailable,
		restoreMenuItem: unavailable,
		setReviewVisibility: unavailable,
		updateMenuItem: unavailable,
		updateReview: unavailable,
		verifyReadiness: unavailable,
	};
}

async function updateArchiveState(
	db: Pick<Pool, "query"> | Pick<PoolClient, "query">,
	actor: DiningOpsActor,
	menuItemId: string,
	now: Date,
	archive: boolean,
): Promise<DiningMenuItemRecord> {
	return withErrors(async () => {
		const changedAt = now.toISOString();
		const result = await db.query(
			`update dining.menu_items set archived_at = $1, updated_at = $2, updated_by = $3
			 where menu_item_id = $4 returning *`,
			[archive ? changedAt : null, changedAt, actor.principalId, menuItemId],
		);
		return requireMenuItem(result.rows[0]);
	});
}

async function assertDraftWindow(db: Pick<PoolClient, "query">, windowId: string): Promise<void> {
	const result = await db.query("select bundle_json from dining.map_draft where scope = 'global'");
	if (!result.rows[0]) {
		throw new DiningStoreNotFoundError("食堂地图尚未初始化。");
	}
	const bundle = canonicalizeDiningFloorplanBundle(result.rows[0].bundle_json);
	const ids = new Set(
		bundle.layouts.flatMap((layout) =>
			layout.windows.map((window) => `${layout.hallId}:${layout.floorId}:${window.anchorId}`),
		),
	);
	if (!ids.has(windowId)) {
		throw new DiningStoreValidationError("目标窗口不在当前地图草稿中。");
	}
}

async function lockMenuWindow(db: Pick<PoolClient, "query">, windowId: string): Promise<void> {
	await db.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
		`dining-menu-window:${windowId}`,
	]);
}

async function loadMenuItem(
	db: Pick<PoolClient, "query">,
	menuItemId: string,
	forUpdate: boolean,
): Promise<DiningMenuItemRecord> {
	const result = await db.query(
		`select * from dining.menu_items where menu_item_id = $1${forUpdate ? " for update" : ""}`,
		[menuItemId],
	);
	return requireMenuItem(result.rows[0]);
}

async function loadReview(db: Pick<PoolClient, "query">, reviewId: string, forUpdate: boolean) {
	const result = await db.query(
		`select review.*, item.name as menu_item_name, item.window_id,
			(select count(*)::int from dining.review_edits edit where edit.review_id = review.review_id) as edit_count
		 from dining.reviews review join dining.menu_items item on item.menu_item_id = review.menu_item_id
		 where review.review_id = $1${forUpdate ? " for update of review" : ""}`,
		[reviewId],
	);
	if (!result.rows[0]) {
		throw new DiningStoreNotFoundError("未找到该评价。");
	}
	return result.rows[0] as Record<string, unknown>;
}

async function hydrateReview(
	db: Pick<Pool, "query"> | Pick<PoolClient, "query">,
	review: Record<string, unknown>,
): Promise<DiningOpsReviewRecord> {
	const result = await db.query(
		`select review.*, item.name as menu_item_name, item.window_id,
			(select count(*)::int from dining.review_edits edit where edit.review_id = review.review_id) as edit_count
		 from dining.reviews review join dining.menu_items item on item.menu_item_id = review.menu_item_id
		 where review.review_id = $1`,
		[String(review.review_id)],
	);
	return rowToOpsReview(result.rows[0]);
}

function buildReviewWhere(filters: {
	cursor?: string;
	menuItemId?: string;
	q?: string;
	visibility?: "visible" | "hidden" | "deleted";
	windowId?: string;
}) {
	const values: unknown[] = [];
	const conditions: string[] = [];
	if (filters.menuItemId) {
		values.push(filters.menuItemId);
		conditions.push(`review.menu_item_id = $${values.length}`);
	}
	if (filters.windowId) {
		values.push(filters.windowId);
		conditions.push(`item.window_id = $${values.length}`);
	}
	if (filters.q) {
		values.push(`%${filters.q}%`);
		conditions.push(
			`(review.body ilike $${values.length} or review.author_display_name ilike $${values.length} or item.name ilike $${values.length})`,
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

function reviewPage(rows: Record<string, unknown>[], requestedLimit: number): DiningOpsReviewPage {
	const size = Math.min(Math.max(requestedLimit, 1), 100);
	const hasMore = rows.length > size;
	const pageRows = hasMore ? rows.slice(0, size) : rows;
	const last = pageRows.at(-1);
	return {
		items: pageRows.map(rowToOpsReview),
		nextCursor:
			hasMore && last
				? encodeCursor({ createdAt: isoDate(last.created_at), id: String(last.review_id) })
				: null,
	};
}

function rowToMenuItem(row: Record<string, unknown>): DiningMenuItemRecord {
	return {
		archivedAt: nullableIsoDate(row.archived_at),
		createdAt: isoDate(row.created_at),
		createdBy: requiredString(row.created_by, "created_by"),
		menuItemId: requiredString(row.menu_item_id, "menu_item_id"),
		name: requiredString(row.name, "name"),
		priceText: nullableString(row.price_text),
		sortOrder: Number(row.sort_order),
		updatedAt: isoDate(row.updated_at),
		updatedBy: requiredString(row.updated_by, "updated_by"),
		windowId: requiredString(row.window_id, "window_id"),
	};
}

function requireMenuItem(row: Record<string, unknown> | undefined): DiningMenuItemRecord {
	if (!row) {
		throw new DiningStoreNotFoundError("未找到该菜品。");
	}
	return rowToMenuItem(row);
}

function rowToOpsReview(row: Record<string, unknown>): DiningOpsReviewRecord {
	if (!row) {
		throw new DiningStoreUnavailableError("数据库中的评价记录无效。");
	}
	return {
		anonymous: row.anonymous === true,
		authorDisplayName: requiredString(row.author_display_name, "author_display_name"),
		authorId: requiredString(row.author_id, "author_id"),
		authorKind: row.author_kind === "operator" ? "operator" : "member",
		body: requiredString(row.body, "body"),
		createdAt: isoDate(row.created_at),
		deletedAt: nullableIsoDate(row.deleted_at),
		editCount: Number(row.edit_count ?? 0),
		editedAt: nullableIsoDate(row.edited_at),
		hiddenAt: nullableIsoDate(row.hidden_at),
		hiddenBy: nullableString(row.hidden_by),
		menuItemId: requiredString(row.menu_item_id, "menu_item_id"),
		menuItemName: requiredString(row.menu_item_name, "menu_item_name"),
		reviewId: requiredString(row.review_id, "review_id"),
		updatedAt: isoDate(row.updated_at),
		updatedBy: requiredString(row.updated_by, "updated_by"),
		windowId: requiredString(row.window_id, "window_id"),
	};
}

function rowToReviewEdit(row: Record<string, unknown>): DiningReviewEditRecord {
	return {
		editId: requiredString(row.edit_id, "edit_id"),
		editedAt: isoDate(row.edited_at),
		editedBy: requiredString(row.edited_by, "edited_by"),
		nextBody: requiredString(row.next_body, "next_body"),
		previousBody: requiredString(row.previous_body, "previous_body"),
	};
}

function rowToOpsReport(row: Record<string, unknown>): DiningOpsReportRecord {
	return {
		createdAt: isoDate(row.report_created_at),
		details: nullableString(row.report_details),
		reason: row.report_reason as DiningReportReason,
		reportId: requiredString(row.report_id, "report_id"),
		reporterUserId: requiredString(row.reporter_user_id, "reporter_user_id"),
		resolution:
			row.report_resolution === "keep" || row.report_resolution === "hide"
				? row.report_resolution
				: null,
		resolvedAt: nullableIsoDate(row.report_resolved_at),
		resolvedBy: nullableString(row.report_resolved_by),
		review: rowToOpsReview(row),
	};
}

async function transaction<T>(
	pool: Pick<Pool, "connect">,
	callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
	const client = await pool.connect();
	try {
		await client.query("begin");
		const result = await callback(client);
		await client.query("commit");
		return result;
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
}

async function withErrors<T>(callback: () => Promise<T>): Promise<T> {
	try {
		return await callback();
	} catch (error) {
		if (
			error instanceof DiningStoreConflictError ||
			error instanceof DiningStoreNotFoundError ||
			error instanceof DiningStoreUnavailableError ||
			error instanceof DiningStoreValidationError
		) {
			throw error;
		}
		throw new DiningStoreUnavailableError("食堂内容数据库请求失败。", { cause: error });
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

function isoDate(value: unknown): string {
	const date = value instanceof Date ? value : new Date(String(value));
	if (Number.isNaN(date.valueOf())) {
		throw new DiningStoreUnavailableError("数据库时间字段无效。");
	}
	return date.toISOString();
}

function nullableIsoDate(value: unknown): string | null {
	return value === null || value === undefined ? null : isoDate(value);
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value) {
		throw new DiningStoreUnavailableError(`数据库中的 ${field} 无效。`);
	}
	return value;
}

function nullableString(value: unknown): string | null {
	return typeof value === "string" && value ? value : null;
}

function required(value: string | undefined, name: string): string {
	const normalized = value?.trim();
	if (!normalized) {
		throw new DiningStoreUnavailableError(`${name} is required.`);
	}
	return normalized;
}
