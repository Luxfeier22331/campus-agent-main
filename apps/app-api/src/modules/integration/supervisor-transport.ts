import { DEFAULT_SUPERVISOR_API_TIMEOUT_MS, type Env, parsePositiveInteger } from "../../config";
import { applyTracePropagationHeaders, resolveTracePropagationHeaders } from "../telemetry/trace";

import type { SupervisorExecutionInput } from "./supervisor-types";

type SupervisorReadyzRecord = Record<string, unknown>;
type SupervisorReadinessCheckStatus = "ready" | "not_ready" | "not_reported";

export interface SupervisorCampusServicesProductPathPreflight {
	status: "ready" | "blocked" | "not_reported";
	capabilityGate: "open" | "closed" | "not_reported";
	projectionSource: string;
	checks: {
		contactDirectoryProjection: SupervisorReadinessCheckStatus;
		contactDirectoryReadModel: SupervisorReadinessCheckStatus;
		serviceGuideProjection: SupervisorReadinessCheckStatus;
		serviceGuideReadModel: SupervisorReadinessCheckStatus;
		serviceStatusProjection: SupervisorReadinessCheckStatus;
		serviceStatusReadModel: SupervisorReadinessCheckStatus;
		structuredQueryRuntime: SupervisorReadinessCheckStatus;
		transportSchedule: SupervisorReadinessCheckStatus;
		transportScheduleReadModel: SupervisorReadinessCheckStatus;
	};
	blockers: Record<string, string>;
}

export interface SupervisorReadinessProbeResult {
	campusServicesProductPath: SupervisorCampusServicesProductPathPreflight;
}

export async function probeSupervisorApiReady(
	env: Pick<
		Env,
		| "SUPERVISOR_API_ACCESS_CLIENT_ID"
		| "SUPERVISOR_API_ACCESS_CLIENT_SECRET"
		| "SUPERVISOR_API_BASE_URL"
		| "SUPERVISOR_API_TIMEOUT_MS"
	>,
	input: {
		fetchImplementation?: typeof fetch;
	} = {},
): Promise<SupervisorReadinessProbeResult> {
	const baseUrl = env.SUPERVISOR_API_BASE_URL?.trim();
	if (!baseUrl) {
		throw new SupervisorTransportError({
			code: "dependency_not_ready",
			message: "Supervisor runtime is not configured.",
			retryable: true,
			status: 503,
		});
	}

	const timeoutMs = parsePositiveInteger(
		env.SUPERVISOR_API_TIMEOUT_MS,
		DEFAULT_SUPERVISOR_API_TIMEOUT_MS,
	);
	const fetchImplementation = input.fetchImplementation ?? fetch;

	let response: Response;
	try {
		response = await new Promise<Response>((resolve, reject) => {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => {
				controller.abort();
				reject(
					new SupervisorTransportError({
						code: "execution_timeout",
						message: `Supervisor readiness probe exceeded ${timeoutMs}ms timeout.`,
						retryable: true,
						status: 504,
					}),
				);
			}, timeoutMs);

			fetchImplementation(`${baseUrl}/readyz`, {
				headers: createCloudflareAccessServiceTokenHeaders(env),
				method: "GET",
				signal: controller.signal,
			})
				.then(resolve)
				.catch((error) => {
					if (error instanceof Error && error.name === "AbortError") {
						reject(
							new SupervisorTransportError({
								code: "execution_timeout",
								message: `Supervisor readiness probe exceeded ${timeoutMs}ms timeout.`,
								retryable: true,
								status: 504,
							}),
						);
						return;
					}

					reject(error);
				})
				.finally(() => {
					clearTimeout(timeoutId);
				});
		});
	} catch (error) {
		if (error instanceof SupervisorTransportError) {
			throw error;
		}

		throw new SupervisorTransportError({
			code: "supervisor_unavailable",
			message: error instanceof Error ? error.message : "Supervisor readiness probe failed.",
			retryable: true,
			status: 502,
		});
	}

	if (response.status !== 200) {
		throw new SupervisorTransportError({
			code: mapStatusCodeToErrorCode(response.status),
			message: `Supervisor readiness probe returned ${response.status}.`,
			retryable: response.status >= 500,
			status: response.status,
		});
	}

	const payload = (await response.json().catch(() => null)) as SupervisorReadyzRecord | null;
	return {
		campusServicesProductPath: buildCampusServicesProductPathPreflight(payload),
	};
}

function buildCampusServicesProductPathPreflight(
	payload: SupervisorReadyzRecord | null,
): SupervisorCampusServicesProductPathPreflight {
	const capabilityGate = resolveCampusServicesCapabilityGate(payload);
	const structuredRuntime = readRecord(payload?.structured_query_runtime);
	const projectionSource = readString(structuredRuntime?.projection_source);
	const checks: SupervisorCampusServicesProductPathPreflight["checks"] = {
		contactDirectoryProjection: readinessFromBoolean(
			structuredRuntime?.contact_directory_projection_ready,
		),
		contactDirectoryReadModel: readinessFromConfiguredAndHealthy(
			structuredRuntime?.contact_directory_read_model_configured,
			structuredRuntime?.contact_directory_read_model_healthy,
		),
		serviceGuideProjection: readinessFromBoolean(structuredRuntime?.service_guide_projection_ready),
		serviceGuideReadModel: readinessFromConfiguredAndHealthy(
			structuredRuntime?.service_guide_read_model_configured,
			structuredRuntime?.service_guide_read_model_healthy,
		),
		serviceStatusProjection: readinessFromBoolean(
			structuredRuntime?.service_status_projection_ready,
		),
		serviceStatusReadModel: readinessFromConfiguredAndHealthy(
			structuredRuntime?.service_status_read_model_configured,
			structuredRuntime?.service_status_read_model_healthy,
		),
		structuredQueryRuntime: readinessFromBoolean(structuredRuntime?.configured),
		transportSchedule: readinessFromBoolean(structuredRuntime?.transport_schedule_implemented),
		transportScheduleReadModel: readinessFromConfiguredAndHealthy(
			structuredRuntime?.transport_schedule_read_model_configured,
			structuredRuntime?.transport_schedule_read_model_healthy,
		),
	};
	const blockers = collectCampusServicesProductPathBlockers(capabilityGate, checks);
	const hasReportedCheck = Object.values(checks).some((status) => status !== "not_reported");
	const status =
		capabilityGate === "not_reported" && !hasReportedCheck
			? "not_reported"
			: Object.keys(blockers).length === 0
				? "ready"
				: "blocked";

	return {
		status,
		capabilityGate,
		projectionSource,
		checks,
		blockers,
	};
}

function collectCampusServicesProductPathBlockers(
	capabilityGate: SupervisorCampusServicesProductPathPreflight["capabilityGate"],
	checks: SupervisorCampusServicesProductPathPreflight["checks"],
): Record<string, string> {
	const blockers: Record<string, string> = {};
	if (capabilityGate === "closed") {
		blockers.capabilityGate = "campus_services capability gate is closed";
	}
	if (checks.structuredQueryRuntime === "not_ready") {
		blockers.structuredQueryRuntime = "structured_query_runtime.configured is false";
	}
	const requiredChecks: readonly [
		keyof SupervisorCampusServicesProductPathPreflight["checks"],
		string,
	][] = [
		["serviceStatusProjection", "service_status_projection_ready is false"],
		["serviceStatusReadModel", "service_status_read_model is not configured or unhealthy"],
		["transportSchedule", "transport_schedule_implemented is false"],
		["transportScheduleReadModel", "transport_schedule_read_model is not configured or unhealthy"],
		["serviceGuideProjection", "service_guide_projection_ready is false"],
		["serviceGuideReadModel", "service_guide_read_model is not configured or unhealthy"],
		["contactDirectoryProjection", "contact_directory_projection_ready is false"],
		["contactDirectoryReadModel", "contact_directory_read_model is not configured or unhealthy"],
	];
	for (const [key, message] of requiredChecks) {
		if (checks[key] === "not_ready") {
			blockers[key] = message;
		}
	}
	return blockers;
}

function resolveCampusServicesCapabilityGate(
	payload: SupervisorReadyzRecord | null,
): SupervisorCampusServicesProductPathPreflight["capabilityGate"] {
	const capabilityGates = readRecord(payload?.capability_gates);
	const campusServices = readRecord(capabilityGates?.campus_services);
	if (campusServices?.open === true) {
		return "open";
	}
	if (campusServices?.open === false) {
		return "closed";
	}
	return "not_reported";
}

function readinessFromBoolean(value: unknown): SupervisorReadinessCheckStatus {
	if (value === true) {
		return "ready";
	}
	if (value === false) {
		return "not_ready";
	}
	return "not_reported";
}

function readinessFromConfiguredAndHealthy(
	configured: unknown,
	healthy: unknown,
): SupervisorReadinessCheckStatus {
	if (configured === undefined && healthy === undefined) {
		return "not_reported";
	}
	return configured === true && healthy === true ? "ready" : "not_ready";
}

function readRecord(value: unknown): SupervisorReadyzRecord | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as SupervisorReadyzRecord;
}

function readString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export class SupervisorTransportError extends Error {
	readonly code: string;
	readonly retryable: boolean;
	readonly status: number;

	constructor(input: {
		code: string;
		message: string;
		retryable: boolean;
		status: number;
	}) {
		super(input.message);
		this.name = "SupervisorTransportError";
		this.code = input.code;
		this.retryable = input.retryable;
		this.status = input.status;
	}
}

export function mapStatusCodeToErrorCode(status: number): string {
	if (status === 504) {
		return "execution_timeout";
	}

	return "supervisor_unavailable";
}

export function createSupervisorRequestHeaders(input: {
	env: Pick<Env, "SUPERVISOR_API_ACCESS_CLIENT_ID" | "SUPERVISOR_API_ACCESS_CLIENT_SECRET">;
	payload: SupervisorExecutionInput;
	sharedSecret: string;
	traceDataProvider: () => Record<string, unknown>;
	accept?: string;
}): Record<string, string> {
	const headers = new Headers({
		"content-type": "application/json",
		"x-trace-id": input.payload.traceId,
		"x-worker-origin-auth": input.sharedSecret,
	});
	if (input.accept) {
		headers.set("accept", input.accept);
	}
	applyTracePropagationHeaders(
		headers,
		resolveTracePropagationHeaders({
			traceData: input.traceDataProvider(),
		}),
	);
	if (input.payload.traceHeaders) {
		applyTracePropagationHeaders(headers, input.payload.traceHeaders);
	}
	return {
		...Object.fromEntries(headers.entries()),
		...createCloudflareAccessServiceTokenHeaders(input.env),
	};
}

function createCloudflareAccessServiceTokenHeaders(
	env: Pick<Env, "SUPERVISOR_API_ACCESS_CLIENT_ID" | "SUPERVISOR_API_ACCESS_CLIENT_SECRET">,
): Record<string, string> {
	const clientId = env.SUPERVISOR_API_ACCESS_CLIENT_ID?.trim();
	const clientSecret = env.SUPERVISOR_API_ACCESS_CLIENT_SECRET?.trim();
	if (!(clientId && clientSecret)) {
		return {};
	}

	return {
		"CF-Access-Client-Id": clientId,
		"CF-Access-Client-Secret": clientSecret,
	};
}
