import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

export type ServiceMode = "daily" | "temporary" | "weekday" | "weekend_holiday";

export interface TransportStatusDeparture {
	departureTime: string;
	kind: "other" | "student" | "teacher";
	note?: string;
	serviceDate?: string;
	sourceRefs: string[];
	status: "added" | "cancelled" | "changed" | "delayed" | "normal";
}

export interface TransportStatusRoute {
	departures: TransportStatusDeparture[];
	displayName: string;
	routeId: string;
}

export interface TransportStatusProjection {
	groups: Array<{ kind: ServiceMode; routes: TransportStatusRoute[] }>;
	release: { publishedAt: string; releaseId: string; sourceRefs: string[] };
}

export interface TransportRouteMetadata {
	aliases: string[];
	destinationCampus: string;
	destinationStopId: string;
	destinationStopName: string;
	originCampus: string;
	originStopId: string;
	originStopName: string;
	routeId: string;
}

export interface TransportPublication {
	effectiveFrom: string;
	effectiveUntil: string | null;
	routes: TransportRouteMetadata[];
	status: TransportStatusProjection;
}

export interface TransportRouteRow extends TransportRouteMetadata {
	displayName: string;
	sortOrder: number;
}

export interface TransportDepartureRow extends TransportStatusDeparture {
	departureId: string;
	effectiveFrom: string;
	effectiveUntil: string | null;
	routeId: string;
	serviceMode: ServiceMode;
	sortOrder: number;
}

export interface PreparedTransportPublication {
	contentSha256: string;
	departureRows: TransportDepartureRow[];
	publication: TransportPublication;
	routeRows: TransportRouteRow[];
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const RFC3339_PATTERN = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;
const ROOT_KEYS = new Set(["effectiveFrom", "effectiveUntil", "routes", "status"]);
const ROUTE_KEYS = new Set([
	"aliases",
	"destinationCampus",
	"destinationStopId",
	"destinationStopName",
	"originCampus",
	"originStopId",
	"originStopName",
	"routeId",
]);

export function defaultTransportStatusSchemaPath(): string {
	return fileURLToPath(
		new URL(
			"../../../packages/contracts/schemas/transport-schedule-status.v1.schema.json",
			import.meta.url,
		),
	);
}

export function prepareTransportPublication(
	payload: unknown,
	options: { schema?: unknown; schemaPath?: string } = {},
): PreparedTransportPublication {
	const root = requireRecord(payload, "publication");
	requireOnlyKeys(root, ROOT_KEYS, "publication");
	const validateStatus = compileStatusSchema(
		options.schema ?? readJson(options.schemaPath ?? defaultTransportStatusSchemaPath()),
	);
	if (!validateStatus(root.status)) {
		throw new Error(`invalid transport status: ${formatValidationError(validateStatus.errors)}`);
	}

	const status = normalizeStatus(root.status as TransportStatusProjection);
	const effectiveFrom = requireDate(root.effectiveFrom, "effectiveFrom");
	const effectiveUntil = optionalDate(root.effectiveUntil, "effectiveUntil");
	if (effectiveUntil && effectiveUntil < effectiveFrom) {
		throw new Error("effectiveUntil must be on or after effectiveFrom");
	}
	if (!isRfc3339(status.release.publishedAt)) {
		throw new Error("status.release.publishedAt must be an RFC 3339 timestamp");
	}
	const routes = requireArray(root.routes, "routes").map(parseRouteMetadata);
	const routeRows = buildRouteRows(status, routes);
	const departureRows = buildDepartureRows(status, effectiveFrom, effectiveUntil);
	if (departureRows.length === 0) {
		throw new Error("transport publication must contain at least one departure");
	}
	const publication = { effectiveFrom, effectiveUntil, routes, status };
	return {
		contentSha256: createHash("sha256").update(JSON.stringify(publication)).digest("hex"),
		departureRows,
		publication,
		routeRows,
	};
}

function compileStatusSchema(schema: unknown): ValidateFunction {
	const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
	ajv.addFormat("uri", {
		type: "string",
		validate(value: string) {
			try {
				const url = new URL(value);
				return url.protocol === "http:" || url.protocol === "https:";
			} catch {
				return false;
			}
		},
	});
	ajv.addFormat("date", {
		type: "string",
		validate(value: string) {
			return isIsoDate(value);
		},
	});
	ajv.addFormat("date-time", {
		type: "string",
		validate(value: string) {
			return isRfc3339(value);
		},
	});
	return ajv.compile(schema as object);
}

function normalizeStatus(status: TransportStatusProjection): TransportStatusProjection {
	return {
		groups: status.groups.map((group) => ({
			kind: group.kind,
			routes: group.routes.map((route) => ({
				departures: route.departures.map((departure) => ({
					departureTime: departure.departureTime,
					kind: departure.kind,
					...(departure.note ? { note: departure.note.trim() } : {}),
					...(departure.serviceDate ? { serviceDate: departure.serviceDate } : {}),
					sourceRefs: uniqueStrings(departure.sourceRefs),
					status: departure.status,
				})),
				displayName: route.displayName.trim(),
				routeId: route.routeId.trim(),
			})),
		})),
		release: {
			publishedAt: status.release.publishedAt.trim(),
			releaseId: status.release.releaseId.trim(),
			sourceRefs: uniqueStrings(status.release.sourceRefs),
		},
	};
}

function parseRouteMetadata(value: unknown, index: number): TransportRouteMetadata {
	const route = requireRecord(value, `routes[${index}]`);
	requireOnlyKeys(route, ROUTE_KEYS, `routes[${index}]`);
	return {
		aliases: uniqueStrings(requireArray(route.aliases, `routes[${index}].aliases`).map(String)),
		destinationCampus: requireString(route.destinationCampus, `routes[${index}].destinationCampus`),
		destinationStopId: requireString(route.destinationStopId, `routes[${index}].destinationStopId`),
		destinationStopName: requireString(
			route.destinationStopName,
			`routes[${index}].destinationStopName`,
		),
		originCampus: requireString(route.originCampus, `routes[${index}].originCampus`),
		originStopId: requireString(route.originStopId, `routes[${index}].originStopId`),
		originStopName: requireString(route.originStopName, `routes[${index}].originStopName`),
		routeId: requireString(route.routeId, `routes[${index}].routeId`),
	};
}

function buildRouteRows(
	status: TransportStatusProjection,
	metadata: TransportRouteMetadata[],
): TransportRouteRow[] {
	const metadataById = new Map<string, TransportRouteMetadata>();
	for (const route of metadata) {
		if (metadataById.has(route.routeId)) {
			throw new Error(`duplicate route metadata: ${route.routeId}`);
		}
		metadataById.set(route.routeId, route);
	}
	const displayNameById = new Map<string, string>();
	for (const group of status.groups) {
		for (const route of group.routes) {
			const existing = displayNameById.get(route.routeId);
			if (existing && existing !== route.displayName) {
				throw new Error(`route display name drift: ${route.routeId}`);
			}
			displayNameById.set(route.routeId, route.displayName);
		}
	}
	if (displayNameById.size === 0) {
		throw new Error("transport publication must contain at least one route");
	}
	for (const routeId of displayNameById.keys()) {
		if (!metadataById.has(routeId)) {
			throw new Error(`route metadata missing: ${routeId}`);
		}
	}
	for (const routeId of metadataById.keys()) {
		if (!displayNameById.has(routeId)) {
			throw new Error(`unused route metadata: ${routeId}`);
		}
	}
	return [...displayNameById].map(([routeId, displayName], sortOrder) => ({
		...metadataById.get(routeId)!,
		displayName,
		sortOrder,
	}));
}

function buildDepartureRows(
	status: TransportStatusProjection,
	effectiveFrom: string,
	effectiveUntil: string | null,
): TransportDepartureRow[] {
	const rows: TransportDepartureRow[] = [];
	for (const group of status.groups) {
		for (const route of group.routes) {
			for (const departure of route.departures) {
				if (departure.serviceDate) {
					requireDate(departure.serviceDate, "departure.serviceDate");
				}
				if (group.kind === "temporary" && !departure.serviceDate) {
					throw new Error("temporary departures require serviceDate");
				}
				const sortOrder = rows.length;
				rows.push({
					...departure,
					departureId: `departure:${String(sortOrder + 1).padStart(4, "0")}`,
					effectiveFrom: departure.serviceDate ?? effectiveFrom,
					effectiveUntil: departure.serviceDate ?? effectiveUntil,
					routeId: route.routeId,
					serviceMode: group.kind,
					sortOrder,
				});
			}
		}
	}
	return rows;
}

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${field} must be an object`);
	}
	return value as Record<string, unknown>;
}

function requireArray(value: unknown, field: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new Error(`${field} must be an array`);
	}
	return value;
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${field} must be a non-empty string`);
	}
	return value.trim();
}

function requireDate(value: unknown, field: string): string {
	const date = requireString(value, field);
	if (!isIsoDate(date)) {
		throw new Error(`${field} must be an ISO date`);
	}
	return date;
}

function isIsoDate(value: string): boolean {
	if (!DATE_PATTERN.test(value)) {
		return false;
	}
	const [year, month, day] = value.split("-").map(Number);
	if (year === undefined || month === undefined || day === undefined) {
		return false;
	}
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}

function isRfc3339(value: string): boolean {
	const match = value.match(RFC3339_PATTERN);
	return Boolean(match?.[1] && isIsoDate(match[1]) && !Number.isNaN(Date.parse(value)));
}

function optionalDate(value: unknown, field: string): string | null {
	return value === undefined || value === null ? null : requireDate(value, field);
}

function requireOnlyKeys(
	record: Record<string, unknown>,
	allowed: ReadonlySet<string>,
	field: string,
): void {
	const unknown = Object.keys(record).find((key) => !allowed.has(key));
	if (unknown) {
		throw new Error(`${field} contains unsupported field: ${unknown}`);
	}
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function formatValidationError(errors: ErrorObject[] | null | undefined): string {
	const first = errors?.[0];
	return `${first?.instancePath || "/"} ${first?.message ?? "failed validation"}`;
}
