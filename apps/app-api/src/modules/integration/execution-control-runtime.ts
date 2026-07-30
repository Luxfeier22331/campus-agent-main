import {
	type Env,
	EXECUTION_CONTROL_TIMEOUT_MS,
	PROFILE_MEMORY_COMMAND_TIMEOUT_MS,
} from "../../config";
import { DEFAULT_PERSONAL_MEMORY_TENANT_ID } from "../personalization/tenant";
import type { TracePropagationHeaders } from "../telemetry/trace";
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
	runId: string;
	runtimeVersions?: JsonRecord | null;
	surface: string;
	traceHeaders?: TracePropagationHeaders;
	traceId?: string | null;
	turnId: string;
}

export interface ExecutionControlRunQuery {
	runId: string;
	signal?: AbortSignal;
	traceHeaders?: TracePropagationHeaders;
	traceId?: string | null;
}

export interface ExecutionControlRunEventQuery {
	afterSequence?: number;
	runId: string;
	signal?: AbortSignal;
	traceHeaders?: TracePropagationHeaders;
	traceId?: string | null;
	waitMs?: number;
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
	ownerUserId: string;
	queuedAt: string;
	requestId: string;
	runId: string;
	startedAt: string;
	status: string;
	streamingStartedAt: string;
	surface: string;
	taskQueue: string;
	terminalReason: string;
	traceId: string;
	turnId: string;
	updatedAt: string;
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

export interface ExecutionControlRunEventPage {
	events: ExecutionControlRunEvent[];
	nextSequence: number;
}

export interface ExecutionControlRunStep {
	tool: string;
	completedAt: string;
	conversationId: string;
	parentStepId: string;
	payloadSchemaVersion: string;
	runId: string;
	sanitizedPayload: JsonRecord;
	startedAt: string;
	status: string;
	stepId: string;
	stepKind: string;
	taskQueue: string;
	updatedAt: string;
	workerId: string;
}

export interface ExecutionControlStepAttempt {
	activityAttempt: number;
	activityId: string;
	activityType: string;
	attempt: number;
	attemptId: string;
	cachedInputTokens: number;
	cancelOutcome: string;
	completedAt: string;
	durationMs: number;
	failCloseReason: string;
	inputTokens: number;
	lateCompletionOutcome: string;
	modelName: string;
	modelProvider: string;
	outputTokens: number;
	payloadSchemaVersion: string;
	providerRequestRef: string;
	providerResponseId: string;
	runId: string;
	sanitizedPayload: JsonRecord;
	scheduleToStartMs: number;
	scheduledAt: string;
	startedAt: string;
	status: string;
	stepId: string;
	taskQueue: string;
	temporalRunId: string;
	terminalReason: string;
	timeoutOutcome: string;
	updatedAt: string;
	workerId: string;
	workflowId: string;
}

export interface ExecutionControlStepResult {
	attemptId: string;
	createdAt: string;
	payloadSchemaVersion: string;
	projectionRef: string;
	resultId: string;
	resultKind: string;
	runId: string;
	sanitizedPayload: JsonRecord;
	status: string;
	stepId: string;
}

export interface ExecutionControlRunStepTrajectory {
	agentRuntimeEvalProjection?: JsonRecord | null;
	attempts: ExecutionControlStepAttempt[];
	results: ExecutionControlStepResult[];
	steps: ExecutionControlRunStep[];
}

export interface ExecutionControlRuntimeClient {
	cancelRun(input: ExecutionControlRunCancelInput): Promise<ExecutionControlRun>;
	createRun(input: ExecutionControlRunCreateInput): Promise<ExecutionControlRun>;
	getRun(input: ExecutionControlRunQuery): Promise<ExecutionControlRun>;
	listRunEvents(input: ExecutionControlRunEventQuery): Promise<ExecutionControlRunEventPage>;
	listRunSteps(input: ExecutionControlRunQuery): Promise<ExecutionControlRunStepTrajectory>;
}

export interface ExecutionControlPersonalMemoryClient {
	admit(
		input: import("../profile-memory").ProfileMemoryCommandPayload,
	): Promise<{ workflowId: string }>;
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
): ExecutionControlRuntimeClient {
	const fetchImplementation = input.fetchImplementation ?? defaultRuntimeFetch;
	const requestExecutionControl = createExecutionControlRequester(env, {
		fetchImplementation,
	});

	return {
		async cancelRun(cancelInput: ExecutionControlRunCancelInput): Promise<ExecutionControlRun> {
			const parsed = await requestExecutionControl(
				`/internal/execution/runs/${cancelInput.runId}/cancel`,
				{
					body: {
						reason: cancelInput.reason,
					},
					expectedStatus: 202,
					method: "POST",
					traceHeaders: cancelInput.traceHeaders,
					traceId: cancelInput.traceId,
				},
			);
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
				signal: query.signal,
				traceHeaders: query.traceHeaders,
				traceId: query.traceId,
			});
			return parseDurableRun(parsed);
		},
		async listRunEvents(
			query: ExecutionControlRunEventQuery,
		): Promise<ExecutionControlRunEventPage> {
			const parsed = await requestExecutionControl(durableRunEventsPath(query), {
				expectedStatus: 200,
				method: "GET",
				signal: query.signal,
				timeoutMs:
					query.waitMs === undefined
						? undefined
						: Math.max(EXECUTION_CONTROL_TIMEOUT_MS, query.waitMs + 5_000),
				traceHeaders: query.traceHeaders,
				traceId: query.traceId,
			});
			return parseDurableRunEvents(parsed);
		},
		async listRunSteps(
			query: ExecutionControlRunQuery,
		): Promise<ExecutionControlRunStepTrajectory> {
			const parsed = await requestExecutionControl(
				`/internal/execution/runs/${query.runId}/steps`,
				{
					expectedStatus: 200,
					method: "GET",
					traceHeaders: query.traceHeaders,
					traceId: query.traceId,
				},
			);
			return parseRunStepTrajectory(parsed);
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
			const parsed = await requestExecutionControl("/internal/memory/personal/commands", {
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
			return { workflowId: readRequiredString(parsed, "workflow_id") };
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
		traceHeaders?: TracePropagationHeaders;
		traceId?: string | null;
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
			traceHeaders?: TracePropagationHeaders;
			traceId?: string | null;
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
						body: options.body ? JSON.stringify(options.body) : undefined,
						headers: createExecutionControlRequestHeaders({
							payload: {
								traceHeaders: options.traceHeaders,
								traceId: options.traceId?.trim() || "",
							},
							sharedSecret,
						}),
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
				message:
					error instanceof Error ? error.message : "Execution control runtime request failed.",
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
	const path = `/internal/execution/runs/${query.runId}/events`;
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
		run_id: input.runId,
		runtime_versions: input.runtimeVersions ?? {},
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
		ownerUserId: readRequiredString(payload, "owner_user_id"),
		queuedAt: readRequiredString(payload, "queued_at"),
		requestId: readRequiredString(payload, "request_id"),
		runId: readRequiredString(payload, "run_id"),
		startedAt: readRequiredString(payload, "started_at"),
		status: readRequiredString(payload, "status"),
		streamingStartedAt: readRequiredString(payload, "streaming_started_at"),
		surface: readRequiredString(payload, "surface"),
		taskQueue: readRequiredString(payload, "task_queue"),
		terminalReason: readRequiredString(payload, "terminal_reason"),
		traceId: readRequiredString(payload, "trace_id"),
		turnId: readRequiredString(payload, "turn_id"),
		updatedAt: readRequiredString(payload, "updated_at"),
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
				runId: readRequiredString(record, "run_id"),
				sequence: readRequiredNumber(record, "sequence"),
				visibility: readRequiredString(record, "visibility"),
			};
		}),
		nextSequence,
	};
}

function parseRunStepTrajectory(payload: JsonRecord): ExecutionControlRunStepTrajectory {
	const steps = readRequiredArray(payload, "steps");
	const attempts = readRequiredArray(payload, "attempts");
	const results = readRequiredArray(payload, "results");
	const agentRuntimeEvalProjection = readOptionalRecord(payload, "agent_runtime_eval_projection");
	return {
		agentRuntimeEvalProjection,
		attempts: attempts.map((attempt, index) => parseStepAttempt(attempt, index)),
		results: results.map((result, index) => parseStepResult(result, index)),
		steps: steps.map((step, index) => parseRunStep(step, index)),
	};
}

function parseRunStep(value: unknown, index: number): ExecutionControlRunStep {
	const record = readArrayRecord(value, `steps[${index}]`);
	return {
		tool: readRequiredString(record, "tool"),
		completedAt: readRequiredString(record, "completed_at"),
		conversationId: readRequiredString(record, "conversation_id"),
		parentStepId: readRequiredString(record, "parent_step_id"),
		payloadSchemaVersion: readRequiredString(record, "payload_schema_version"),
		runId: readRequiredString(record, "run_id"),
		sanitizedPayload: readRequiredRecord(record, "sanitized_payload"),
		startedAt: readRequiredString(record, "started_at"),
		status: readRequiredString(record, "status"),
		stepId: readRequiredString(record, "step_id"),
		stepKind: readRequiredString(record, "step_kind"),
		taskQueue: readRequiredString(record, "task_queue"),
		updatedAt: readRequiredString(record, "updated_at"),
		workerId: readRequiredString(record, "worker_id"),
	};
}

function parseStepAttempt(value: unknown, index: number): ExecutionControlStepAttempt {
	const record = readArrayRecord(value, `attempts[${index}]`);
	return {
		activityAttempt: readRequiredNumber(record, "activity_attempt"),
		activityId: readRequiredString(record, "activity_id"),
		activityType: readRequiredString(record, "activity_type"),
		attempt: readRequiredNumber(record, "attempt"),
		attemptId: readRequiredString(record, "attempt_id"),
		cachedInputTokens: readRequiredNumber(record, "cached_input_tokens"),
		cancelOutcome: readRequiredString(record, "cancel_outcome"),
		completedAt: readRequiredString(record, "completed_at"),
		durationMs: readRequiredNumber(record, "duration_ms"),
		failCloseReason: readRequiredString(record, "fail_close_reason"),
		inputTokens: readRequiredNumber(record, "input_tokens"),
		lateCompletionOutcome: readRequiredString(record, "late_completion_outcome"),
		modelName: readRequiredString(record, "model_name"),
		modelProvider: readRequiredString(record, "model_provider"),
		outputTokens: readRequiredNumber(record, "output_tokens"),
		payloadSchemaVersion: readRequiredString(record, "payload_schema_version"),
		providerRequestRef: readRequiredString(record, "provider_request_ref"),
		providerResponseId: readRequiredString(record, "provider_response_id"),
		runId: readRequiredString(record, "run_id"),
		sanitizedPayload: readRequiredRecord(record, "sanitized_payload"),
		scheduleToStartMs: readRequiredNumber(record, "schedule_to_start_ms"),
		scheduledAt: readRequiredString(record, "scheduled_at"),
		startedAt: readRequiredString(record, "started_at"),
		status: readRequiredString(record, "status"),
		stepId: readRequiredString(record, "step_id"),
		taskQueue: readRequiredString(record, "task_queue"),
		temporalRunId: readRequiredString(record, "temporal_run_id"),
		terminalReason: readRequiredString(record, "terminal_reason"),
		timeoutOutcome: readRequiredString(record, "timeout_outcome"),
		updatedAt: readRequiredString(record, "updated_at"),
		workerId: readRequiredString(record, "worker_id"),
		workflowId: readRequiredString(record, "workflow_id"),
	};
}

function parseStepResult(value: unknown, index: number): ExecutionControlStepResult {
	const record = readArrayRecord(value, `results[${index}]`);
	return {
		attemptId: readRequiredString(record, "attempt_id"),
		createdAt: readRequiredString(record, "created_at"),
		payloadSchemaVersion: readRequiredString(record, "payload_schema_version"),
		projectionRef: readRequiredString(record, "projection_ref"),
		resultId: readRequiredString(record, "result_id"),
		resultKind: readRequiredString(record, "result_kind"),
		runId: readRequiredString(record, "run_id"),
		sanitizedPayload: readRequiredRecord(record, "sanitized_payload"),
		status: readRequiredString(record, "status"),
		stepId: readRequiredString(record, "step_id"),
	};
}

function readRequiredArray(payload: JsonRecord, key: string): unknown[] {
	const value = payload[key];
	if (!Array.isArray(value)) {
		throw invalidDurableResponse(`${key} must be an array.`);
	}
	return value;
}

function readArrayRecord(value: unknown, label: string): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw invalidDurableResponse(`${label} must be an object.`);
	}
	return value as JsonRecord;
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

function readOptionalRecord(payload: JsonRecord, key: string): JsonRecord | null {
	const value = payload[key];
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value !== "object" || Array.isArray(value)) {
		throw invalidDurableResponse(`${key} must be an object when present.`);
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
