import { DEFAULT_EXECUTION_CONTROL_TIMEOUT_MS, type Env, parsePositiveInteger } from "../../config";
import { applyTracePropagationHeaders, resolveTracePropagationHeaders } from "../telemetry/trace";

import type { CapabilityExecutionInput } from "./capability-execution-types";

type ExecutionControlReadyzRecord = Record<string, unknown>;
type ExecutionControlReadinessCheckStatus = "ready" | "not_ready" | "not_reported";

export interface ExecutionControlCampusServicesProductPathPreflight {
	status: "ready" | "blocked" | "not_reported";
	capabilityGate: "open" | "closed" | "not_reported";
	projectionSource: string;
	checks: {
		contactDirectoryProjection: ExecutionControlReadinessCheckStatus;
		contactDirectoryReadModel: ExecutionControlReadinessCheckStatus;
		serviceGuideProjection: ExecutionControlReadinessCheckStatus;
		serviceGuideReadModel: ExecutionControlReadinessCheckStatus;
		serviceStatusProjection: ExecutionControlReadinessCheckStatus;
		serviceStatusReadModel: ExecutionControlReadinessCheckStatus;
		structuredQueryRuntime: ExecutionControlReadinessCheckStatus;
		transportSchedule: ExecutionControlReadinessCheckStatus;
		transportScheduleReadModel: ExecutionControlReadinessCheckStatus;
	};
	blockers: Record<string, string>;
}

export interface ExecutionControlRuntimePreflight {
	status: "ready" | "blocked" | "not_reported";
	checks: {
		runProjectionStore: ExecutionControlReadinessCheckStatus;
		temporalRuntime: ExecutionControlReadinessCheckStatus;
	};
	blockers: Record<string, string>;
}

export interface ExecutionControlReadinessProbeResult {
	campusServicesProductPath: ExecutionControlCampusServicesProductPathPreflight;
	executionRuntime: ExecutionControlRuntimePreflight;
}

export async function probeExecutionControlReady(
	env: Pick<
		Env,
		| "EXECUTION_CONTROL_ACCESS_CLIENT_ID"
		| "EXECUTION_CONTROL_ACCESS_CLIENT_SECRET"
		| "EXECUTION_CONTROL_BASE_URL"
		| "EXECUTION_CONTROL_SHARED_SECRET"
		| "EXECUTION_CONTROL_TIMEOUT_MS"
	>,
	input: {
		fetchImplementation?: typeof fetch;
	} = {},
): Promise<ExecutionControlReadinessProbeResult> {
	const baseUrl = env.EXECUTION_CONTROL_BASE_URL?.trim();
	if (!baseUrl) {
		throw new ExecutionControlTransportError({
			code: "dependency_not_ready",
			message: "Execution control is not configured.",
			retryable: true,
			status: 503,
		});
	}

	const timeoutMs = parsePositiveInteger(
		env.EXECUTION_CONTROL_TIMEOUT_MS,
		DEFAULT_EXECUTION_CONTROL_TIMEOUT_MS,
	);
	const fetchImplementation = input.fetchImplementation ?? fetch;

	let response: Response;
	try {
		response = await new Promise<Response>((resolve, reject) => {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => {
				controller.abort();
				reject(
					new ExecutionControlTransportError({
						code: "execution_timeout",
						message: `Execution control readiness probe exceeded ${timeoutMs}ms timeout.`,
						retryable: true,
						status: 504,
					}),
				);
			}, timeoutMs);

			fetchImplementation(`${baseUrl}/readyz`, {
				headers: createExecutionControlReadinessHeaders(env),
				method: "GET",
				signal: controller.signal,
			})
				.then(resolve)
				.catch((error) => {
					if (error instanceof Error && error.name === "AbortError") {
						reject(
							new ExecutionControlTransportError({
								code: "execution_timeout",
								message: `Execution control readiness probe exceeded ${timeoutMs}ms timeout.`,
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
		if (error instanceof ExecutionControlTransportError) {
			throw error;
		}

		throw new ExecutionControlTransportError({
			code: "execution_control_unavailable",
			message: error instanceof Error ? error.message : "Execution control readiness probe failed.",
			retryable: true,
			status: 502,
		});
	}

	if (response.status !== 200) {
		throw new ExecutionControlTransportError({
			code: mapStatusCodeToErrorCode(response.status),
			message: `Execution control readiness probe returned ${response.status}.`,
			retryable: response.status >= 500,
			status: response.status,
		});
	}

	const payload = await parseExecutionControlReadyzPayload(response);
	return {
		campusServicesProductPath: buildCampusServicesProductPathPreflight(payload),
		executionRuntime: buildExecutionRuntimePreflight(payload),
	};
}

async function parseExecutionControlReadyzPayload(
	response: Response,
): Promise<ExecutionControlReadyzRecord> {
	try {
		return (await response.json()) as ExecutionControlReadyzRecord;
	} catch {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_response",
			message: "Execution control readiness probe returned an invalid JSON response.",
			retryable: true,
			status: 502,
		});
	}
}

function buildCampusServicesProductPathPreflight(
	payload: ExecutionControlReadyzRecord | null,
): ExecutionControlCampusServicesProductPathPreflight {
	const capabilityGate = resolveCampusServicesCapabilityGate(payload);
	const structuredRuntime = readRecord(payload?.structured_query_runtime);
	const projectionSource = readString(structuredRuntime?.projection_source);
	const checks: ExecutionControlCampusServicesProductPathPreflight["checks"] = {
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
	capabilityGate: ExecutionControlCampusServicesProductPathPreflight["capabilityGate"],
	checks: ExecutionControlCampusServicesProductPathPreflight["checks"],
): Record<string, string> {
	const blockers: Record<string, string> = {};
	if (capabilityGate === "closed") {
		blockers.capabilityGate = "campus_services capability gate is closed";
	}
	if (checks.structuredQueryRuntime === "not_ready") {
		blockers.structuredQueryRuntime = "structured_query_runtime.configured is false";
	}
	const requiredChecks: readonly [
		keyof ExecutionControlCampusServicesProductPathPreflight["checks"],
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

function buildExecutionRuntimePreflight(
	payload: ExecutionControlReadyzRecord | null,
): ExecutionControlRuntimePreflight {
	const runProjectionStore = readRecord(payload?.run_projection_store);
	const temporalRuntime = readRecord(payload?.temporal_runtime);
	const checks: ExecutionControlRuntimePreflight["checks"] = {
		runProjectionStore: readinessFromConfiguredAndHealthy(
			runProjectionStore?.configured,
			runProjectionStore?.healthy,
		),
		temporalRuntime: readinessFromConfiguredAndHealthy(
			temporalRuntime?.configured,
			temporalRuntime?.healthy,
		),
	};
	const blockers = collectExecutionRuntimeBlockers(checks);
	const hasReportedCheck = Object.values(checks).some((status) => status !== "not_reported");
	const status = hasReportedCheck
		? Object.keys(blockers).length === 0
			? "ready"
			: "blocked"
		: "not_reported";

	return {
		status,
		checks,
		blockers,
	};
}

function collectExecutionRuntimeBlockers(
	checks: ExecutionControlRuntimePreflight["checks"],
): Record<string, string> {
	const blockers: Record<string, string> = {};
	const requiredChecks: readonly [keyof ExecutionControlRuntimePreflight["checks"], string][] = [
		["runProjectionStore", "run_projection_store is not configured and healthy"],
		["temporalRuntime", "temporal_runtime is not configured and healthy"],
	];
	for (const [key, message] of requiredChecks) {
		if (checks[key] !== "ready") {
			blockers[key] = message;
		}
	}
	return blockers;
}

function resolveCampusServicesCapabilityGate(
	payload: ExecutionControlReadyzRecord | null,
): ExecutionControlCampusServicesProductPathPreflight["capabilityGate"] {
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

function readinessFromBoolean(value: unknown): ExecutionControlReadinessCheckStatus {
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
): ExecutionControlReadinessCheckStatus {
	if (configured === undefined && healthy === undefined) {
		return "not_reported";
	}
	return configured === true && healthy === true ? "ready" : "not_ready";
}

function readRecord(value: unknown): ExecutionControlReadyzRecord | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as ExecutionControlReadyzRecord;
}

function readString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export class ExecutionControlTransportError extends Error {
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
		this.name = "ExecutionControlTransportError";
		this.code = input.code;
		this.retryable = input.retryable;
		this.status = input.status;
	}
}

export async function parseExecutionControlJsonResponse(
	response: Response,
): Promise<Record<string, unknown>> {
	try {
		const parsed = (await response.json()) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("Execution control JSON response must be an object.");
		}
		return parsed as Record<string, unknown>;
	} catch {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_response",
			message: "Execution control returned an invalid JSON response.",
			retryable: true,
			status: response.status === 200 || response.status === 202 ? 502 : response.status,
		});
	}
}

export function parseExecutionControlErrorEnvelope(
	parsed: Record<string, unknown>,
	status: number,
): { code: string; message: string; retryable: boolean } {
	const error = parsed.error;
	if (!error || typeof error !== "object" || Array.isArray(error)) {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_error_envelope",
			message: "Execution control returned an invalid error envelope.",
			retryable: false,
			status,
		});
	}
	const record = error as Record<string, unknown>;
	if (
		typeof record.code !== "string" ||
		record.code.trim() === "" ||
		typeof record.message !== "string" ||
		record.message.trim() === "" ||
		typeof record.retryable !== "boolean"
	) {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_error_envelope",
			message: "Execution control returned an invalid error envelope.",
			retryable: false,
			status,
		});
	}
	return {
		code: record.code,
		message: record.message,
		retryable: record.retryable,
	};
}

export function mapStatusCodeToErrorCode(status: number): string {
	if (status === 504) {
		return "execution_timeout";
	}

	return "execution_control_unavailable";
}

export function createExecutionControlRequestHeaders(input: {
	env: Pick<Env, "EXECUTION_CONTROL_ACCESS_CLIENT_ID" | "EXECUTION_CONTROL_ACCESS_CLIENT_SECRET">;
	payload: Pick<CapabilityExecutionInput, "traceHeaders" | "traceId">;
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
	env: Pick<Env, "EXECUTION_CONTROL_ACCESS_CLIENT_ID" | "EXECUTION_CONTROL_ACCESS_CLIENT_SECRET">,
): Record<string, string> {
	const clientId = env.EXECUTION_CONTROL_ACCESS_CLIENT_ID?.trim();
	const clientSecret = env.EXECUTION_CONTROL_ACCESS_CLIENT_SECRET?.trim();
	if (!(clientId && clientSecret)) {
		return {};
	}

	return {
		"CF-Access-Client-Id": clientId,
		"CF-Access-Client-Secret": clientSecret,
	};
}

function createExecutionControlReadinessHeaders(
	env: Pick<
		Env,
		| "EXECUTION_CONTROL_ACCESS_CLIENT_ID"
		| "EXECUTION_CONTROL_ACCESS_CLIENT_SECRET"
		| "EXECUTION_CONTROL_SHARED_SECRET"
	>,
): Record<string, string> {
	const sharedSecret = env.EXECUTION_CONTROL_SHARED_SECRET?.trim();
	return {
		...(sharedSecret ? { "x-worker-origin-auth": sharedSecret } : {}),
		...createCloudflareAccessServiceTokenHeaders(env),
	};
}
