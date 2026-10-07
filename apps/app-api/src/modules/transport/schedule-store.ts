import {
	createTransportPeriodSelector,
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
	type TransportSchedulePeriodInput,
	TransportSchedulePeriodInputSchema,
	transportDateRange,
} from "@campus-agent/transport/domain";
import {
	transportRoutes,
	transportScheduleItems,
	transportSchedulePeriods,
} from "@campus-agent/transport/schema";
import { and, asc, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
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

type RouteRow = Omit<typeof transportRoutes.$inferSelect, "createdAt" | "updatedAt" | "updatedBy">;
type PeriodRow = Omit<typeof transportSchedulePeriods.$inferSelect, "createdAt" | "updatedBy">;
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
			const schedules = await loadSchedules(db, date);
			const response = projectSchedule(schedules, date, options?.includeNotices ?? false);
			await attachNotices(db, schedules, [response], options?.includeNotices ?? false);
			const parsed = TransportPublicScheduleResponseSchema.safeParse(response);
			if (!parsed.success) {
				throw projectionError("班车公开投影无效。", parsed.error.flatten());
			}
			return parsed.data;
		},
		async getRange(from, to, options) {
			const dates = transportDateRange(from, to);
			const db = await getDb();
			const schedules = await loadSchedules(db, from);
			const days = dates.map((date) =>
				projectSchedule(schedules, date, options?.includeNotices ?? false),
			);
			await attachNotices(db, schedules, days, options?.includeNotices ?? false);
			const parsed = TransportPublicScheduleRangeSchema.safeParse({ from, to, days });
			if (!parsed.success) {
				throw projectionError("班车公开投影无效。", parsed.error.flatten());
			}
			return parsed.data;
		},
	};
}

async function attachNotices(
	db: RuntimeDatabase,
	{ selectors }: Awaited<ReturnType<typeof loadSchedules>>,
	days: TransportPublicScheduleResponse[],
	includeNotices: boolean,
) {
	if (!includeNotices) {
		return;
	}
	const ids = new Set<string>();
	for (const day of days) {
		for (const route of day.routes) {
			const period = selectors.get(route.routeId)?.(day.date);
			if (period) {
				ids.add(period.scheduleId);
			}
		}
	}
	const grouped = new Map<string, TransportPublicNotice[]>();
	if (ids.size === 0) {
		return;
	}
	const result = await db.execute<{
		schedule_id: string;
		notice_id: string;
		title: string;
		released_at: Date | string;
		is_external: boolean;
		external_url: string | null;
	}>(sql`
			SELECT l.schedule_id, n.released_at, n.notice_id::text, n.title, n.is_external, n.external_url
		FROM transport.schedule_period_notices l
		JOIN notices.notices n ON n.notice_id = l.notice_id
		WHERE l.schedule_id IN (${sql.join(
			[...ids].map((id) => sql`${id}`),
			sql`, `,
		)})
		AND n.is_published
		AND n.unavailable_at IS NULL
		ORDER BY n.released_at DESC, n.notice_id DESC
	`);
	for (const row of result.rows) {
		const releasedAt = new Date(row.released_at).toISOString();
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
	for (const day of days) {
		for (const route of day.routes) {
			const period = selectors.get(route.routeId)?.(day.date);
			if (route.noticeContext && period) {
				route.noticeContext.notices = grouped.get(period.scheduleId) ?? [];
			}
		}
	}
}

async function loadSchedules(db: RuntimeDatabase, from: string) {
	const r = transportRoutes;
	const p = transportSchedulePeriods;
	const i = transportScheduleItems;
	const rows = await db
		.select({
			route: {
				routeId: r.routeId,
				boardingGuide: r.boardingGuide,
				defaultBoardingPoint: r.defaultBoardingPoint,
				dropOffPoint: r.dropOffPoint,
				destination: r.destination,
				displayOrder: r.displayOrder,
				origin: r.origin,
				serviceKind: r.serviceKind,
			},
			period: {
				scheduleId: p.scheduleId,
				routeId: p.routeId,
				boardingPointOverride: p.boardingPointOverride,
				dropOffPointOverride: p.dropOffPointOverride,
				note: p.note,
				status: p.status,
				updatedAt: p.updatedAt,
				validFrom: p.validFrom,
				validTo: p.validTo,
				weekdays: p.weekdays,
			},
			item: {
				itemId: i.itemId,
				scheduleId: i.scheduleId,
				boardingPoint: i.boardingPoint,
				capacity: i.capacity,
				departureTime: i.departureTime,
				firstDepartureTime: i.firstDepartureTime,
				intervalMinutes: i.intervalMinutes,
				kind: i.kind,
				lastDepartureTime: i.lastDepartureTime,
				note: i.note,
				riderType: i.riderType,
				sortOrder: i.sortOrder,
			},
		})
		.from(r)
		.leftJoin(p, and(eq(p.routeId, r.routeId), or(isNull(p.validTo), gte(p.validTo, from))))
		.leftJoin(i, eq(i.scheduleId, p.scheduleId))
		.orderBy(
			asc(r.displayOrder),
			asc(r.routeId),
			desc(p.validFrom),
			asc(p.validTo),
			desc(p.updatedAt),
			asc(p.scheduleId),
			asc(i.sortOrder),
			asc(i.itemId),
		);
	const routeRows = new Map<string, RouteRow>();
	const periodRows = new Map<string, PeriodRow>();
	const itemsBySchedule = new Map<string, ItemRow[]>();
	for (const row of rows) {
		routeRows.set(row.route.routeId, row.route);
		if (row.period) {
			periodRows.set(row.period.scheduleId, row.period);
		}
		if (row.item) {
			const items = itemsBySchedule.get(row.item.scheduleId) ?? [];
			items.push(row.item);
			itemsBySchedule.set(row.item.scheduleId, items);
		}
	}
	const routes = [...routeRows.values()].map(parseRoute);
	const periodsByRoute = new Map<string, ParsedPeriod[]>();
	for (const row of periodRows.values()) {
		const period = parsePeriod(row, itemsBySchedule.get(String(row.scheduleId)) ?? []);
		const periods = periodsByRoute.get(period.input.routeId) ?? [];
		periods.push(period);
		periodsByRoute.set(period.input.routeId, periods);
	}

	const selectors = new Map(
		[...periodsByRoute].map(([routeId, periods]) => [
			routeId,
			createTransportPeriodSelector(periods.map((period) => ({ ...period, ...period.input }))),
		]),
	);
	const nextServiceDates = new Map(
		[...periodsByRoute].map(([routeId, periods]) => [
			routeId,
			createNextServiceDate(periods, selectors.get(routeId) ?? (() => null)),
		]),
	);
	return { routes, selectors, nextServiceDates };
}

function projectSchedule(
	{ routes, selectors, nextServiceDates }: Awaited<ReturnType<typeof loadSchedules>>,
	date: string,
	includeNotices = false,
): TransportPublicScheduleResponse {
	const response: TransportPublicScheduleResponse = {
		date,
		routeCatalog: routes.map(({ input: { displayOrder: _order, ...route } }) => ({
			...route,
			dropOffPoint:
				selectors.get(route.routeId)?.(date)?.input.dropOffPointOverride ?? route.dropOffPoint,
			nextServiceDate: nextServiceDates.get(route.routeId)?.(date) ?? null,
		})),
		routes: [],
	};
	for (const route of routes) {
		const period = selectors.get(route.input.routeId)?.(date);
		if (!period) {
			continue;
		}
		response.routes.push({
			...(includeNotices
				? {
						noticeContext: {
							validFrom: period.input.validFrom,
							validTo: period.input.validTo,
							weekdays: period.input.weekdays,
							notices: [],
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

	return response;
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

function parseItem(row: ItemRow) {
	try {
		const kind = String(row.kind);
		if (kind === "fixed") {
			return {
				boardingPoint: nullableText(row.boardingPoint),
				capacity: row.capacity ?? null,
				departureTime: requiredText(row.departureTime, "固定班次时间"),
				kind,
				note: nullableText(row.note),
				riderType: row.riderType,
				sortOrder: row.sortOrder,
			};
		}
		if (kind === "interval") {
			return {
				boardingPoint: nullableText(row.boardingPoint),
				capacity: row.capacity ?? null,
				firstDepartureTime: requiredText(row.firstDepartureTime, "首班时间"),
				intervalMinutes: row.intervalMinutes,
				kind,
				lastDepartureTime: requiredText(row.lastDepartureTime, "末班时间"),
				note: nullableText(row.note),
				riderType: row.riderType,
				sortOrder: row.sortOrder,
			};
		}
		throw new Error(`未知班次类型: ${kind}`);
	} catch (error) {
		throw projectionError("班次明细事实无效。", { cause: error, itemId: String(row.itemId) });
	}
}

function createNextServiceDate(
	periods: readonly ParsedPeriod[],
	select: (date: string) => ParsedPeriod | null,
) {
	// Between period boundaries the winning schedule repeats weekly. Check one week
	// per segment, including the final unbounded segment, rather than scanning days indefinitely.
	const boundaries = new Set<string>();
	for (const { input } of periods) {
		boundaries.add(input.validFrom);
		if (input.validTo !== null) {
			boundaries.add(addDays(input.validTo, 1));
		}
	}
	const sorted = [...boundaries].sort();
	return (date: string): string | null => {
		if (select(date)?.input.status === "operating") {
			return date;
		}
		const starts = [date, ...sorted.filter((boundary) => boundary > date)];
		for (const [index, start] of starts.entries()) {
			const end = starts[index + 1];
			for (let offset = 0; offset < 7; offset++) {
				const candidate = addDays(start, offset);
				if (end && candidate >= end) {
					break;
				}
				if (select(candidate)?.input.status === "operating") {
					return candidate;
				}
			}
		}
		return null;
	};
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
