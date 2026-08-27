import {
	type Env,
	EXECUTION_CONTROL_TIMEOUT_MS,
	PROFILE_MEMORY_COMMAND_TIMEOUT_MS,
} from "../../config";
import { DEFAULT_PERSONAL_MEMORY_TENANT_ID } from "../personalization/tenant";
import {
	assertExecutionControlResponseNotRedirect,
	createExecutionControlRequestHeaders,
	ExecutionControlTransportError,
	parseExecutionControlErrorEnvelope,
	parseExecutionControlJsonResponse,
	resolveExecutionControlUpstream,
	selectExecutionControlFetchImplementation,
} from "./execution-control-transport";
import type { ExecutionRunMetadataWire } from "./generated/tool-execution-contract";

type ExecutionControlRuntimeEnv = Pick<
	Env,
	| "DEPLOYMENT_ENVIRONMENT"
	| "EXECUTION_CONTROL_BASE_URL"
	| "EXECUTION_CONTROL_PRIVATE"
	| "EXECUTION_CONTROL_PRIVATE_ORIGIN"
	| "APP_API_EXECUTION_SHARED_SECRET"
>;

export type JsonRecord = Record<string, unknown>;

export interface ExecutionControlRunCreateInput {
	conversationId: string;
	metadata: ExecutionRunMetadataWire;
	ownerUserId: string;
	personalMemoryRecallAllowed: boolean;
	requestId: string;
	runtimeVersions?: JsonRecord | null;
	surface: string;
}

export interface ExecutionControlRunQuery {
	requestId: string;
	signal?: AbortSignal;
}

export interface ExecutionControlRunEventQuery {
	afterSequence?: number;
	requestId: string;
	signal?: AbortSignal;
	waitMs?: number;
}

export interface ExecutionControlRunCancelInput {
	reason: string;
	requestId: string;
}

export interface ExecutionControlOwnerDeletion {
	activeRunCount: number;
	ownerUserId: string;
	state: "draining" | "deleted";
}

export interface ExecutionControlRun {
	admittedAt: string;
	completedAt: string;
	conversationId: string;
	createdAt: string;
	failCloseReason: string;
	finalResponseRef: string;
	ownerUserId: string;
	queuedAt: string;
	requestId: string;
	startedAt: string;
	status: string;
	streamingStartedAt: string;
	surface: string;
	taskQueue: string;
	terminalReason: string;
	updatedAt: string;
}

export interface ExecutionControlRunEvent {
	conversationId: string;
	eventId: string;
	eventType: string;
	occurredAt: string;
	payload: JsonRecord;
	payloadSchemaVersion: string;
	requestId: string;
	sequence: number;
	visibility: string;
}

export interface ExecutionControlRunEventPage {
	events: ExecutionControlRunEvent[];
	nextSequence: number;
}

export interface ExecutionControlRuntimeClient {
	cancelRun(input: ExecutionControlRunCancelInput): Promise<ExecutionControlRun>;
	createRun(input: ExecutionControlRunCreateInput): Promise<ExecutionControlRun>;
	getRun(input: ExecutionControlRunQuery): Promise<ExecutionControlRun>;
	listRunEvents(input: ExecutionControlRunEventQuery): Promise<ExecutionControlRunEventPage>;
}

export interface ExecutionControlOwnerDeletionClient {
	beginOwnerDeletion(input: { ownerUserId: string }): Promise<ExecutionControlOwnerDeletion>;
	finalizeOwnerDeletion(input: { ownerUserId: string }): Promise<ExecutionControlOwnerDeletion>;
}

export interface ExecutionControlPersonalMemoryClient {
	admit(input: import("../profile-memory").ProfileMemoryCommandPayload): Promise<void>;
}

export function isExecutionControlRuntimeConfigured(env: ExecutionControlRuntimeEnv): boolean {
	try {
		resolveExecutionControlUpstream(env);
	} catch {
		return false;
	}
	return Boolean(env.APP_API_EXECUTION_SHARED_SECRET?.trim());
}

export function createExecutionControlRuntimeClient(
	env: ExecutionControlRuntimeEnv,
	input: {
		fetchImplementation?: typeof fetch;
	} = {},
): ExecutionControlRuntimeClient & ExecutionControlOwnerDeletionClient {
	const fetchImplementation = input.fetchImplementation ?? defaultRuntimeFetch;
	const requestExecutionControl = createExecutionControlRequester(env, {
		fetchImplementation,
	});

	return {
		async beginOwnerDeletion(input): Promise<ExecutionControlOwnerDeletion> {
			const parsed = await requestExecutionControl(
				`/internal/owners/${encodeURIComponent(input.ownerUserId)}/deletion/begin`,
				{ expectedStatus: 200, method: "POST" },
			);
			return parseOwnerDeletion(parsed);
		},
		async cancelRun(cancelInput: ExecutionControlRunCancelInput): Promise<ExecutionControlRun> {
			const parsed = await requestExecutionControl(
				`/internal/execution/requests/${cancelInput.requestId}/cancel`,
				{
					body: {
						reason: cancelInput.reason,
					},
					expectedStatus: 202,
					method: "POST",
				},
			);
			return parseDurableRun(parsed);
		},
		async createRun(createInput: ExecutionControlRunCreateInput): Promise<ExecutionControlRun> {
			const parsed = await requestExecutionControl("/internal/execution/requests", {
				body: toDurableRunCreateBody(createInput),
				expectedStatus: 202,
				method: "POST",
			});
			return parseDurableRun(parsed);
		},
		async finalizeOwnerDeletion(input): Promise<ExecutionControlOwnerDeletion> {
			const parsed = await requestExecutionControl(
				`/internal/owners/${encodeURIComponent(input.ownerUserId)}/deletion/finalize`,
				{
					body: { memory_erased: true },
					expectedStatus: 200,
					method: "POST",
				},
			);
			return parseOwnerDeletion(parsed);
		},
		async getRun(query: ExecutionControlRunQuery): Promise<ExecutionControlRun> {
			const parsed = await requestExecutionControl(
				`/internal/execution/requests/${query.requestId}`,
				{
					expectedStatus: 200,
					method: "GET",
					...(query.signal ? { signal: query.signal } : {}),
				},
			);
			return parseDurableRun(parsed);
		},
		async listRunEvents(
			query: ExecutionControlRunEventQuery,
		): Promise<ExecutionControlRunEventPage> {
			const parsed = await requestExecutionControl(durableRunEventsPath(query), {
				expectedStatus: 200,
				method: "GET",
				...(query.signal ? { signal: query.signal } : {}),
				...(query.waitMs === undefined
					? {}
					: { timeoutMs: Math.max(EXECUTION_CONTROL_TIMEOUT_MS, query.waitMs + 5_000) }),
			});
			return parseDurableRunEvents(parsed);
		},
	};
}

export function createExecutionControlPersonalMemoryClient(
	env: ExecutionControlRuntimeEnv,
	input: {
		fetchImplementation?: typeof fetch;
	} = {},
): ExecutionControlPersonalMemoryClient {
	const requestExecutionControl = createExecutionControlRequester(env, {
		fetchImplementation: input.fetchImplementation ?? defaultRuntimeFetch,
	});

	return {
		async admit(command) {
			await requestExecutionControl("/internal/memory/personal/commands", {
				body: {
					schema_version: command.schemaVersion,
					command_id: command.commandId,
					command_kind: command.commandKind,
					item: command.item,
					lifecycle_state: command.lifecycleState,
					owner_generation: command.ownerGeneration,
					owner_sequence: command.ownerSequence,
					subject_id: command.subjectId,
					subject_revision: command.subjectRevision,
					supersession_scope: command.supersessionScope,
					source_updated_at: command.sourceUpdatedAt,
					source_message_ids: command.sourceMessageIds,
					tenant_id: DEFAULT_PERSONAL_MEMORY_TENANT_ID,
					user_id: command.ownerUserId,
				},
				expectedStatus: 202,
				method: "POST",
				timeoutMs: PROFILE_MEMORY_COMMAND_TIMEOUT_MS,
			});
		},
	};
}

export const defaultRuntimeFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export function createExecutionControlRequester(
	env: ExecutionControlRuntimeEnv,
	input: {
		fetchImplementation?: typeof fetch;
	},
): (
	path: string,
	options: {
		body?: JsonRecord;
		expectedStatus: number;
		method: "GET" | "POST";
		signal?: AbortSignal;
		timeoutMs?: number;
	},
) => Promise<JsonRecord> {
	return async function requestExecutionControl(
		path: string,
		options: {
			body?: JsonRecord;
			expectedStatus: number;
			method: "GET" | "POST";
			signal?: AbortSignal;
			timeoutMs?: number;
		},
	): Promise<JsonRecord> {
		const sharedSecret = env.APP_API_EXECUTION_SHARED_SECRET?.trim();
		if (!sharedSecret) {
			throw new ExecutionControlTransportError({
				code: "dependency_not_ready",
				message: "Execution control runtime is not configured.",
				retryable: true,
				status: 503,
			});
		}
		const upstream = resolveExecutionControlUpstream(env);
		const fetchImplementation = selectExecutionControlFetchImplementation(
			env,
			upstream,
			input.fetchImplementation,
		);

		const timeoutMs = options.timeoutMs ?? EXECUTION_CONTROL_TIMEOUT_MS;
		let response: Response;
		try {
			let timeoutId: ReturnType<typeof setTimeout> | null = null;
			let removeExternalAbortListener: (() => void) | undefined;
			try {
				response = await new Promise<Response>((resolve, reject) => {
					const controller = new AbortController();
					const rejectExternalAbort = () => {
						controller.abort();
						reject(new DOMException("The operation was aborted.", "AbortError"));
					};
					if (options.signal?.aborted) {
						rejectExternalAbort();
						return;
					}
					if (options.signal) {
						options.signal.addEventListener("abort", rejectExternalAbort, { once: true });
						removeExternalAbortListener = () =>
							options.signal?.removeEventListener("abort", rejectExternalAbort);
					}
					timeoutId = setTimeout(() => {
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

					fetchImplementation(`${upstream.baseUrl}${path}`, {
						...(options.body ? { body: JSON.stringify(options.body) } : {}),
						headers: createExecutionControlRequestHeaders({ sharedSecret }),
						method: options.method,
						redirect: "manual",
						signal: controller.signal,
					}).then(resolve, reject);
				});
			} finally {
				if (timeoutId) {
					clearTimeout(timeoutId);
				}
				removeExternalAbortListener?.();
			}
		} catch (error) {
			if (error instanceof ExecutionControlTransportError) {
				throw error;
			}
			if (error instanceof Error && error.name === "AbortError") {
				throw error;
			}

			throw new ExecutionControlTransportError({
				code: "execution_control_unavailable",
				message: "Execution control runtime request failed.",
				retryable: true,
				status: 502,
			});
		}
		assertExecutionControlResponseNotRedirect(response);

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
	};
}

function durableRunEventsPath(query: ExecutionControlRunEventQuery): string {
	const path = `/internal/execution/requests/${query.requestId}/events`;
	const params = new URLSearchParams();
	if (query.afterSequence !== undefined) {
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
		params.set("after_sequence", String(query.afterSequence));
	}
	if (query.waitMs !== undefined) {
		if (!(Number.isInteger(query.waitMs) && Number.isFinite(query.waitMs)) || query.waitMs < 0) {
			throw new ExecutionControlTransportError({
				code: "invalid_request",
				message: "waitMs must be a non-negative integer.",
				retryable: false,
				status: 400,
			});
		}
		params.set("wait_ms", String(query.waitMs));
	}
	if (params.size === 0) {
		return path;
	}
	return `${path}?${params.toString()}`;
}

function toDurableRunCreateBody(input: ExecutionControlRunCreateInput): JsonRecord {
	return {
		conversation_id: input.conversationId,
		metadata: input.metadata,
		owner_user_id: input.ownerUserId,
		personal_memory_recall_allowed: input.personalMemoryRecallAllowed,
		request_id: input.requestId,
		runtime_versions: input.runtimeVersions ?? {},
		surface: input.surface,
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
		ownerUserId: readRequiredString(payload, "owner_user_id"),
		queuedAt: readRequiredString(payload, "queued_at"),
		requestId: readRequiredString(payload, "request_id"),
		startedAt: readRequiredString(payload, "started_at"),
		status: readRequiredString(payload, "status"),
		streamingStartedAt: readRequiredString(payload, "streaming_started_at"),
		surface: readRequiredString(payload, "surface"),
		taskQueue: readRequiredString(payload, "task_queue"),
		terminalReason: readRequiredString(payload, "terminal_reason"),
		updatedAt: readRequiredString(payload, "updated_at"),
	};
}

function parseOwnerDeletion(payload: JsonRecord): ExecutionControlOwnerDeletion {
	const state = readRequiredString(payload, "state");
	const activeRunCount = payload.active_run_count;
	if (
		(state !== "draining" && state !== "deleted") ||
		typeof activeRunCount !== "number" ||
		!Number.isInteger(activeRunCount) ||
		activeRunCount < 0
	) {
		throw new ExecutionControlTransportError({
			code: "execution_control_invalid_response",
			message: "Execution control returned an invalid owner deletion response.",
			retryable: true,
			status: 502,
		});
	}
	return {
		activeRunCount,
		ownerUserId: readRequiredString(payload, "owner_user_id"),
		state,
	};
}

function parseDurableRunEvents(payload: JsonRecord): ExecutionControlRunEventPage {
	const events = payload.events;
	if (!Array.isArray(events)) {
		throw invalidDurableResponse("events must be an array.");
	}
	const nextSequence = readRequiredNumber(payload, "next_sequence");
	if (!Number.isInteger(nextSequence) || nextSequence < 0) {
		throw invalidDurableResponse("next_sequence must be a non-negative integer.");
	}
	return {
		events: events.map((event, index) => {
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
				requestId: readRequiredString(record, "request_id"),
				sequence: readRequiredNumber(record, "sequence"),
				visibility: readRequiredString(record, "visibility"),
			};
		}),
		nextSequence,
	};
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
