import { DEFAULT_EXECUTION_CONTROL_TIMEOUT_MS, type Env, parsePositiveInteger } from "../../config";
import { AppApiRouteError } from "../../http";
import {
	createCloudflareAccessServiceTokenHeaders,
	ExecutionControlTransportError,
	parseExecutionControlErrorEnvelope,
	parseExecutionControlJsonResponse,
} from "../integration/execution-control-transport";
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

export type CampusServicesTransportScheduleFetch = (
	request: Request,
) => Promise<Response> | Response;

type ToolReadModelRecord = Record<string, unknown>;

interface CampusServicesTransportScheduleServiceDependencies {
	env: Pick<
		Env,
		| "EXECUTION_CONTROL_ACCESS_CLIENT_ID"
		| "EXECUTION_CONTROL_ACCESS_CLIENT_SECRET"
		| "EXECUTION_CONTROL_BASE_URL"
		| "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET"
		| "EXECUTION_CONTROL_TIMEOUT_MS"
	>;
	fetchImplementation?: CampusServicesTransportScheduleFetch;
}

const TRANSPORT_STATUS_PATH = "/internal/projections/campus-services/transport-schedule/status";
const LOCAL_WALL_TIME_FORMAT = /^\d{2}:\d{2}$/;

export function buildCampusServicesTransportScheduleService(
	dependencies: CampusServicesTransportScheduleServiceDependencies,
): CampusServicesTransportScheduleService {
	const fetchImplementation = dependencies.fetchImplementation ?? fetch;

	return {
		async getPublicStatus() {
			const result = await requestTransportStatus(dependencies.env, fetchImplementation);
			return result;
		},
	};
}

async function requestTransportStatus(
	env: CampusServicesTransportScheduleServiceDependencies["env"],
	fetchImplementation: CampusServicesTransportScheduleFetch,
): Promise<{ etag: string | null; projection: CampusServicesTransportStatusResponse }> {
	const response = await requestExecutionControlTransport(
		env,
		fetchImplementation,
		new Request(new URL(TRANSPORT_STATUS_PATH, requireTransportBaseUrl(env)), {
			headers: transportRequestHeaders(env, false),
			method: "GET",
		}),
		"Execution control transport status exceeded",
	);
	const parsed = await parseExecutionControlJsonResponse(response);
	if (response.status !== 200) {
		throw toRouteErrorFromEnvelope(parsed, response.status);
	}
	return {
		etag: response.headers.get("etag"),
		projection: parseTransportStatusProjection(parsed),
	};
}

function requireTransportBaseUrl(
	env: CampusServicesTransportScheduleServiceDependencies["env"],
): string {
	const baseUrl = env.EXECUTION_CONTROL_BASE_URL?.trim();
	const sharedSecret = env.EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET?.trim();
	if (!(baseUrl && sharedSecret)) {
		throw new AppApiRouteError({
			code: "dependency_not_ready",
			message: "Transport schedule runtime is not configured.",
			retryable: true,
			status: 503,
		});
	}
	return baseUrl;
}

function transportRequestHeaders(
	env: CampusServicesTransportScheduleServiceDependencies["env"],
	withBody: boolean,
): HeadersInit {
	const sharedSecret = env.EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET?.trim() ?? "";
	return {
		accept: "application/json",
		...(withBody ? { "content-type": "application/json" } : {}),
		"x-execution-query-auth": sharedSecret,
		...createCloudflareAccessServiceTokenHeaders(env),
	};
}

async function requestExecutionControlTransport(
	env: CampusServicesTransportScheduleServiceDependencies["env"],
	fetchImplementation: CampusServicesTransportScheduleFetch,
	request: Request,
	timeoutMessagePrefix: string,
): Promise<Response> {
	const timeoutMs = parsePositiveInteger(
		env.EXECUTION_CONTROL_TIMEOUT_MS,
		DEFAULT_EXECUTION_CONTROL_TIMEOUT_MS,
	);
	let response: Response;
	try {
		response = await new Promise<Response>((resolve, reject) => {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => {
				controller.abort();
				reject(
					new ExecutionControlTransportError({
						code: "execution_timeout",
						message: `${timeoutMessagePrefix} ${timeoutMs}ms timeout.`,
						retryable: true,
						status: 504,
					}),
				);
			}, timeoutMs);

			Promise.resolve(fetchImplementation(new Request(request, { signal: controller.signal })))
				.then(resolve)
				.catch((error: unknown) => {
					if (error instanceof Error && error.name === "AbortError") {
						reject(
							new ExecutionControlTransportError({
								code: "execution_timeout",
								message: `${timeoutMessagePrefix} ${timeoutMs}ms timeout.`,
								retryable: true,
								status: 504,
							}),
						);
						return;
					}
					reject(error);
				})
				.finally(() => clearTimeout(timeoutId));
		});
	} catch (error) {
		if (error instanceof ExecutionControlTransportError) {
			throw toRouteError(error);
		}
		throw new AppApiRouteError({
			code: "execution_control_unavailable",
			message: error instanceof Error ? error.message : "Transport schedule runtime failed.",
			retryable: true,
			status: 502,
		});
	}
	return response;
}

function parseTransportStatusProjection(
	payload: ToolReadModelRecord,
): CampusServicesTransportStatusResponse {
	const release = readRecord(payload.release);
	const releaseId = readString(release?.releaseId);
	const publishedAt = readString(release?.publishedAt);
	const releaseSourceRefs = readStringArray(release?.sourceRefs);
	if (!(releaseId && publishedAt && hasOnlyHttpUrls(releaseSourceRefs))) {
		throw invalidTransportStatusProjection("release");
	}
	const groups = readArray(payload.groups).map(parseTransportStatusGroup);
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
		routes: readArray(record.routes).map(parseTransportStatusRoute),
	};
}

function parseTransportStatusRoute(value: unknown): CampusServicesTransportStatusRoute {
	const record = requireRecord(value, "route");
	const routeId = readString(record.routeId);
	const displayName = readString(record.displayName);
	if (!(routeId && displayName)) {
		throw invalidTransportStatusProjection("route");
	}
	return {
		departures: readArray(record.departures).map(parseTransportStatusDeparture),
		displayName,
		routeId,
	};
}

function parseTransportStatusDeparture(value: unknown): CampusServicesTransportStatusDeparture {
	const record = requireRecord(value, "departure");
	const departureTime = readString(record.departureTime);
	const sourceRefs = readStringArray(record.sourceRefs);
	if (!(LOCAL_WALL_TIME_FORMAT.test(departureTime) && hasOnlyHttpUrls(sourceRefs))) {
		throw invalidTransportStatusProjection("departure");
	}
	const note = readString(record.note);
	return {
		departureTime,
		kind: parseTransportStatusDepartureKind(readString(record.kind)),
		...(note ? { note } : {}),
		sourceRefs,
		status: parseTransportStatusDepartureStatus(readString(record.status)),
	};
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

function readRecord(value: unknown): ToolReadModelRecord | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as ToolReadModelRecord)
		: null;
}

function requireRecord(value: unknown, field: string): ToolReadModelRecord {
	const record = readRecord(value);
	if (!record) {
		throw invalidTransportStatusProjection(field);
	}
	return record;
}

function readArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return [...new Set(value.map(readString).filter(Boolean))];
}

function hasOnlyHttpUrls(values: string[]): boolean {
	return values.length > 0 && values.every((value) => /^https?:\/\//i.test(value));
}

function toRouteError(error: ExecutionControlTransportError): AppApiRouteError {
	return new AppApiRouteError({
		code: error.code,
		message: error.message,
		retryable: error.retryable,
		status: error.status,
	});
}

function toRouteErrorFromEnvelope(parsed: ToolReadModelRecord, status: number): AppApiRouteError {
	const envelope = parseExecutionControlErrorEnvelope(parsed, status);
	return new AppApiRouteError({
		code: envelope.code,
		message: envelope.message,
		retryable: envelope.retryable,
		status,
	});
}
