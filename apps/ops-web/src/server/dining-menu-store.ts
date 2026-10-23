import { randomUUID } from "node:crypto";
import type { DiningMenuItemRecord } from "@campus-agent/dining/domain";
import { canonicalizeDiningFloorplanBundle } from "@campus-agent/dining/floorplans";
import type { PoolClient } from "pg";
import type { DiningMenuStore, DiningOpsActor } from "./dining-store-contract.ts";
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

export function createPgDiningMenuStore(input: {
	now?: () => Date;
	pool: DiningDatabasePool;
}): DiningMenuStore {
	const now = input.now ?? (() => new Date());
	return {
		async verifyReadiness() {
			await withDiningStoreErrors(() =>
				input.pool.query("select 1 from dining.menu_items limit 1"),
			);
		},

		async listMenuItems() {
			return withDiningStoreErrors(async () => {
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
			return withDiningStoreErrors(() =>
				diningTransaction(input.pool, async (client) => {
					await client.query(
						"select pg_advisory_xact_lock_shared(hashtextextended('dining-publication', 0))",
					);
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
			return withDiningStoreErrors(async () => {
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
			return withDiningStoreErrors(() =>
				diningTransaction(input.pool, async (client) => {
					await client.query(
						"select pg_advisory_xact_lock_shared(hashtextextended('dining-publication', 0))",
					);
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
			return withDiningStoreErrors(() =>
				diningTransaction(input.pool, async (client) => {
					await client.query(
						"select pg_advisory_xact_lock_shared(hashtextextended('dining-publication', 0))",
					);
					const existing = await loadMenuItem(client, menuItemId, true);
					await assertDraftWindow(client, existing.windowId);
					return updateArchiveState(client, actor, menuItemId, now(), false);
				}),
			);
		},

		async reorderMenuItems(actor, windowId, menuItemIds) {
			return withDiningStoreErrors(() =>
				diningTransaction(input.pool, async (client) => {
					await client.query(
						"select pg_advisory_xact_lock_shared(hashtextextended('dining-publication', 0))",
					);
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
	};
}

export function createUnavailableDiningMenuStore(error: unknown): DiningMenuStore {
	const unavailable = async (): Promise<never> => {
		throw new DiningStoreUnavailableError("食堂菜单存储不可用。", { cause: error });
	};
	return {
		archiveMenuItem: unavailable,
		createMenuItem: unavailable,
		listMenuItems: unavailable,
		moveMenuItem: unavailable,
		reorderMenuItems: unavailable,
		restoreMenuItem: unavailable,
		updateMenuItem: unavailable,
		verifyReadiness: unavailable,
	};
}

async function updateArchiveState(
	db: DiningDatabase,
	actor: DiningOpsActor,
	menuItemId: string,
	now: Date,
	archive: boolean,
): Promise<DiningMenuItemRecord> {
	return withDiningStoreErrors(async () => {
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
