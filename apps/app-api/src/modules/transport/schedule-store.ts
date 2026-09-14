import {
	selectTransportPeriod,
	type TransportPublicDeparture,
	type TransportPublicNotice,
	TransportPublicNoticeSchema,
	type TransportPublicScheduleRange,
	TransportPublicScheduleRangeSchema,
	type TransportPublicScheduleResponse,
	TransportPublicScheduleResponseSchema,
	type TransportRouteInput,
	TransportRouteInputSchema,
	type TransportScheduleItem,
	TransportScheduleItemSchema,
	type TransportSchedulePeriodInput,
	TransportSchedulePeriodInputSchema,
	transportDateRange,
} from "@campus-agent/transport/domain";
import {
	transportRoutes,
	transportScheduleItems,
	transportSchedulePeriods,
} from "@campus-agent/transport/schema";
import { asc, sql } from "drizzle-orm";
import type { RuntimeDatabase, RuntimeDbGetter } from "../../db/runtime";
import { AppApiRouteError } from "../../http";

export type { TransportPublicScheduleResponse as TransportScheduleResponse } from "@campus-agent/transport/domain";

export interface TransportScheduleService {
	getSchedule(
		date: string,
		options?: { includeNotices: boolean },
	): Promise<TransportPublicScheduleResponse>;
	getRange(
		from: string,
		to: string,
		options?: { includeNotices: boolean },
	): Promise<TransportPublicScheduleRange>;
}

type RouteRow = typeof transportRoutes.$inferSelect;
type PeriodRow = typeof transportSchedulePeriods.$inferSelect;
type ItemRow = typeof transportScheduleItems.$inferSelect;

interface ParsedRoute {
	readonly input: TransportRouteInput;
}

interface ParsedPeriod {
	readonly input: TransportSchedulePeriodInput;
	readonly scheduleId: string;
	readonly updatedAt: string;
}

export function createPgTransportScheduleService(options: {
	getDb: RuntimeDbGetter;
}): TransportScheduleService {
	const getDb = options.getDb;
	return {
		async getSchedule(date, options) {
			const db = await getDb();
			const schedules = await loadSchedules(db);
			const notices = await loadNotices(db, schedules, options?.includeNotices ?? false);
			return projectSchedule(schedules, date, notices, options?.includeNotices ?? false);
		},
		async getRange(from, to, options) {
			const dates = transportDateRange(from, to);
			const db = await getDb();
			const schedules = await loadSchedules(db);
			const notices = await loadNotices(db, schedules, options?.includeNotices ?? false);
			const days = dates.map((date) =>
				projectSchedule(schedules, date, notices, options?.includeNotices ?? false),
			);
			return TransportPublicScheduleRangeSchema.parse({ from, to, days });
		},
	};
}

async function loadNotices(
	db: RuntimeDatabase,
	{ periodsByRoute }: Awaited<ReturnType<typeof loadSchedules>>,
	includeNotices: boolean,
) {
	const ids = new Set<string>();
	for (const periods of periodsByRoute.values()) {
		for (const period of periods) {
			ids.add(period.scheduleId);
		}
	}
	const grouped = new Map<string, TransportPublicNotice[]>();
	const sourceReleasedAt = new Map<string, string>();
	if (ids.size === 0) {
		return { grouped, sourceReleasedAt };
	}
	const result = await db.execute<{
		schedule_id: string;
		notice_id: string;
		title: string;
		released_at: Date | string;
		is_external: boolean;
		external_url: string | null;
	}>(sql`
		SELECT l.schedule_id, n.released_at ${includeNotices ? sql`, n.notice_id::text, n.title, n.is_external, n.external_url` : sql``}
		FROM transport.schedule_period_notices l
		JOIN notices.notices n ON n.notice_id = l.notice_id
		WHERE l.schedule_id IN (${sql.join(
			[...ids].map((id) => sql`${id}`),
			sql`, `,
		)})
		AND n.is_published
		ORDER BY n.released_at DESC, n.notice_id DESC
	`);
	for (const row of result.rows) {
		const releasedAt = new Date(row.released_at).toISOString();
		const currentSource = sourceReleasedAt.get(row.schedule_id);
		if (!currentSource || releasedAt > currentSource) {
			sourceReleasedAt.set(row.schedule_id, releasedAt);
		}
		if (!includeNotices) {
			continue;
		}
		const notices = grouped.get(row.schedule_id) ?? [];
		notices.push(
			TransportPublicNoticeSchema.parse({
				noticeId: row.notice_id,
				title: row.title,
				releasedAt,
				isExternal: row.is_external,
				externalUrl: row.is_external ? row.external_url : null,
			}),
		);
		grouped.set(row.schedule_id, notices);
	}
	return { grouped, sourceReleasedAt };
}

async function loadSchedules(db: RuntimeDatabase) {
	const [routeRows, periodRows, itemRows] = await Promise.all([
		db
			.select()
			.from(transportRoutes)
			.orderBy(asc(transportRoutes.displayOrder), asc(transportRoutes.routeId)),
		db
			.select()
			.from(transportSchedulePeriods)
			.orderBy(asc(transportSchedulePeriods.routeId), asc(transportSchedulePeriods.validFrom)),
		db
			.select()
			.from(transportScheduleItems)
			.orderBy(
				asc(transportScheduleItems.scheduleId),
				asc(transportScheduleItems.sortOrder),
				asc(transportScheduleItems.itemId),
			),
	]);

	const routes = routeRows.map(parseRoute);
	const itemsBySchedule = groupItems(itemRows);
	const periodsByRoute = new Map<string, ParsedPeriod[]>();
	for (const row of periodRows) {
		const period = parsePeriod(row, itemsBySchedule.get(String(row.scheduleId)) ?? []);
		const periods = periodsByRoute.get(period.input.routeId) ?? [];
		periods.push(period);
		periodsByRoute.set(period.input.routeId, periods);
	}

	return { routes, periodsByRoute };
}

function projectSchedule(
	{ routes, periodsByRoute }: Awaited<ReturnType<typeof loadSchedules>>,
	date: string,
	notices?: Awaited<ReturnType<typeof loadNotices>>,
	includeNotices = false,
): TransportPublicScheduleResponse {
	const sourceReleasedAt = notices?.sourceReleasedAt;
	const response: TransportPublicScheduleResponse = {
		date,
		routeCatalog: routes.map(({ input: { displayOrder: _order, ...route } }) => ({
			...route,
			dropOffPoint:
				selectPeriod(periodsByRoute.get(route.routeId) ?? [], date, sourceReleasedAt)?.input
					.dropOffPointOverride ?? route.dropOffPoint,
			nextServiceDate: nextServiceDate(
				periodsByRoute.get(route.routeId) ?? [],
				date,
				sourceReleasedAt,
			),
		})),
		routes: [],
	};
	for (const route of routes) {
		const period = selectPeriod(
			periodsByRoute.get(route.input.routeId) ?? [],
			date,
			sourceReleasedAt,
		);
		if (!period) {
			continue;
		}
		response.routes.push({
			...(notices && includeNotices
				? {
						noticeContext: {
							validFrom: period.input.validFrom,
							validTo: period.input.validTo,
							weekdays: period.input.weekdays,
							notices: notices.grouped.get(period.scheduleId) ?? [],
						},
					}
				: {}),
			boardingPoint: period.input.boardingPointOverride ?? route.input.defaultBoardingPoint,
			departures:
				period.input.status === "suspended"
					? []
					: period.input.items.map((item) =>
							toPublicDeparture(
								item,
								item.boardingPoint ??
									period.input.boardingPointOverride ??
									route.input.defaultBoardingPoint,
							),
						),
			destination: route.input.destination,
			note: period.input.note,
			origin: route.input.origin,
			routeId: route.input.routeId,
			serviceKind: route.input.serviceKind,
			status: period.input.status,
		});
	}

	const parsed = TransportPublicScheduleResponseSchema.safeParse(response);
	if (!parsed.success) {
		throw projectionError("班车公开投影无效。", parsed.error.flatten());
	}
	return parsed.data;
}

function parseRoute(row: RouteRow): ParsedRoute {
	try {
		return {
			input: TransportRouteInputSchema.parse({
				boardingGuide: nullableText(row.boardingGuide),
				dropOffPoint: nullableText(row.dropOffPoint),
				defaultBoardingPoint: nullableText(row.defaultBoardingPoint),
				destination: row.destination,
				displayOrder: row.displayOrder,
				origin: row.origin,
				routeId: row.routeId,
				serviceKind: row.serviceKind,
			}),
		};
	} catch (error) {
		throw projectionError("班车线路事实无效。", { cause: error, routeId: String(row.routeId) });
	}
}

function parsePeriod(row: PeriodRow, rows: readonly ItemRow[]): ParsedPeriod {
	try {
		const input = TransportSchedulePeriodInputSchema.parse({
			boardingPointOverride: nullableText(row.boardingPointOverride),
			dropOffPointOverride: nullableText(row.dropOffPointOverride),
			items: rows.map(parseItem),
			note: nullableText(row.note),
			routeId: row.routeId,
			status: row.status,
			validFrom: row.validFrom,
			validTo: row.validTo,
			weekdays: row.weekdays,
		});
		return {
			input,
			scheduleId: String(row.scheduleId),
			updatedAt: new Date(row.updatedAt).toISOString(),
		};
	} catch (error) {
		throw projectionError("班车时间段事实无效。", {
			cause: error,
			scheduleId: String(row.scheduleId),
		});
	}
}

function parseItem(row: ItemRow): TransportScheduleItem {
	try {
		const kind = String(row.kind);
		if (kind === "fixed") {
			return TransportScheduleItemSchema.parse({
				boardingPoint: nullableText(row.boardingPoint),
				capacity: row.capacity ?? null,
				departureTime: requiredText(row.departureTime, "固定班次时间"),
				kind,
				note: nullableText(row.note),
				riderType: row.riderType,
				sortOrder: row.sortOrder,
			});
		}
		if (kind === "interval") {
			return TransportScheduleItemSchema.parse({
				boardingPoint: nullableText(row.boardingPoint),
				capacity: row.capacity ?? null,
				firstDepartureTime: requiredText(row.firstDepartureTime, "首班时间"),
				intervalMinutes: row.intervalMinutes,
				kind,
				lastDepartureTime: requiredText(row.lastDepartureTime, "末班时间"),
				note: nullableText(row.note),
				riderType: row.riderType,
				sortOrder: row.sortOrder,
			});
		}
		throw new Error(`未知班次类型: ${kind}`);
	} catch (error) {
		throw projectionError("班次明细事实无效。", { cause: error, itemId: String(row.itemId) });
	}
}

function groupItems(rows: readonly ItemRow[]): Map<string, ItemRow[]> {
	const grouped = new Map<string, ItemRow[]>();
	for (const row of rows) {
		const scheduleId = String(row.scheduleId);
		const items = grouped.get(scheduleId) ?? [];
		items.push(row);
		grouped.set(scheduleId, items);
	}
	return grouped;
}

function selectPeriod(
	periods: readonly ParsedPeriod[],
	date: string,
	sourceReleasedAt?: ReadonlyMap<string, string>,
): ParsedPeriod | null {
	return selectTransportPeriod(
		periods.map((period) => ({
			...period,
			...period.input,
			sourceReleasedAt: sourceReleasedAt?.get(period.scheduleId) ?? null,
		})),
		date,
	);
}

function nextServiceDate(
	periods: readonly ParsedPeriod[],
	date: string,
	sourceReleasedAt?: ReadonlyMap<string, string>,
): string | null {
	// Between period boundaries the winning schedule repeats weekly. Check one week
	// per segment, including the final unbounded segment, rather than scanning days indefinitely.
	const boundaries = new Set([date]);
	for (const { input } of periods) {
		if (input.validFrom > date) {
			boundaries.add(input.validFrom);
		}
		if (input.validTo !== null && input.validTo >= date) {
			boundaries.add(addDays(input.validTo, 1));
		}
	}
	const starts = [...boundaries].sort();
	for (const [index, start] of starts.entries()) {
		const end = starts[index + 1];
		for (let offset = 0; offset < 7; offset++) {
			const candidate = addDays(start, offset);
			if (end && candidate >= end) {
				break;
			}
			if (selectPeriod(periods, candidate, sourceReleasedAt)?.input.status === "operating") {
				return candidate;
			}
		}
	}
	return null;
}

function addDays(date: string, amount: number): string {
	const parsed = new Date(`${date}T00:00:00Z`);
	parsed.setUTCDate(parsed.getUTCDate() + amount);
	return parsed.toISOString().slice(0, 10);
}

function toPublicDeparture(
	item: TransportScheduleItem,
	boardingPoint: string | null,
): TransportPublicDeparture {
	if (item.kind === "fixed") {
		return {
			boardingPoint,
			capacity: item.capacity,
			departureTime: item.departureTime,
			kind: item.kind,
			note: item.note,
			riderType: item.riderType,
		};
	}
	return {
		boardingPoint,
		capacity: item.capacity,
		firstDepartureTime: item.firstDepartureTime,
		intervalMinutes: item.intervalMinutes,
		kind: item.kind,
		lastDepartureTime: item.lastDepartureTime,
		note: item.note,
		riderType: item.riderType,
	};
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

function projectionError(message: string, details?: unknown): AppApiRouteError {
	return new AppApiRouteError({
		code: "transport_projection_invalid",
		details,
		message,
		retryable: false,
		status: 500,
	});
}
