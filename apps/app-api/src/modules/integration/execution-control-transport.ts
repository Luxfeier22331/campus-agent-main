import { DEFAULT_EXECUTION_CONTROL_TIMEOUT_MS, type Env, parsePositiveInteger } from "../../config";
import { applyTracePropagationHeaders, resolveTracePropagationHeaders } from "../telemetry/trace";

import type { ToolExecutionInput } from "./tool-execution-types";

type ExecutionControlReadyzRecord = Record<string, unknown>;
type ExecutionControlReadinessCheckStatus = "ready" | "not_ready" | "not_reported";

export interface ExecutionControlCampusServicesProductPathPreflight {
	status: "ready" | "blocked" | "not_reported";
	toolGate: "open" | "closed" | "not_reported";
	projectionSource: string;
	checks: {
		toolReadModelRuntime: ExecutionControlReadinessCheckStatus;
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

export interface ExecutionControlRunProjectionStoreHealth {
	configured: boolean;
	healthy: boolean;
	lastError: string | null;
}

export interface ExecutionControlTemporalTaskQueuePollerHealth {
	healthy: boolean;
	name: string;
	pollers: number;
	type: string;
}

export interface ExecutionControlTemporalRuntimeHealth {
	configured: boolean;
	healthy: boolean;
	lastError: string | null;
	namespace: string;
	requiredTaskQueues: string[];
	taskQueueGate: "pollers_required";
	taskQueuePollers: ExecutionControlTemporalTaskQueuePollerHealth[];
	workerId: string;
	workflowTaskQueue: string;
}

export interface ExecutionControlOperatorRuntimeHealth {
	asOf: string;
	executionRuntime: ExecutionControlRuntimePreflight;
	runProjectionStore: ExecutionControlRunProjectionStoreHealth | null;
	status: "ready" | "degraded";
	temporalRuntime: ExecutionControlTemporalRuntimeHealth | null;
}

export interface ExecutionControlReadinessProbeResult {
	campusServicesProductPath: ExecutionControlCampusServicesProductPathPreflight;
	executionRuntime: ExecutionControlRuntimePreflight;
	runtimeHealth: ExecutionControlOperatorRuntimeHealth;
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
	const response = await fetchExecutionControlReadyz(env, input);
	if (response.status !== 200) {
		throw new ExecutionControlTransportError({
			code: mapStatusCodeToErrorCode(response.status),
			message: `Execution control readiness probe returned ${response.status}.`,
			retryable: response.status >= 500,
			status: response.status,
		});
	}

	const payload = await parseExecutionControlReadyzPayload(response);
	const executionRuntime = buildExecutionRuntimePreflight(payload);
	return {
		campusServicesProductPath: buildCampusServicesProductPathPreflight(payload),
		executionRuntime,
		runtimeHealth: buildOperatorRuntimeHealth(payload, executionRuntime),
	};
}

export async function probeExecutionControlOperatorRuntimeHealth(
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
): Promise<ExecutionControlOperatorRuntimeHealth> {
	const response = await fetchExecutionControlReadyz(env, input);
	if (response.status !== 200 && response.status !== 503) {
		throw new ExecutionControlTransportError({
			code: mapStatusCodeToErrorCode(response.status),
			message: `Execution control runtime health probe returned ${response.status}.`,
			retryable: response.status >= 500,
			status: response.status,
		});
	}

	const payload = await parseExecutionControlReadyzPayload(response);
	return buildOperatorRuntimeHealth(payload, buildExecutionRuntimePreflight(payload));
}

async function fetchExecutionControlReadyz(
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
): Promise<Response> {
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

	return response;
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
	const toolGate = resolveCampusServicesToolGate(payload);
	const toolReadModelRuntime = readRecord(payload?.tool_read_model_runtime);
	const projectionSource = readString(toolReadModelRuntime?.projection_source);
	const checks: ExecutionControlCampusServicesProductPathPreflight["checks"] = {
		toolReadModelRuntime: readinessFromBoolean(toolReadModelRuntime?.configured),
		transportSchedule: readinessFromBoolean(toolReadModelRuntime?.transport_schedule_implemented),
		transportScheduleReadModel: readinessFromConfiguredAndHealthy(
			toolReadModelRuntime?.transport_schedule_read_model_configured,
			toolReadModelRuntime?.transport_schedule_read_model_healthy,
		),
	};
	const blockers = collectCampusServicesProductPathBlockers(toolGate, checks);
	const hasReportedCheck = Object.values(checks).some((status) => status !== "not_reported");
	const status =
		toolGate === "not_reported" && !hasReportedCheck
			? "not_reported"
			: Object.keys(blockers).length === 0
				? "ready"
				: "blocked";

	return {
		status,
		toolGate,
		projectionSource,
		checks,
		blockers,
	};
}

function collectCampusServicesProductPathBlockers(
	toolGate: ExecutionControlCampusServicesProductPathPreflight["toolGate"],
	checks: ExecutionControlCampusServicesProductPathPreflight["checks"],
): Record<string, string> {
	const blockers: Record<string, string> = {};
	if (toolGate === "closed") {
		blockers.toolGate = "transport_schedule_lookup tool gate is closed";
	}
	if (checks.toolReadModelRuntime === "not_ready") {
		blockers.toolReadModelRuntime = "tool_read_model_runtime.configured is false";
	}
	const requiredChecks: readonly [
		keyof ExecutionControlCampusServicesProductPathPreflight["checks"],
		string,
	][] = [
		["transportSchedule", "transport_schedule_implemented is false"],
		["transportScheduleReadModel", "transport_schedule_read_model is not configured or unhealthy"],
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

function buildOperatorRuntimeHealth(
	payload: ExecutionControlReadyzRecord,
	executionRuntime: ExecutionControlRuntimePreflight,
): ExecutionControlOperatorRuntimeHealth {
	return {
		asOf: new Date().toISOString(),
		executionRuntime,
		runProjectionStore: buildRunProjectionStoreHealth(payload),
		status: executionRuntime.status === "ready" ? "ready" : "degraded",
		temporalRuntime: buildTemporalRuntimeHealth(payload),
	};
}

function buildRunProjectionStoreHealth(
	payload: ExecutionControlReadyzRecord,
): ExecutionControlRunProjectionStoreHealth | null {
	const runProjectionStore = readRecord(payload.run_projection_store);
	if (!runProjectionStore) {
		return null;
	}
	return {
		configured: runProjectionStore.configured === true,
		healthy: runProjectionStore.healthy === true,
		lastError: readNullableString(runProjectionStore.last_error),
	};
}

function buildTemporalRuntimeHealth(
	payload: ExecutionControlReadyzRecord,
): ExecutionControlTemporalRuntimeHealth | null {
	const temporalRuntime = readRecord(payload.temporal_runtime);
	if (!temporalRuntime) {
		return null;
	}
	return {
		configured: temporalRuntime.configured === true,
		healthy: temporalRuntime.healthy === true,
		lastError: readNullableString(temporalRuntime.last_error),
		namespace: readString(temporalRuntime.namespace),
		requiredTaskQueues: readStringArray(temporalRuntime.task_queues),
		taskQueueGate: "pollers_required",
		taskQueuePollers: readTaskQueuePollers(temporalRuntime.task_queue_pollers),
		workerId: readString(temporalRuntime.worker_id),
		workflowTaskQueue: readString(temporalRuntime.task_queue),
	};
}

function readTaskQueuePollers(value: unknown): ExecutionControlTemporalTaskQueuePollerHealth[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map((item) => {
		const record = readRecord(item);
		return {
			healthy: record?.healthy === true,
			name: readString(record?.name),
			pollers: readNonNegativeNumber(record?.pollers),
			type: readString(record?.type),
		};
	});
}

function resolveCampusServicesToolGate(
	payload: ExecutionControlReadyzRecord | null,
): ExecutionControlCampusServicesProductPathPreflight["toolGate"] {
	const toolGates = readRecord(payload?.tool_gates);
	const transportSchedule = readRecord(toolGates?.transport_schedule_lookup);
	if (transportSchedule?.open === true) {
		return "open";
	}
	if (transportSchedule?.open === false) {
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

function readNullableString(value: unknown): string | null {
	const text = readString(value).trim();
	return text.length > 0 ? text : null;
}

function readStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === "string");
}

function readNonNegativeNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
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
	payload: Pick<ToolExecutionInput, "traceHeaders" | "traceId">;
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

export function createCloudflareAccessServiceTokenHeaders(
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
