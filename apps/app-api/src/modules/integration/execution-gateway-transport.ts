import { DEFAULT_EXECUTION_GATEWAY_TIMEOUT_MS, type Env, parsePositiveInteger } from "../../config";
import { applyTracePropagationHeaders, resolveTracePropagationHeaders } from "../telemetry/trace";

import type { SupervisorExecutionInput } from "./supervisor-types";

type ExecutionGatewayReadyzRecord = Record<string, unknown>;
type ExecutionGatewayReadinessCheckStatus = "ready" | "not_ready" | "not_reported";

export interface ExecutionGatewayCampusServicesProductPathPreflight {
	status: "ready" | "blocked" | "not_reported";
	capabilityGate: "open" | "closed" | "not_reported";
	projectionSource: string;
	checks: {
		contactDirectoryProjection: ExecutionGatewayReadinessCheckStatus;
		contactDirectoryReadModel: ExecutionGatewayReadinessCheckStatus;
		serviceGuideProjection: ExecutionGatewayReadinessCheckStatus;
		serviceGuideReadModel: ExecutionGatewayReadinessCheckStatus;
		serviceStatusProjection: ExecutionGatewayReadinessCheckStatus;
		serviceStatusReadModel: ExecutionGatewayReadinessCheckStatus;
		structuredQueryRuntime: ExecutionGatewayReadinessCheckStatus;
		transportSchedule: ExecutionGatewayReadinessCheckStatus;
		transportScheduleReadModel: ExecutionGatewayReadinessCheckStatus;
	};
	blockers: Record<string, string>;
}

export interface ExecutionGatewayRuntimePreflight {
	status: "ready" | "blocked" | "not_reported";
	checks: {
		durableRuntimeStore: ExecutionGatewayReadinessCheckStatus;
		temporalRuntime: ExecutionGatewayReadinessCheckStatus;
	};
	blockers: Record<string, string>;
}

export interface ExecutionGatewayReadinessProbeResult {
	campusServicesProductPath: ExecutionGatewayCampusServicesProductPathPreflight;
	durableRuntime: ExecutionGatewayRuntimePreflight;
}

export async function probeExecutionGatewayReady(
	env: Pick<
		Env,
		| "EXECUTION_GATEWAY_ACCESS_CLIENT_ID"
		| "EXECUTION_GATEWAY_ACCESS_CLIENT_SECRET"
		| "EXECUTION_GATEWAY_BASE_URL"
		| "EXECUTION_GATEWAY_SHARED_SECRET"
		| "EXECUTION_GATEWAY_TIMEOUT_MS"
	>,
	input: {
		fetchImplementation?: typeof fetch;
	} = {},
): Promise<ExecutionGatewayReadinessProbeResult> {
	const baseUrl = env.EXECUTION_GATEWAY_BASE_URL?.trim();
	if (!baseUrl) {
		throw new ExecutionGatewayTransportError({
			code: "dependency_not_ready",
			message: "Execution gateway is not configured.",
			retryable: true,
			status: 503,
		});
	}

	const timeoutMs = parsePositiveInteger(
		env.EXECUTION_GATEWAY_TIMEOUT_MS,
		DEFAULT_EXECUTION_GATEWAY_TIMEOUT_MS,
	);
	const fetchImplementation = input.fetchImplementation ?? fetch;

	let response: Response;
	try {
		response = await new Promise<Response>((resolve, reject) => {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => {
				controller.abort();
				reject(
					new ExecutionGatewayTransportError({
						code: "execution_timeout",
						message: `Execution gateway readiness probe exceeded ${timeoutMs}ms timeout.`,
						retryable: true,
						status: 504,
					}),
				);
			}, timeoutMs);

			fetchImplementation(`${baseUrl}/readyz`, {
				headers: createExecutionGatewayReadinessHeaders(env),
				method: "GET",
				signal: controller.signal,
			})
				.then(resolve)
				.catch((error) => {
					if (error instanceof Error && error.name === "AbortError") {
						reject(
							new ExecutionGatewayTransportError({
								code: "execution_timeout",
							message: `Execution gateway readiness probe exceeded ${timeoutMs}ms timeout.`,
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
		if (error instanceof ExecutionGatewayTransportError) {
			throw error;
		}

		throw new ExecutionGatewayTransportError({
			code: "execution_gateway_unavailable",
			message: error instanceof Error ? error.message : "Execution gateway readiness probe failed.",
			retryable: true,
			status: 502,
		});
	}

	if (response.status !== 200) {
		throw new ExecutionGatewayTransportError({
			code: mapStatusCodeToErrorCode(response.status),
			message: `Execution gateway readiness probe returned ${response.status}.`,
			retryable: response.status >= 500,
			status: response.status,
		});
	}

	const payload = await parseExecutionGatewayReadyzPayload(response);
	return {
		campusServicesProductPath: buildCampusServicesProductPathPreflight(payload),
		durableRuntime: buildDurableRuntimePreflight(payload),
	};
}

async function parseExecutionGatewayReadyzPayload(response: Response): Promise<ExecutionGatewayReadyzRecord> {
	try {
		return (await response.json()) as ExecutionGatewayReadyzRecord;
	} catch {
		throw new ExecutionGatewayTransportError({
			code: "execution_gateway_invalid_response",
			message: "Execution gateway readiness probe returned an invalid JSON response.",
			retryable: true,
			status: 502,
		});
	}
}

function buildCampusServicesProductPathPreflight(
	payload: ExecutionGatewayReadyzRecord | null,
): ExecutionGatewayCampusServicesProductPathPreflight {
	const capabilityGate = resolveCampusServicesCapabilityGate(payload);
	const structuredRuntime = readRecord(payload?.structured_query_runtime);
	const projectionSource = readString(structuredRuntime?.projection_source);
	const checks: ExecutionGatewayCampusServicesProductPathPreflight["checks"] = {
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
	capabilityGate: ExecutionGatewayCampusServicesProductPathPreflight["capabilityGate"],
	checks: ExecutionGatewayCampusServicesProductPathPreflight["checks"],
): Record<string, string> {
	const blockers: Record<string, string> = {};
	if (capabilityGate === "closed") {
		blockers.capabilityGate = "campus_services capability gate is closed";
	}
	if (checks.structuredQueryRuntime === "not_ready") {
		blockers.structuredQueryRuntime = "structured_query_runtime.configured is false";
	}
	const requiredChecks: readonly [
		keyof ExecutionGatewayCampusServicesProductPathPreflight["checks"],
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

function buildDurableRuntimePreflight(
	payload: ExecutionGatewayReadyzRecord | null,
): ExecutionGatewayRuntimePreflight {
	const durableRuntime = readRecord(payload?.durable_runtime);
	const temporalRuntime = readRecord(payload?.temporal_runtime);
	const checks: ExecutionGatewayRuntimePreflight["checks"] = {
		durableRuntimeStore: readinessFromConfiguredAndHealthy(
			durableRuntime?.configured,
			durableRuntime?.healthy,
		),
		temporalRuntime: readinessFromConfiguredAndHealthy(
			temporalRuntime?.configured,
			temporalRuntime?.healthy,
		),
	};
	const blockers = collectDurableRuntimeBlockers(checks);
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

function collectDurableRuntimeBlockers(
	checks: ExecutionGatewayRuntimePreflight["checks"],
): Record<string, string> {
	const blockers: Record<string, string> = {};
	const requiredChecks: readonly [keyof ExecutionGatewayRuntimePreflight["checks"], string][] = [
		["durableRuntimeStore", "durable_runtime store is not configured and healthy"],
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
	payload: ExecutionGatewayReadyzRecord | null,
): ExecutionGatewayCampusServicesProductPathPreflight["capabilityGate"] {
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

function readinessFromBoolean(value: unknown): ExecutionGatewayReadinessCheckStatus {
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
): ExecutionGatewayReadinessCheckStatus {
	if (configured === undefined && healthy === undefined) {
		return "not_reported";
	}
	return configured === true && healthy === true ? "ready" : "not_ready";
}

function readRecord(value: unknown): ExecutionGatewayReadyzRecord | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as ExecutionGatewayReadyzRecord;
}

function readString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export class ExecutionGatewayTransportError extends Error {
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
		this.name = "ExecutionGatewayTransportError";
		this.code = input.code;
		this.retryable = input.retryable;
		this.status = input.status;
	}
}

export async function parseExecutionGatewayJsonResponse(
	response: Response,
): Promise<Record<string, unknown>> {
	try {
		const parsed = (await response.json()) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("Execution gateway JSON response must be an object.");
		}
		return parsed as Record<string, unknown>;
	} catch {
		throw new ExecutionGatewayTransportError({
			code: "execution_gateway_invalid_response",
			message: "Execution gateway returned an invalid JSON response.",
			retryable: true,
			status: response.status === 200 || response.status === 202 ? 502 : response.status,
		});
	}
}

export function parseExecutionGatewayErrorEnvelope(
	parsed: Record<string, unknown>,
	status: number,
): { code: string; message: string; retryable: boolean } {
	const error = parsed.error;
	if (!error || typeof error !== "object" || Array.isArray(error)) {
		throw new ExecutionGatewayTransportError({
			code: "execution_gateway_invalid_error_envelope",
			message: "Execution gateway returned an invalid error envelope.",
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
		throw new ExecutionGatewayTransportError({
			code: "execution_gateway_invalid_error_envelope",
			message: "Execution gateway returned an invalid error envelope.",
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

	return "execution_gateway_unavailable";
}

export function createExecutionGatewayRequestHeaders(input: {
	env: Pick<
		Env,
		"EXECUTION_GATEWAY_ACCESS_CLIENT_ID" | "EXECUTION_GATEWAY_ACCESS_CLIENT_SECRET"
	>;
	payload: Pick<SupervisorExecutionInput, "traceHeaders" | "traceId">;
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
	env: Pick<
		Env,
		"EXECUTION_GATEWAY_ACCESS_CLIENT_ID" | "EXECUTION_GATEWAY_ACCESS_CLIENT_SECRET"
	>,
): Record<string, string> {
	const clientId = env.EXECUTION_GATEWAY_ACCESS_CLIENT_ID?.trim();
	const clientSecret = env.EXECUTION_GATEWAY_ACCESS_CLIENT_SECRET?.trim();
	if (!(clientId && clientSecret)) {
		return {};
	}

	return {
		"CF-Access-Client-Id": clientId,
		"CF-Access-Client-Secret": clientSecret,
	};
}

function createExecutionGatewayReadinessHeaders(
	env: Pick<
		Env,
		| "EXECUTION_GATEWAY_ACCESS_CLIENT_ID"
		| "EXECUTION_GATEWAY_ACCESS_CLIENT_SECRET"
		| "EXECUTION_GATEWAY_SHARED_SECRET"
	>,
): Record<string, string> {
	const sharedSecret = env.EXECUTION_GATEWAY_SHARED_SECRET?.trim();
	return {
		...(sharedSecret ? { "x-worker-origin-auth": sharedSecret } : {}),
		...createCloudflareAccessServiceTokenHeaders(env),
	};
}
