import { DEFAULT_EXECUTION_CONTROL_TIMEOUT_MS, type Env, parsePositiveInteger } from "../../config";
import { AppApiRouteError } from "../../http";
import {
	createCloudflareAccessServiceTokenHeaders,
	ExecutionControlTransportError,
	parseExecutionControlErrorEnvelope,
	parseExecutionControlJsonResponse,
} from "../integration/execution-control-transport";
import type {
	CampusServicesTransportDeparture,
	CampusServicesTransportRoute,
	CampusServicesTransportScheduleResponse,
	CampusServicesTransportScheduleService,
	CampusServicesTransportSourceNotice,
	CampusTransportRouteStatus,
} from "./types";

export type CampusServicesTransportScheduleFetch = (
	request: Request,
) => Promise<Response> | Response;

type StructuredQueryRecord = Record<string, unknown>;

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
	now?: () => Date;
}

const TRANSPORT_SCHEDULE_PATH = "/internal/query/campus-services/transport-schedule";
const LOCAL_DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export function buildCampusServicesTransportScheduleService(
	dependencies: CampusServicesTransportScheduleServiceDependencies,
): CampusServicesTransportScheduleService {
	const fetchImplementation = dependencies.fetchImplementation ?? fetch;
	const now = dependencies.now ?? (() => new Date());

	async function queryTransportSchedule(
		body: StructuredQueryRecord,
	): Promise<StructuredQueryRecord> {
		return requestTransportSchedule(dependencies.env, body, fetchImplementation);
	}

	return {
		async getPublicSchedule(input) {
			const serviceDate = normalizeServiceDate(input.serviceDate, now);
			const seed = await queryTransportSchedule(buildTimetableQuery(serviceDate, null));
			if (readString(seed.outcome) === "temporarily_unverifiable") {
				return unavailableSchedule(serviceDate, seed);
			}

			const seedRoute = readRecord(seed.resolved_route);
			const candidates = seedRoute ? [seedRoute] : readRouteCandidates(seed);
			if (candidates.length === 0) {
				return unavailableSchedule(serviceDate, seed);
			}

			const routeResults = await Promise.all(
				candidates.map((route) =>
					queryTransportSchedule(buildTimetableQuery(serviceDate, readString(route.route_id))),
				),
			);
			if (
				routeResults.some((result) => readString(result.outcome) === "temporarily_unverifiable")
			) {
				return unavailableSchedule(serviceDate, routeResults[0] ?? seed);
			}

			const routes = routeResults.map((result) => publicRouteFromResult(result));
			const notices = sourceNoticesFromResults(routeResults);
			const snapshot = firstSnapshot(routeResults);
			return {
				adjustmentCount: countAdjustments(routes),
				calendarLabel: "以发布时刻表为准",
				generatedAt: new Date().toISOString(),
				hasAdjustments: countAdjustments(routes) > 0,
				notices,
				publishedAt: snapshot?.publishedAt ?? null,
				releaseId: snapshot?.snapshotId ?? null,
				routes,
				serviceDate,
				status: "available",
			};
		},
	};
}

function buildTimetableQuery(serviceDate: string, routeId: string | null): StructuredQueryRecord {
	return {
		query_text: "公开班车时刻表",
		intent: "timetable",
		route_selector: routeId ? { route_id: routeId } : null,
		snapshot_query: { mode: "current" },
		service_time_query: {
			date_mode: "date",
			service_date: serviceDate,
			daypart: "all_day",
		},
		result_limit: 200,
	};
}

async function requestTransportSchedule(
	env: CampusServicesTransportScheduleServiceDependencies["env"],
	body: StructuredQueryRecord,
	fetchImplementation: CampusServicesTransportScheduleFetch,
): Promise<StructuredQueryRecord> {
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
						message: `Execution control structured query exceeded ${timeoutMs}ms timeout.`,
						retryable: true,
						status: 504,
					}),
				);
			}, timeoutMs);

			Promise.resolve(
				fetchImplementation(
					new Request(new URL(TRANSPORT_SCHEDULE_PATH, baseUrl), {
						body: JSON.stringify(body),
						headers: {
							accept: "application/json",
							"content-type": "application/json",
							"x-execution-query-auth": sharedSecret,
							...createCloudflareAccessServiceTokenHeaders(env),
						},
						method: "POST",
						signal: controller.signal,
					}),
				),
			)
				.then(resolve)
				.catch((error: unknown) => {
					if (error instanceof Error && error.name === "AbortError") {
						reject(
							new ExecutionControlTransportError({
								code: "execution_timeout",
								message: `Execution control structured query exceeded ${timeoutMs}ms timeout.`,
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

	const parsed = await parseExecutionControlJsonResponse(response);
	if (response.status !== 200) {
		throw toRouteErrorFromEnvelope(parsed, response.status);
	}
	return parsed;
}

function normalizeServiceDate(value: string | null | undefined, now: () => Date): string {
	const candidate = value?.trim() || formatLocalDate(now());
	if (!LOCAL_DATE_FORMAT.test(candidate)) {
		throw validationError("serviceDate must be YYYY-MM-DD.");
	}
	const parsed = new Date(`${candidate}T00:00:00+08:00`);
	if (Number.isNaN(parsed.valueOf()) || formatLocalDate(parsed) !== candidate) {
		throw validationError("serviceDate must be a valid calendar date.");
	}
	return candidate;
}

function formatLocalDate(value: Date): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		day: "2-digit",
		month: "2-digit",
		timeZone: "Asia/Shanghai",
		year: "numeric",
	}).formatToParts(value);
	const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
	return `${part("year")}-${part("month")}-${part("day")}`;
}

function readRouteCandidates(result: StructuredQueryRecord): StructuredQueryRecord[] {
	const candidates = Array.isArray(result.candidate_routes) ? result.candidate_routes : [];
	return candidates
		.map((candidate) => readRecord(readRecord(candidate)?.route))
		.filter((route): route is StructuredQueryRecord =>
			Boolean(route && readString(route.route_id)),
		);
}

function publicRouteFromResult(result: StructuredQueryRecord): CampusServicesTransportRoute {
	const route = readRecord(result.resolved_route) ?? {};
	const entries = Array.isArray(result.timetable_entries) ? result.timetable_entries : [];
	const status = normalizeRouteStatus(readString(result.service_status));
	const relatedRefs = readStringArray(result.related_notice_refs);
	const departures = entries
		.map((entry, index) =>
			publicDepartureFromEntry(readRecord(entry) ?? {}, {
				index,
				relatedRefs,
				routeId: readString(route.route_id),
			}),
		)
		.filter((departure): departure is CampusServicesTransportDeparture => Boolean(departure));
	return {
		departures: status === "running" ? departures : [],
		destination: firstStopName(entries, "destination_stop_ref"),
		displayName: readString(route.display_name) || readString(route.route_id),
		note: operationalNote(result),
		origin: firstStopName(entries, "origin_stop_ref"),
		routeId: readString(route.route_id),
		status,
	};
}

function publicDepartureFromEntry(
	entry: StructuredQueryRecord,
	input: { index: number; relatedRefs: string[]; routeId: string },
): CampusServicesTransportDeparture | null {
	const departureAt = readString(entry.departure_at);
	if (!departureAt) {
		return null;
	}
	const departureDate = new Date(departureAt);
	if (Number.isNaN(departureDate.valueOf())) {
		return null;
	}
	return {
		departureTime: new Intl.DateTimeFormat("zh-CN", {
			hour: "2-digit",
			hour12: false,
			minute: "2-digit",
			timeZone: "Asia/Shanghai",
		}).format(departureDate),
		id: `${input.routeId}:${departureAt}`,
		note: null,
		sequence: input.index + 1,
		sourceNoticeRefs: input.relatedRefs,
		status: "normal",
		type: "其他",
	};
}

function firstStopName(entries: unknown[], field: string): string | null {
	for (const entry of entries) {
		const stop = readRecord(readRecord(entry)?.[field]);
		const displayName = readString(stop?.display_name);
		if (displayName) {
			return displayName;
		}
	}
	return null;
}

function operationalNote(result: StructuredQueryRecord): string | null {
	const notices = Array.isArray(result.operational_notices) ? result.operational_notices : [];
	const comments = notices
		.map((notice) => readString(readRecord(notice)?.operational_comment))
		.filter(Boolean);
	return comments.length > 0 ? [...new Set(comments)].join("；") : null;
}

function sourceNoticesFromResults(
	results: StructuredQueryRecord[],
): CampusServicesTransportSourceNotice[] {
	const seen = new Set<string>();
	const notices: CampusServicesTransportSourceNotice[] = [];
	for (const result of results) {
		const snapshot = readRecord(result.schedule_snapshot);
		const publishedAt = readString(snapshot?.published_at) || null;
		for (const url of [
			readString(snapshot?.source_ref),
			...readStringArray(result.related_notice_refs),
			...operationalNoticeSourceRefs(result),
		]) {
			if (!(url && /^https?:\/\//i.test(url) && !seen.has(url))) {
				continue;
			}
			seen.add(url);
			notices.push({
				publishedAt,
				title: "班车时刻表来源",
				url,
			});
		}
	}
	return notices;
}

function operationalNoticeSourceRefs(result: StructuredQueryRecord): string[] {
	const notices = Array.isArray(result.operational_notices) ? result.operational_notices : [];
	return notices.map((notice) => readString(readRecord(notice)?.source_ref)).filter(Boolean);
}

function firstSnapshot(
	results: StructuredQueryRecord[],
): { publishedAt: string; snapshotId: string } | null {
	for (const result of results) {
		const snapshot = readRecord(result.schedule_snapshot);
		const snapshotId = readString(snapshot?.snapshot_id);
		const publishedAt = readString(snapshot?.published_at);
		if (snapshotId || publishedAt) {
			return { publishedAt, snapshotId };
		}
	}
	return null;
}

function unavailableSchedule(
	serviceDate: string,
	result: StructuredQueryRecord,
): CampusServicesTransportScheduleResponse {
	return {
		adjustmentCount: 0,
		calendarLabel: "以发布时刻表为准",
		generatedAt: new Date().toISOString(),
		hasAdjustments: false,
		notices: sourceNoticesFromResults([result]),
		publishedAt: null,
		releaseId: null,
		routes: [],
		serviceDate,
		status: "unavailable",
	};
}

function countAdjustments(routes: CampusServicesTransportRoute[]): number {
	return routes.reduce(
		(total, route) =>
			total + route.departures.filter((departure) => departure.status !== "normal").length,
		0,
	);
}

function normalizeRouteStatus(value: string): CampusTransportRouteStatus {
	switch (value) {
		case "limited_service":
		case "not_running":
		case "running":
		case "temporarily_suspended":
			return value;
		default:
			return "unknown";
	}
}

function readRecord(value: unknown): StructuredQueryRecord | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as StructuredQueryRecord)
		: null;
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

function validationError(message: string): AppApiRouteError {
	return new AppApiRouteError({
		code: "validation_failed",
		message,
		retryable: false,
		status: 400,
	});
}

function toRouteError(error: ExecutionControlTransportError): AppApiRouteError {
	return new AppApiRouteError({
		code: error.code,
		message: error.message,
		retryable: error.retryable,
		status: error.status,
	});
}

function toRouteErrorFromEnvelope(parsed: StructuredQueryRecord, status: number): AppApiRouteError {
	const envelope = parseExecutionControlErrorEnvelope(parsed, status);
	return new AppApiRouteError({
		code: envelope.code,
		message: envelope.message,
		retryable: envelope.retryable,
		status,
	});
}
