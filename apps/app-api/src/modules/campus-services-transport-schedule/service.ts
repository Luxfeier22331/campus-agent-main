import { AppApiRouteError } from "../../http";
import type {
	CampusServicesTransportScheduleService,
	CampusServicesTransportStatusDeparture,
	CampusServicesTransportStatusGroup,
	CampusServicesTransportStatusResponse,
	CampusServicesTransportStatusRoute,
	CampusTransportDepartureStatus,
	TransportStatusDepartureKind,
	TransportStatusGroupKind,
} from "./types";

type TransportStatusRecord = Record<string, unknown>;

export interface CampusServicesTransportScheduleStore {
	getCurrentStatus(): Promise<{
		contentSha256: string;
		status: unknown;
	} | null>;
}

interface CampusServicesTransportScheduleServiceDependencies {
	store: CampusServicesTransportScheduleStore;
}

const LOCAL_WALL_TIME_FORMAT = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const RFC3339_FORMAT =
	/^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export function buildCampusServicesTransportScheduleService(
	dependencies: CampusServicesTransportScheduleServiceDependencies,
): CampusServicesTransportScheduleService {
	return {
		async getPublicStatus() {
			const current = await dependencies.store.getCurrentStatus();
			if (!current) {
				throw new AppApiRouteError({
					code: "transport_status_unavailable",
					message: "Transport status is unavailable.",
					retryable: true,
					status: 503,
				});
			}
			return {
				etag: `"${current.contentSha256}"`,
				projection: parseTransportStatusProjection(current.status),
			};
		},
	};
}

export function parseTransportStatusProjection(
	payload: unknown,
): CampusServicesTransportStatusResponse {
	const root = requireRecord(payload, "status");
	const release = readRecord(root.release);
	const releaseId = readString(release?.releaseId);
	const publishedAt = readString(release?.publishedAt);
	const releaseSourceRefs = requireHttpUrlArray(release?.sourceRefs, "release.sourceRefs");
	if (!(releaseId && isRfc3339(publishedAt))) {
		throw invalidTransportStatusProjection("release");
	}
	const groups = requireArray(root.groups, "groups").map(parseTransportStatusGroup);
	if (!groups.some((group) => group.routes.some((route) => route.departures.length > 0))) {
		throw invalidTransportStatusProjection("groups");
	}
	return {
		groups,
		release: {
			publishedAt,
			releaseId,
			sourceRefs: releaseSourceRefs,
		},
	};
}

function invalidTransportStatusProjection(field: string): AppApiRouteError {
	return new AppApiRouteError({
		code: "invalid_transport_status_projection",
		details: { field },
		message: "Transport status projection is invalid.",
		retryable: true,
		status: 502,
	});
}

function parseTransportStatusGroup(value: unknown): CampusServicesTransportStatusGroup {
	const record = requireRecord(value, "group");
	const kind = parseTransportStatusGroupKind(readString(record.kind));
	return {
		kind,
		routes: requireArray(record.routes, "group.routes").map((route) =>
			parseTransportStatusRoute(route, kind),
		),
	};
}

function parseTransportStatusRoute(
	value: unknown,
	groupKind: TransportStatusGroupKind,
): CampusServicesTransportStatusRoute {
	const record = requireRecord(value, "route");
	const routeId = readString(record.routeId);
	const displayName = readString(record.displayName);
	if (!(routeId && displayName)) {
		throw invalidTransportStatusProjection("route");
	}
	return {
		departures: requireArray(record.departures, "route.departures").map((departure) =>
			parseTransportStatusDeparture(departure, groupKind),
		),
		displayName,
		routeId,
	};
}

function parseTransportStatusDeparture(
	value: unknown,
	groupKind: TransportStatusGroupKind,
): CampusServicesTransportStatusDeparture {
	const record = requireRecord(value, "departure");
	const departureTime = readString(record.departureTime);
	const sourceRefs = requireHttpUrlArray(record.sourceRefs, "departure.sourceRefs");
	if (!LOCAL_WALL_TIME_FORMAT.test(departureTime)) {
		throw invalidTransportStatusProjection("departure");
	}
	const note = readOptionalString(record.note, "departure.note");
	const serviceDate = readOptionalString(record.serviceDate, "departure.serviceDate");
	if ((serviceDate && !isIsoDate(serviceDate)) || (groupKind === "temporary" && !serviceDate)) {
		throw invalidTransportStatusProjection("departure.serviceDate");
	}
	return {
		departureTime,
		kind: parseTransportStatusDepartureKind(readString(record.kind)),
		...(note ? { note } : {}),
		...(serviceDate ? { serviceDate } : {}),
		sourceRefs,
		status: parseTransportStatusDepartureStatus(readString(record.status)),
	};
}

function isIsoDate(value: string): boolean {
	if (!ISO_DATE_FORMAT.test(value)) {
		return false;
	}
	const [year, month, day] = value.split("-").map(Number);
	if (year === undefined || month === undefined || day === undefined) {
		return false;
	}
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
}

function isRfc3339(value: string): boolean {
	const match = value.match(RFC3339_FORMAT);
	return Boolean(match?.[1] && isIsoDate(match[1]) && !Number.isNaN(Date.parse(value)));
}

function parseTransportStatusGroupKind(value: string): TransportStatusGroupKind {
	switch (value) {
		case "daily":
		case "temporary":
		case "weekday":
		case "weekend_holiday":
			return value;
		default:
			throw invalidTransportStatusProjection("group.kind");
	}
}

function parseTransportStatusDepartureKind(value: string): TransportStatusDepartureKind {
	switch (value) {
		case "other":
		case "student":
		case "teacher":
			return value;
		default:
			throw invalidTransportStatusProjection("departure.kind");
	}
}

function parseTransportStatusDepartureStatus(value: string): CampusTransportDepartureStatus {
	switch (value) {
		case "added":
		case "cancelled":
		case "changed":
		case "delayed":
		case "normal":
			return value;
		default:
			throw invalidTransportStatusProjection("departure.status");
	}
}

function readRecord(value: unknown): TransportStatusRecord | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as TransportStatusRecord)
		: null;
}

function requireRecord(value: unknown, field: string): TransportStatusRecord {
	const record = readRecord(value);
	if (!record) {
		throw invalidTransportStatusProjection(field);
	}
	return record;
}

function requireArray(value: unknown, field: string): unknown[] {
	if (!Array.isArray(value)) {
		throw invalidTransportStatusProjection(field);
	}
	return value;
}

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(value: unknown, field: string): string | undefined {
	if (value === undefined) {
		return;
	}
	const parsed = readString(value);
	if (!parsed) {
		throw invalidTransportStatusProjection(field);
	}
	return parsed;
}

function requireHttpUrlArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw invalidTransportStatusProjection(field);
	}
	const urls: string[] = [];
	for (const item of value) {
		const url = readString(item);
		if (!isHttpUrl(url)) {
			throw invalidTransportStatusProjection(field);
		}
		if (!urls.includes(url)) {
			urls.push(url);
		}
	}
	return urls;
}

function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}
