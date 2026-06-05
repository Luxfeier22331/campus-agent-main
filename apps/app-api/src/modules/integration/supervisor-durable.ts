import { DEFAULT_SUPERVISOR_API_TIMEOUT_MS, type Env, parsePositiveInteger } from "../../config";
import type { TracePropagationHeaders } from "../telemetry/trace";
import {
	createSupervisorRequestHeaders,
	parseSupervisorErrorEnvelope,
	parseSupervisorJsonResponse,
	SupervisorTransportError,
} from "./supervisor-transport";

type SupervisorDurableEnv = Pick<
	Env,
	| "SUPERVISOR_API_ACCESS_CLIENT_ID"
	| "SUPERVISOR_API_ACCESS_CLIENT_SECRET"
	| "SUPERVISOR_API_BASE_URL"
	| "SUPERVISOR_API_SHARED_SECRET"
	| "SUPERVISOR_API_TIMEOUT_MS"
>;

type JsonRecord = Record<string, unknown>;

export interface SupervisorDurableRunCreateInput {
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

export interface SupervisorDurableRunQuery {
	runId: string;
	traceHeaders?: TracePropagationHeaders;
	traceId?: string | null;
}

export interface SupervisorDurableRunEventQuery {
	afterSequence?: number;
	runId: string;
	traceHeaders?: TracePropagationHeaders;
	traceId?: string | null;
}

export interface SupervisorDurableRunCancelInput {
	reason: string;
	runId: string;
	traceHeaders?: TracePropagationHeaders;
	traceId?: string | null;
}

export interface SupervisorDurableRun {
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

export interface SupervisorDurableRunEvent {
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

export interface SupervisorDurableRuntimeClient {
	cancelRun(input: SupervisorDurableRunCancelInput): Promise<SupervisorDurableRun>;
	createRun(input: SupervisorDurableRunCreateInput): Promise<SupervisorDurableRun>;
	getRun(input: SupervisorDurableRunQuery): Promise<SupervisorDurableRun>;
	listRunEvents(input: SupervisorDurableRunEventQuery): Promise<SupervisorDurableRunEvent[]>;
}

export function isSupervisorDurableRuntimeConfigured(env: SupervisorDurableEnv): boolean {
	return Boolean(env.SUPERVISOR_API_BASE_URL?.trim() && env.SUPERVISOR_API_SHARED_SECRET?.trim());
}

export function createSupervisorDurableRuntimeClient(
	env: SupervisorDurableEnv,
	input: {
		fetchImplementation?: typeof fetch;
		traceDataProvider?: () => Record<string, unknown>;
	} = {},
): SupervisorDurableRuntimeClient {
	const fetchImplementation = input.fetchImplementation ?? fetch;
	const traceDataProvider = input.traceDataProvider ?? (() => ({}));

	async function requestSupervisor(
		path: string,
		options: {
			body?: JsonRecord;
			expectedStatus: number;
			method: "GET" | "POST";
			traceHeaders?: TracePropagationHeaders;
			traceId?: string | null;
		},
	): Promise<JsonRecord> {
		const baseUrl = env.SUPERVISOR_API_BASE_URL?.trim();
		const sharedSecret = env.SUPERVISOR_API_SHARED_SECRET?.trim();
		if (!(baseUrl && sharedSecret)) {
			throw new SupervisorTransportError({
				code: "dependency_not_ready",
				message: "Supervisor durable runtime is not configured.",
				retryable: true,
				status: 503,
			});
		}

		const timeoutMs = parsePositiveInteger(
			env.SUPERVISOR_API_TIMEOUT_MS,
			DEFAULT_SUPERVISOR_API_TIMEOUT_MS,
		);
		let response: Response;
		try {
			response = await new Promise<Response>((resolve, reject) => {
				const controller = new AbortController();
				const timeoutId = setTimeout(() => {
					controller.abort();
					reject(
						new SupervisorTransportError({
							code: "execution_timeout",
							message: `Supervisor durable runtime request exceeded ${timeoutMs}ms timeout.`,
							retryable: true,
							status: 504,
						}),
					);
				}, timeoutMs);

				fetchImplementation(`${baseUrl}${path}`, {
					body: options.body ? JSON.stringify(options.body) : undefined,
					headers: createSupervisorRequestHeaders({
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
								new SupervisorTransportError({
									code: "execution_timeout",
									message: `Supervisor durable runtime request exceeded ${timeoutMs}ms timeout.`,
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
				message:
					error instanceof Error ? error.message : "Supervisor durable runtime request failed.",
				retryable: true,
				status: 502,
			});
		}

		const parsed = await parseSupervisorJsonResponse(response);
		if (response.status !== options.expectedStatus) {
			const errorEnvelope = parseSupervisorErrorEnvelope(parsed, response.status);
			throw new SupervisorTransportError({
				code: errorEnvelope.code,
				message: errorEnvelope.message,
				retryable: errorEnvelope.retryable,
				status: response.status,
			});
		}
		return parsed;
	}

	return {
		async cancelRun(cancelInput: SupervisorDurableRunCancelInput): Promise<SupervisorDurableRun> {
			const parsed = await requestSupervisor(`/internal/durable/runs/${cancelInput.runId}/cancel`, {
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
		async createRun(createInput: SupervisorDurableRunCreateInput): Promise<SupervisorDurableRun> {
			const parsed = await requestSupervisor("/internal/durable/runs", {
				body: toDurableRunCreateBody(createInput),
				expectedStatus: 202,
				method: "POST",
				traceHeaders: createInput.traceHeaders,
				traceId: createInput.traceId,
			});
			return parseDurableRun(parsed);
		},
		async getRun(query: SupervisorDurableRunQuery): Promise<SupervisorDurableRun> {
			const parsed = await requestSupervisor(`/internal/durable/runs/${query.runId}`, {
				expectedStatus: 200,
				method: "GET",
				traceHeaders: query.traceHeaders,
				traceId: query.traceId,
			});
			return parseDurableRun(parsed);
		},
		async listRunEvents(
			query: SupervisorDurableRunEventQuery,
		): Promise<SupervisorDurableRunEvent[]> {
			const parsed = await requestSupervisor(durableRunEventsPath(query), {
				expectedStatus: 200,
				method: "GET",
				traceHeaders: query.traceHeaders,
				traceId: query.traceId,
			});
			return parseDurableRunEvents(parsed);
		},
	};
}

function durableRunEventsPath(query: SupervisorDurableRunEventQuery): string {
	const path = `/internal/durable/runs/${query.runId}/events`;
	if (query.afterSequence === undefined) {
		return path;
	}
	if (
		!(Number.isInteger(query.afterSequence) && Number.isFinite(query.afterSequence)) ||
		query.afterSequence < 0
	) {
		throw new SupervisorTransportError({
			code: "invalid_request",
			message: "afterSequence must be a non-negative integer.",
			retryable: false,
			status: 400,
		});
	}
	return `${path}?after_sequence=${query.afterSequence}`;
}

function toDurableRunCreateBody(input: SupervisorDurableRunCreateInput): JsonRecord {
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

function parseDurableRun(payload: JsonRecord): SupervisorDurableRun {
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

function parseDurableRunEvents(payload: JsonRecord): SupervisorDurableRunEvent[] {
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

function invalidDurableResponse(detail: string): SupervisorTransportError {
	return new SupervisorTransportError({
		code: "supervisor_invalid_response",
		message: `Supervisor durable runtime response violates the contract: ${detail}`,
		retryable: true,
		status: 502,
	});
}
