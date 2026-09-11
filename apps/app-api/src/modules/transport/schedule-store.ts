import {
	selectTransportPeriod,
	type TransportPublicDeparture,
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
import { asc } from "drizzle-orm";
import type { Env } from "../../config";
import {
	createRuntimeDbGetter,
	type RuntimeDatabase,
	type RuntimeDbGetter,
} from "../../db/runtime";
import { AppApiRouteError } from "../../http";

export type { TransportPublicScheduleResponse as TransportScheduleResponse } from "@campus-agent/transport/domain";

export interface TransportScheduleService {
	getSchedule(date: string): Promise<TransportPublicScheduleResponse>;
	getRange(from: string, to: string): Promise<TransportPublicScheduleRange>;
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

export function createPgTransportScheduleService(
	env: Env,
	options: { getDb?: RuntimeDbGetter } = {},
): TransportScheduleService {
	const getDb = options.getDb ?? createRuntimeDbGetter(env);
	return {
		async getSchedule(date) {
			return projectSchedule(await loadSchedules(await getDb()), date);
		},
		async getRange(from, to) {
			const dates = transportDateRange(from, to);
			const schedules = await loadSchedules(await getDb());
			const days = dates.map((date) => projectSchedule(schedules, date));
			return TransportPublicScheduleRangeSchema.parse({ from, to, days });
		},
	};
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
): TransportPublicScheduleResponse {
	const response: TransportPublicScheduleResponse = {
		date,
		routeCatalog: routes.map(({ input: { displayOrder: _order, ...route } }) => ({
			...route,
			nextServiceDate: nextServiceDate(periodsByRoute.get(route.routeId) ?? [], date),
		})),
		routes: [],
	};
	for (const route of routes) {
		const period = selectPeriod(periodsByRoute.get(route.input.routeId) ?? [], date);
		if (!period) {
			continue;
		}
		response.routes.push({
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

function selectPeriod(periods: readonly ParsedPeriod[], date: string): ParsedPeriod | null {
	return selectTransportPeriod(
		periods.map((period) => ({ ...period, ...period.input })),
		date,
	);
}

function nextServiceDate(periods: readonly ParsedPeriod[], date: string): string | null {
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
			if (selectPeriod(periods, candidate)?.input.status === "operating") {
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
