import { randomUUID } from "node:crypto";

import { TransportRouteInputSchema } from "@campus-agent/transport/domain";
import type { Pool, PoolClient } from "pg";

import {
	NoticeTransportPeriodsResponseSchema,
	type TransportNoticeLinkInput,
	TransportNoticeLinksResponseSchema,
	type TransportOpsActor,
	type TransportOpsRoute,
	TransportOpsRouteSchema,
	type TransportOpsScheduleItem,
	TransportOpsScheduleItemSchema,
	type TransportOpsSchedulePeriod,
	type TransportOpsSchedulePeriodInput,
	TransportOpsSchedulePeriodSchema,
	type TransportStore,
} from "./transport-store-contract.ts";
import {
	TransportStoreConflictError,
	TransportStoreNotFoundError,
	TransportStoreValidationError,
	withTransportStoreErrors,
} from "./transport-store-errors.ts";

type TransportDatabase = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export function createPgTransportStore(input: {
	now?: () => Date;
	pool: Pick<Pool, "connect" | "query">;
}): TransportStore {
	const now = input.now ?? (() => new Date());

	return {
		async listSchedulePeriodNotices(scheduleId) {
			return withTransportStoreErrors(async () => {
				await requireSchedulePeriod(input.pool, scheduleId);
				return readNoticeLinks(input.pool, scheduleId);
			});
		},
		async replaceSchedulePeriodNotices(scheduleId, links) {
			return withTransportStoreErrors(() =>
				transaction(input.pool, async (client) => {
					const result = await client.query(
						"SELECT schedule_id FROM transport.schedule_periods WHERE schedule_id = $1 FOR UPDATE",
						[scheduleId],
					);
					if (!result.rowCount) {
						throw new TransportStoreNotFoundError("班次时间段不存在。");
					}
					await writeNoticeLinks(client, scheduleId, links);
					return readNoticeLinks(client, scheduleId);
				}),
			);
		},
		async listNoticeSchedulePeriods(noticeId) {
			return withTransportStoreErrors(async () => {
				const notice = await input.pool.query(
					"SELECT notice_id FROM notices.notices WHERE notice_id=$1",
					[noticeId],
				);
				if (!notice.rowCount) {
					throw new TransportStoreNotFoundError("通知不存在。");
				}
				const result = await input.pool.query(
					`SELECT p.schedule_id AS "scheduleId", p.route_id AS "routeId",
					r.origin, r.destination, p.valid_from::text AS "validFrom", p.valid_to::text AS "validTo",
					p.weekdays, p.status, l.summary
					FROM transport.schedule_period_notices l
					JOIN transport.schedule_periods p USING (schedule_id)
					JOIN transport.routes r USING (route_id)
					WHERE l.notice_id=$1 ORDER BY p.valid_from DESC, r.display_order, p.schedule_id`,
					[noticeId],
				);
				return NoticeTransportPeriodsResponseSchema.parse({ schedulePeriods: result.rows })
					.schedulePeriods;
			});
		},
		async listRoutes() {
			return withTransportStoreErrors(async () => {
				const result = await input.pool.query(
					`SELECT route_id, origin, destination, service_kind, default_boarding_point,
					        display_order, created_at, updated_at, updated_by, drop_off_point, boarding_guide
					 FROM transport.routes
					 ORDER BY display_order, route_id`,
				);
				return result.rows.map(toRoute);
			});
		},

		async createRoute(actor, routeInput) {
			return withTransportStoreErrors(async () => {
				const timestamp = now().toISOString();
				try {
					await input.pool.query(
						`INSERT INTO transport.routes
						 (route_id, origin, destination, service_kind, default_boarding_point,
						  display_order, created_at, updated_at, updated_by, drop_off_point, boarding_guide)
						 VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10)`,
						[
							routeInput.routeId,
							routeInput.origin,
							routeInput.destination,
							routeInput.serviceKind,
							routeInput.defaultBoardingPoint,
							routeInput.displayOrder,
							timestamp,
							actor.principalId,
							routeInput.dropOffPoint,
							routeInput.boardingGuide,
						],
					);
				} catch (error) {
					if (isUniqueViolation(error)) {
						throw new TransportStoreConflictError("线路标识已存在。", {
							routeId: routeInput.routeId,
						});
					}
					throw error;
				}
				return requireRoute(input.pool, routeInput.routeId);
			});
		},

		async updateRoute(actor, routeId, routeInput) {
			return withTransportStoreErrors(async () => {
				const current = await requireRoute(input.pool, routeId);
				const updated = TransportRouteInputSchema.parse({
					defaultBoardingPoint:
						routeInput.defaultBoardingPoint === undefined
							? current.defaultBoardingPoint
							: routeInput.defaultBoardingPoint,
					dropOffPoint:
						routeInput.dropOffPoint === undefined ? current.dropOffPoint : routeInput.dropOffPoint,
					boardingGuide:
						routeInput.boardingGuide === undefined
							? current.boardingGuide
							: routeInput.boardingGuide,
					destination: routeInput.destination ?? current.destination,
					displayOrder: routeInput.displayOrder ?? current.displayOrder,
					origin: routeInput.origin ?? current.origin,
					routeId,
					serviceKind: routeInput.serviceKind ?? current.serviceKind,
				});
				await input.pool.query(
					`UPDATE transport.routes
					 SET origin = $2, destination = $3, service_kind = $4,
					     default_boarding_point = $5, display_order = $6,
					     updated_at = $7, updated_by = $8, drop_off_point = $9, boarding_guide = $10
					 WHERE route_id = $1`,
					[
						routeId,
						updated.origin,
						updated.destination,
						updated.serviceKind,
						updated.defaultBoardingPoint,
						updated.displayOrder,
						now().toISOString(),
						actor.principalId,
						updated.dropOffPoint,
						updated.boardingGuide,
					],
				);
				return requireRoute(input.pool, routeId);
			});
		},

		async deleteRoute(_actor, routeId) {
			return withTransportStoreErrors(async () => {
				await requireRoute(input.pool, routeId);
				const dependent = await input.pool.query(
					`SELECT
						 (SELECT count(*) FROM transport.schedule_periods WHERE route_id = $1)::text AS schedule_periods`,
					[routeId],
				);
				const row = dependent.rows[0] ?? {};
				if (Number(row.schedule_periods ?? 0) > 0) {
					throw new TransportStoreConflictError("线路仍有关联时间段，请先清理关联内容。", {
						routeId,
					});
				}
				const deleted = await input.pool.query("DELETE FROM transport.routes WHERE route_id = $1", [
					routeId,
				]);
				if (deleted.rowCount !== 1) {
					throw new TransportStoreNotFoundError("线路不存在。");
				}
			});
		},

		async listSchedulePeriods() {
			return withTransportStoreErrors(async () => listSchedulePeriods(input.pool));
		},

		async createSchedulePeriod(actor, periodInput) {
			return withTransportStoreErrors(async () =>
				transaction(input.pool, async (client) => {
					await requireRoute(client, periodInput.routeId);
					const scheduleId = `schedule:${randomUUID().replaceAll("-", "")}`;
					await insertSchedulePeriod(client, actor, scheduleId, periodInput, now());
					const noticeLinks = periodInput.noticeLinks ?? [];
					if (noticeLinks.length > 0) {
						await writeNoticeLinks(client, scheduleId, noticeLinks);
					}
					return requireSchedulePeriod(client, scheduleId);
				}),
			);
		},

		async updateSchedulePeriod(actor, scheduleId, periodInput) {
			return withTransportStoreErrors(async () =>
				transaction(input.pool, async (client) => {
					await requireSchedulePeriod(client, scheduleId);
					await requireRoute(client, periodInput.routeId);
					await updateSchedulePeriodRow(client, actor, scheduleId, periodInput, now());
					return requireSchedulePeriod(client, scheduleId);
				}),
			);
		},

		async deleteSchedulePeriod(_actor, scheduleId) {
			return withTransportStoreErrors(async () => {
				const result = await input.pool.query(
					"DELETE FROM transport.schedule_periods WHERE schedule_id = $1",
					[scheduleId],
				);
				if (result.rowCount !== 1) {
					throw new TransportStoreNotFoundError("班次时间段不存在。");
				}
			});
		},
	};
}

async function readNoticeLinks(db: TransportDatabase, scheduleId: string) {
	const result = await db.query(
		`SELECT l.notice_id::text AS "noticeId", l.summary, n.title,
		n.released_at AS "releasedAt", n.is_published AS "isPublished"
		FROM transport.schedule_period_notices l JOIN notices.notices n USING (notice_id)
		WHERE l.schedule_id=$1 ORDER BY n.released_at DESC, n.notice_id DESC`,
		[scheduleId],
	);
	return TransportNoticeLinksResponseSchema.parse({
		noticeLinks: result.rows.map((row) => ({
			...row,
			noticeId: Number(row.noticeId),
			releasedAt: new Date(row.releasedAt).toISOString(),
		})),
	}).noticeLinks;
}

async function writeNoticeLinks(
	db: TransportDatabase,
	scheduleId: string,
	links: TransportNoticeLinkInput[],
) {
	if (links.length > 0) {
		const notices = await db.query(
			"SELECT notice_id FROM notices.notices WHERE notice_id=ANY($1::bigint[]) FOR KEY SHARE",
			[links.map((link) => link.noticeId)],
		);
		if (notices.rowCount !== links.length) {
			throw new TransportStoreValidationError("所选通知不存在或重复，请重新选择。");
		}
	}
	await db.query("DELETE FROM transport.schedule_period_notices WHERE schedule_id=$1", [
		scheduleId,
	]);
	for (const link of links) {
		await db.query(
			"INSERT INTO transport.schedule_period_notices (schedule_id, notice_id, summary) VALUES ($1,$2,$3)",
			[scheduleId, link.noticeId, link.summary],
		);
	}
}

async function listSchedulePeriods(db: TransportDatabase): Promise<TransportOpsSchedulePeriod[]> {
	const [periodResult, itemResult] = await Promise.all([
		db.query(
			`SELECT schedule_id, route_id, valid_from::text, valid_to::text, weekdays, status,
			        boarding_point_override, drop_off_point_override, note, created_at, updated_at, updated_by
			 FROM transport.schedule_periods
			 ORDER BY valid_from DESC, schedule_id`,
		),
		db.query(
			`SELECT item_id, schedule_id, kind, boarding_point, departure_time,
			        first_departure_time, last_departure_time, interval_minutes,
			        rider_type, capacity, note, sort_order
			 FROM transport.schedule_items
			 ORDER BY schedule_id, sort_order, item_id`,
		),
	]);
	const itemsBySchedule = groupRows(itemResult.rows, (row) => String(row.schedule_id));
	return periodResult.rows.map((row) =>
		toSchedulePeriod(row, itemsBySchedule.get(String(row.schedule_id)) ?? []),
	);
}

async function insertSchedulePeriod(
	client: TransportDatabase,
	actor: TransportOpsActor,
	scheduleId: string,
	periodInput: TransportOpsSchedulePeriodInput,
	timestamp: Date,
): Promise<void> {
	await client.query(
		`INSERT INTO transport.schedule_periods
		 (schedule_id, route_id, valid_from, valid_to, weekdays, status,
		  boarding_point_override, note, created_at, updated_at, updated_by, drop_off_point_override)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11)`,
		[
			scheduleId,
			periodInput.routeId,
			periodInput.validFrom,
			periodInput.validTo,
			periodInput.weekdays,
			periodInput.status,
			periodInput.boardingPointOverride,
			periodInput.note,
			timestamp.toISOString(),
			actor.principalId,
			periodInput.dropOffPointOverride ?? null,
		],
	);
	await replaceScheduleItems(client, scheduleId, periodInput.items);
}

async function updateSchedulePeriodRow(
	client: TransportDatabase,
	actor: TransportOpsActor,
	scheduleId: string,
	periodInput: TransportOpsSchedulePeriodInput,
	timestamp: Date,
): Promise<void> {
	await client.query(
		`UPDATE transport.schedule_periods
		 SET route_id = $2, valid_from = $3, valid_to = $4, weekdays = $5,
		     status = $6, boarding_point_override = $7, note = $8,
		     updated_at = $9, updated_by = $10, drop_off_point_override = $11
		 WHERE schedule_id = $1`,
		[
			scheduleId,
			periodInput.routeId,
			periodInput.validFrom,
			periodInput.validTo,
			periodInput.weekdays,
			periodInput.status,
			periodInput.boardingPointOverride,
			periodInput.note,
			timestamp.toISOString(),
			actor.principalId,
			periodInput.dropOffPointOverride ?? null,
		],
	);
	await replaceScheduleItems(client, scheduleId, periodInput.items);
}

async function replaceScheduleItems(
	client: TransportDatabase,
	scheduleId: string,
	items: TransportOpsSchedulePeriodInput["items"],
): Promise<void> {
	await client.query("DELETE FROM transport.schedule_items WHERE schedule_id = $1", [scheduleId]);
	for (const item of items) {
		await client.query(
			`INSERT INTO transport.schedule_items
			 (item_id, schedule_id, kind, boarding_point, departure_time,
			  first_departure_time, last_departure_time, interval_minutes,
			  rider_type, capacity, note, sort_order)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
			[
				`${scheduleId}:${item.sortOrder}`,
				scheduleId,
				item.kind,
				item.boardingPoint,
				item.kind === "fixed" ? item.departureTime : null,
				item.kind === "interval" ? item.firstDepartureTime : null,
				item.kind === "interval" ? item.lastDepartureTime : null,
				item.kind === "interval" ? item.intervalMinutes : null,
				item.riderType,
				item.capacity,
				item.note,
				item.sortOrder,
			],
		);
	}
}

async function requireRoute(db: TransportDatabase, routeId: string): Promise<TransportOpsRoute> {
	const result = await db.query(
		`SELECT route_id, origin, destination, service_kind, default_boarding_point,
		        display_order, created_at, updated_at, updated_by, drop_off_point, boarding_guide
		 FROM transport.routes WHERE route_id = $1`,
		[routeId],
	);
	const row = result.rows[0];
	if (!row) {
		throw new TransportStoreNotFoundError("线路不存在。");
	}
	return toRoute(row);
}

async function requireSchedulePeriod(
	db: TransportDatabase,
	scheduleId: string,
): Promise<TransportOpsSchedulePeriod> {
	const result = await db.query(
		`SELECT schedule_id, route_id, valid_from::text, valid_to::text, weekdays, status,
		        boarding_point_override, drop_off_point_override, note, created_at, updated_at, updated_by
		 FROM transport.schedule_periods WHERE schedule_id = $1`,
		[scheduleId],
	);
	const row = result.rows[0];
	if (!row) {
		throw new TransportStoreNotFoundError("班次时间段不存在。");
	}
	const items = await db.query(
		`SELECT item_id, schedule_id, kind, boarding_point, departure_time,
		        first_departure_time, last_departure_time, interval_minutes,
		        rider_type, capacity, note, sort_order
		 FROM transport.schedule_items
		 WHERE schedule_id = $1
		 ORDER BY sort_order, item_id`,
		[scheduleId],
	);
	return toSchedulePeriod(row, items.rows);
}

function toRoute(row: Record<string, unknown>): TransportOpsRoute {
	return TransportOpsRouteSchema.parse({
		boardingGuide: nullableText(row.boarding_guide),
		dropOffPoint: nullableText(row.drop_off_point),
		createdAt: isoDateTime(row.created_at),
		defaultBoardingPoint: nullableText(row.default_boarding_point),
		destination: String(row.destination),
		displayOrder: Number(row.display_order),
		origin: String(row.origin),
		routeId: String(row.route_id),
		serviceKind: String(row.service_kind),
		updatedAt: isoDateTime(row.updated_at),
		updatedBy: String(row.updated_by),
	});
}

function toSchedulePeriod(
	row: Record<string, unknown>,
	itemRows: readonly Record<string, unknown>[],
): TransportOpsSchedulePeriod {
	return TransportOpsSchedulePeriodSchema.parse({
		boardingPointOverride: nullableText(row.boarding_point_override),
		dropOffPointOverride: nullableText(row.drop_off_point_override),
		createdAt: isoDateTime(row.created_at),
		items: itemRows.map(toScheduleItem),
		note: nullableText(row.note),
		routeId: String(row.route_id),
		scheduleId: String(row.schedule_id),
		status: String(row.status),
		updatedAt: isoDateTime(row.updated_at),
		updatedBy: String(row.updated_by),
		validFrom: String(row.valid_from),
		validTo: row.valid_to === null || row.valid_to === undefined ? null : String(row.valid_to),
		weekdays: toNumberArray(row.weekdays),
	});
}

function toScheduleItem(row: Record<string, unknown>): TransportOpsScheduleItem {
	const kind = String(row.kind);
	if (kind === "fixed") {
		return TransportOpsScheduleItemSchema.parse({
			boardingPoint: nullableText(row.boarding_point),
			capacity: nullableNumber(row.capacity),
			departureTime: requiredText(row.departure_time, "固定班次时间"),
			itemId: String(row.item_id),
			kind,
			note: nullableText(row.note),
			riderType: String(row.rider_type),
			sortOrder: Number(row.sort_order),
		});
	}
	if (kind === "interval") {
		return TransportOpsScheduleItemSchema.parse({
			boardingPoint: nullableText(row.boarding_point),
			capacity: nullableNumber(row.capacity),
			firstDepartureTime: requiredText(row.first_departure_time, "首班时间"),
			intervalMinutes: Number(row.interval_minutes),
			itemId: String(row.item_id),
			kind,
			lastDepartureTime: requiredText(row.last_departure_time, "末班时间"),
			note: nullableText(row.note),
			riderType: String(row.rider_type),
			sortOrder: Number(row.sort_order),
		});
	}
	throw new Error(`未知班次类型: ${kind}`);
}

function groupRows(
	rows: readonly Record<string, unknown>[],
	key: (row: Record<string, unknown>) => string,
): Map<string, Record<string, unknown>[]> {
	const grouped = new Map<string, Record<string, unknown>[]>();
	for (const row of rows) {
		const group = grouped.get(key(row)) ?? [];
		group.push(row);
		grouped.set(key(row), group);
	}
	return grouped;
}

function toNumberArray(value: unknown): number[] {
	if (!Array.isArray(value)) {
		throw new Error("星期字段无效");
	}
	return value.map((item) => Number(item));
}

function nullableNumber(value: unknown): number | null {
	return value === null || value === undefined ? null : Number(value);
}

function nullableText(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredText(value: unknown, field: string): string {
	const text = nullableText(value);
	if (!text) {
		throw new Error(`${field}为空`);
	}
	return text;
}

function isoDateTime(value: unknown): string {
	const date = value instanceof Date ? value : new Date(String(value));
	if (Number.isNaN(date.valueOf())) {
		throw new Error("班车数据库时间字段无效。");
	}
	return date.toISOString();
}

function isUniqueViolation(error: unknown): boolean {
	return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

async function transaction<T>(
	pool: Pick<Pool, "connect">,
	callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const result = await callback(client);
		await client.query("COMMIT");
		return result;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}
