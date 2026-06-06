import { DEFAULT_EXECUTION_CONTROL_TIMEOUT_MS, type Env, parsePositiveInteger } from "../../config";
import type { TracePropagationHeaders } from "../telemetry/trace";
import {
	createExecutionControlRequestHeaders,
	parseExecutionControlErrorEnvelope,
	parseExecutionControlJsonResponse,
	ExecutionControlTransportError,
} from "./execution-control-transport";

type ExecutionControlRuntimeEnv = Pick<
	Env,
	| "EXECUTION_CONTROL_ACCESS_CLIENT_ID"
	| "EXECUTION_CONTROL_ACCESS_CLIENT_SECRET"
	| "EXECUTION_CONTROL_BASE_URL"
	| "EXECUTION_CONTROL_SHARED_SECRET"
	| "EXECUTION_CONTROL_TIMEOUT_MS"
>;

type JsonRecord = Record<string, unknown>;

export interface ExecutionControlRunCreateInput {
	conversationId: string;
	lane: string;
	metadata: JsonRecord;
	ownerUserId: string;
	requestId: string;
	requestedCapability?: string | null;
	runId: string;
	runtimeVersions?: JsonRecord | null;
	selectedCapability?: string | null;
	surface: string;
	traceHeaders?: TracePropagationHeaders;
	traceId?: string | null;
	turnId: string;
}

export interface ExecutionControlRunQuery {
	runId: string;
	traceHeaders?: TracePropagationHeaders;
	traceId?: string | null;
}

export interface ExecutionControlRunEventQuery {
	afterSequence?: number;
	runId: string;
	traceHeaders?: TracePropagationHeaders;
	traceId?: string | null;
}

export interface ExecutionControlRunCancelInput {
	reason: string;
	runId: string;
	traceHeaders?: TracePropagationHeaders;
	traceId?: string | null;
}

export interface ExecutionControlRun {
	admittedAt: string;
	completedAt: string;
	conversationId: string;
	createdAt: string;
	failCloseReason: string;
	finalResponseRef: string;
	lane: string;
	ownerUserId: string;
	requestId: string;
	requestedCapability: string;
	runId: string;
	selectedCapability: string;
	startedAt: string;
	status: string;
	streamingStartedAt: string;
	surface: string;
	terminalReason: string;
	traceId: string;
	turnId: string;
	updatedAt: string;
	workflowPlanRef: string;
}

export interface ExecutionControlRunEvent {
	conversationId: string;
	eventId: string;
	eventType: string;
	occurredAt: string;
	payload: JsonRecord;
	payloadSchemaVersion: string;
	runId: string;
	sequence: number;
	visibility: string;
}

export interface ExecutionControlRuntimeClient {
	cancelRun(input: ExecutionControlRunCancelInput): Promise<ExecutionControlRun>;
	createRun(input: ExecutionControlRunCreateInput): Promise<ExecutionControlRun>;
	getRun(input: ExecutionControlRunQuery): Promise<ExecutionControlRun>;
	listRunEvents(input: ExecutionControlRunEventQuery): Promise<ExecutionControlRunEvent[]>;
}

export function isExecutionControlRuntimeConfigured(env: ExecutionControlRuntimeEnv): boolean {
	return Boolean(env.EXECUTION_CONTROL_BASE_URL?.trim() && env.EXECUTION_CONTROL_SHARED_SECRET?.trim());
}

export function createExecutionControlRuntimeClient(
	env: ExecutionControlRuntimeEnv,
	input: {
		fetchImplementation?: typeof fetch;
		traceDataProvider?: () => Record<string, unknown>;
	} = {},
): ExecutionControlRuntimeClient {
	const fetchImplementation = input.fetchImplementation ?? fetch;
	const traceDataProvider = input.traceDataProvider ?? (() => ({}));

	async function requestExecutionControl(
		path: string,
		options: {
			body?: JsonRecord;
			expectedStatus: number;
			method: "GET" | "POST";
			traceHeaders?: TracePropagationHeaders;
			traceId?: string | null;
		},
	): Promise<JsonRecord> {
		const baseUrl = env.EXECUTION_CONTROL_BASE_URL?.trim();
		const sharedSecret = env.EXECUTION_CONTROL_SHARED_SECRET?.trim();
		if (!(baseUrl && sharedSecret)) {
			throw new ExecutionControlTransportError({
				code: "dependency_not_ready",
				message: "Execution control runtime is not configured.",
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
							message: `Execution control runtime request exceeded ${timeoutMs}ms timeout.`,
							retryable: true,
							status: 504,
						}),
					);
				}, timeoutMs);

				fetchImplementation(`${baseUrl}${path}`, {
					body: options.body ? JSON.stringify(options.body) : undefined,
					headers: createExecutionControlRequestHeaders({
						env,
						payload: {
							traceHeaders: options.traceHeaders,
							traceId: options.traceId?.trim() || "",
						},
						sharedSecret,
						traceDataProvider,
					}),
					method: options.method,
					signal: controller.signal,
				})
					.then(resolve)
					.catch((error) => {
						if (error instanceof Error && error.name === "AbortError") {
							reject(
								new ExecutionControlTransportError({
									code: "execution_timeout",
									message: `Execution control runtime request exceeded ${timeoutMs}ms timeout.`,
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
				message:
					error instanceof Error ? error.message : "Execution control runtime request failed.",
				retryable: true,
				status: 502,
			});
		}

		const parsed = await parseExecutionControlJsonResponse(response);
		if (response.status !== options.expectedStatus) {
			const errorEnvelope = parseExecutionControlErrorEnvelope(parsed, response.status);
			throw new ExecutionControlTransportError({
				code: errorEnvelope.code,
				message: errorEnvelope.message,
				retryable: errorEnvelope.retryable,
				status: response.status,
			});
		}
		return parsed;
	}

	return {
		async cancelRun(cancelInput: ExecutionControlRunCancelInput): Promise<ExecutionControlRun> {
			const parsed = await requestExecutionControl(`/internal/execution/runs/${cancelInput.runId}/cancel`, {
				body: {
					reason: cancelInput.reason,
				},
				expectedStatus: 202,
				method: "POST",
				traceHeaders: cancelInput.traceHeaders,
				traceId: cancelInput.traceId,
			});
			return parseDurableRun(parsed);
		},
		async createRun(createInput: ExecutionControlRunCreateInput): Promise<ExecutionControlRun> {
			const parsed = await requestExecutionControl("/internal/execution/runs", {
				body: toDurableRunCreateBody(createInput),
				expectedStatus: 202,
				method: "POST",
				traceHeaders: createInput.traceHeaders,
				traceId: createInput.traceId,
			});
			return parseDurableRun(parsed);
		},
		async getRun(query: ExecutionControlRunQuery): Promise<ExecutionControlRun> {
			const parsed = await requestExecutionControl(`/internal/execution/runs/${query.runId}`, {
				expectedStatus: 200,
				method: "GET",
				traceHeaders: query.traceHeaders,
				traceId: query.traceId,
			});
			return parseDurableRun(parsed);
		},
		async listRunEvents(
			query: ExecutionControlRunEventQuery,
		): Promise<ExecutionControlRunEvent[]> {
			const parsed = await requestExecutionControl(durableRunEventsPath(query), {
				expectedStatus: 200,
				method: "GET",
				traceHeaders: query.traceHeaders,
				traceId: query.traceId,
			});
			return parseDurableRunEvents(parsed);
		},
	};
}


function durableRunEventsPath(query: ExecutionControlRunEventQuery): string {
	const path = `/internal/execution/runs/${query.runId}/events`;
	if (query.afterSequence === undefined) {
		return path;
	}
	if (
		!(Number.isInteger(query.afterSequence) && Number.isFinite(query.afterSequence)) ||
		query.afterSequence < 0
	) {
		throw new ExecutionControlTransportError({
			code: "invalid_request",
			message: "afterSequence must be a non-negative integer.",
			retryable: false,
			status: 400,
		});
	}
	return `${path}?after_sequence=${query.afterSequence}`;
}

function toDurableRunCreateBody(input: ExecutionControlRunCreateInput): JsonRecord {
	return {
		conversation_id: input.conversationId,
		lane: input.lane,
		metadata: input.metadata,
		owner_user_id: input.ownerUserId,
		request_id: input.requestId,
		requested_capability: input.requestedCapability ?? "",
		run_id: input.runId,
		runtime_versions: input.runtimeVersions ?? {},
		selected_capability: input.selectedCapability ?? "",
		surface: input.surface,
		trace_id: input.traceId ?? "",
		turn_id: input.turnId,
	};
}

function parseDurableRun(payload: JsonRecord): ExecutionControlRun {
	return {
		admittedAt: readRequiredString(payload, "admitted_at"),
		completedAt: readRequiredString(payload, "completed_at"),
		conversationId: readRequiredString(payload, "conversation_id"),
		createdAt: readRequiredString(payload, "created_at"),
		failCloseReason: readRequiredString(payload, "fail_close_reason"),
		finalResponseRef: readRequiredString(payload, "final_response_ref"),
		lane: readRequiredString(payload, "lane"),
		ownerUserId: readRequiredString(payload, "owner_user_id"),
		requestId: readRequiredString(payload, "request_id"),
		requestedCapability: readRequiredString(payload, "requested_capability"),
		runId: readRequiredString(payload, "run_id"),
		selectedCapability: readRequiredString(payload, "selected_capability"),
		startedAt: readRequiredString(payload, "started_at"),
		status: readRequiredString(payload, "status"),
		streamingStartedAt: readRequiredString(payload, "streaming_started_at"),
		surface: readRequiredString(payload, "surface"),
		terminalReason: readRequiredString(payload, "terminal_reason"),
		traceId: readRequiredString(payload, "trace_id"),
		turnId: readRequiredString(payload, "turn_id"),
		updatedAt: readRequiredString(payload, "updated_at"),
		workflowPlanRef: readRequiredString(payload, "workflow_plan_ref"),
	};
}

function parseDurableRunEvents(payload: JsonRecord): ExecutionControlRunEvent[] {
	const events = payload.events;
	if (!Array.isArray(events)) {
		throw invalidDurableResponse("events must be an array.");
	}
	return events.map((event, index) => {
		if (!event || typeof event !== "object" || Array.isArray(event)) {
			throw invalidDurableResponse(`events[${index}] must be an object.`);
		}
		const record = event as JsonRecord;
		return {
			conversationId: readRequiredString(record, "conversation_id"),
			eventId: readRequiredString(record, "event_id"),
			eventType: readRequiredString(record, "event_type"),
			occurredAt: readRequiredString(record, "occurred_at"),
			payload: readRequiredRecord(record, "payload"),
			payloadSchemaVersion: readRequiredString(record, "payload_schema_version"),
			runId: readRequiredString(record, "run_id"),
			sequence: readRequiredNumber(record, "sequence"),
			visibility: readRequiredString(record, "visibility"),
		};
	});
}

function readRequiredString(payload: JsonRecord, key: string): string {
	const value = payload[key];
	if (typeof value !== "string") {
		throw invalidDurableResponse(`${key} must be a string.`);
	}
	return value;
}

function readRequiredNumber(payload: JsonRecord, key: string): number {
	const value = payload[key];
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw invalidDurableResponse(`${key} must be a finite number.`);
	}
	return value;
}

function readRequiredRecord(payload: JsonRecord, key: string): JsonRecord {
	const value = payload[key];
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw invalidDurableResponse(`${key} must be an object.`);
	}
	return value as JsonRecord;
}

function invalidDurableResponse(detail: string): ExecutionControlTransportError {
	return new ExecutionControlTransportError({
		code: "execution_control_invalid_response",
		message: `Execution control runtime response violates the contract: ${detail}`,
		retryable: true,
		status: 502,
	});
}
