import { DEFAULT_EXECUTION_CONTROL_TIMEOUT_MS, type Env, parsePositiveInteger } from "../../config";
import type { TracePropagationHeaders } from "../telemetry/trace";
import {
	createExecutionControlRequestHeaders,
	ExecutionControlTransportError,
	parseExecutionControlErrorEnvelope,
	parseExecutionControlJsonResponse,
} from "./execution-control-transport";

type ExecutionControlRuntimeEnv = Pick<
	Env,
	| "EXECUTION_CONTROL_ACCESS_CLIENT_ID"
	| "EXECUTION_CONTROL_ACCESS_CLIENT_SECRET"
	| "EXECUTION_CONTROL_BASE_URL"
	| "EXECUTION_CONTROL_SHARED_SECRET"
	| "EXECUTION_CONTROL_TIMEOUT_MS"
>;

export type JsonRecord = Record<string, unknown>;

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
	waitMs?: number;
}

export interface ExecutionControlRunCancelInput {
	reason: string;
	runId: string;
	traceHeaders?: TracePropagationHeaders;
	traceId?: string | null;
}

export interface ExecutionControlPersonalMemoryUpsertInput {
	compactText: string;
	memoryId: string;
	tenantId?: string | null;
	traceHeaders?: TracePropagationHeaders;
	traceId?: string | null;
	updatedAt: string;
	userId: string;
}

export interface ExecutionControlPersonalMemoryDisableInput {
	memoryId: string;
	tenantId?: string | null;
	traceHeaders?: TracePropagationHeaders;
	traceId?: string | null;
	updatedAt: string;
	userId: string;
}

export interface ExecutionControlPersonalMemoryDisableOwnerInput {
	tenantId?: string | null;
	traceHeaders?: TracePropagationHeaders;
	traceId?: string | null;
	updatedAt: string;
	userId: string;
}

export interface ExecutionControlPersonalMemoryResult {
	memoryId: string;
	pointId: string;
	schemaVersion: string;
	status: string;
	updatedAt: string;
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

export interface ExecutionControlRunStep {
	capability: string;
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
	estimatedCostMicrousd: number;
	failCloseReason: string;
	inputTokens: number;
	lateCompletionOutcome: string;
	modelName: string;
	modelProvider: string;
	outputTokens: number;
	payloadSchemaVersion: string;
	pricingVersion: string;
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
	replanReason: string;
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
	attempts: ExecutionControlStepAttempt[];
	results: ExecutionControlStepResult[];
	steps: ExecutionControlRunStep[];
}

export interface ExecutionControlRuntimeClient {
	cancelRun(input: ExecutionControlRunCancelInput): Promise<ExecutionControlRun>;
	createRun(input: ExecutionControlRunCreateInput): Promise<ExecutionControlRun>;
	getRun(input: ExecutionControlRunQuery): Promise<ExecutionControlRun>;
	listRunEvents(input: ExecutionControlRunEventQuery): Promise<ExecutionControlRunEvent[]>;
	listRunSteps(input: ExecutionControlRunQuery): Promise<ExecutionControlRunStepTrajectory>;
}

export interface ExecutionControlPersonalMemoryClient {
	disableOwnerMemory(
		input: ExecutionControlPersonalMemoryDisableOwnerInput,
	): Promise<{ status: string; updatedAt: string; userId: string }>;
	disableExplicitMemory(
		input: ExecutionControlPersonalMemoryDisableInput,
	): Promise<ExecutionControlPersonalMemoryResult>;
	upsertExplicitMemory(
		input: ExecutionControlPersonalMemoryUpsertInput,
	): Promise<ExecutionControlPersonalMemoryResult>;
}

export function isExecutionControlRuntimeConfigured(env: ExecutionControlRuntimeEnv): boolean {
	return Boolean(
		env.EXECUTION_CONTROL_BASE_URL?.trim() && env.EXECUTION_CONTROL_SHARED_SECRET?.trim(),
	);
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
	const requestExecutionControl = createExecutionControlRequester(env, {
		fetchImplementation,
		traceDataProvider,
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
				traceHeaders: query.traceHeaders,
				traceId: query.traceId,
			});
			return parseDurableRun(parsed);
		},
		async listRunEvents(query: ExecutionControlRunEventQuery): Promise<ExecutionControlRunEvent[]> {
			const parsed = await requestExecutionControl(durableRunEventsPath(query), {
				expectedStatus: 200,
				method: "GET",
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
		traceDataProvider?: () => Record<string, unknown>;
	} = {},
): ExecutionControlPersonalMemoryClient {
	const requestExecutionControl = createExecutionControlRequester(env, {
		fetchImplementation: input.fetchImplementation ?? fetch,
		traceDataProvider: input.traceDataProvider ?? (() => ({})),
	});

	return {
		async disableOwnerMemory(
			memoryInput: ExecutionControlPersonalMemoryDisableOwnerInput,
		): Promise<{ status: string; updatedAt: string; userId: string }> {
			const parsed = await requestExecutionControl("/internal/memory/personal/owner:disable", {
				body: {
					tenant_id: memoryInput.tenantId ?? "",
					updated_at: memoryInput.updatedAt,
					user_id: memoryInput.userId,
				},
				expectedStatus: 202,
				method: "POST",
				traceHeaders: memoryInput.traceHeaders,
				traceId: memoryInput.traceId,
			});
			return parsePersonalMemoryOwnerDisableResult(parsed);
		},
		async disableExplicitMemory(
			memoryInput: ExecutionControlPersonalMemoryDisableInput,
		): Promise<ExecutionControlPersonalMemoryResult> {
			const parsed = await requestExecutionControl("/internal/memory/personal/items:disable", {
				body: {
					memory_id: memoryInput.memoryId,
					tenant_id: memoryInput.tenantId ?? "",
					updated_at: memoryInput.updatedAt,
					user_id: memoryInput.userId,
				},
				expectedStatus: 202,
				method: "POST",
				traceHeaders: memoryInput.traceHeaders,
				traceId: memoryInput.traceId,
			});
			return parsePersonalMemoryResult(parsed);
		},
		async upsertExplicitMemory(
			memoryInput: ExecutionControlPersonalMemoryUpsertInput,
		): Promise<ExecutionControlPersonalMemoryResult> {
			const parsed = await requestExecutionControl("/internal/memory/personal/items:upsert", {
				body: {
					capability: "any",
					compact_text: memoryInput.compactText,
					memory_id: memoryInput.memoryId,
					memory_type: "profile",
					source: "explicit",
					status: "active",
					tenant_id: memoryInput.tenantId ?? "",
					updated_at: memoryInput.updatedAt,
					user_id: memoryInput.userId,
				},
				expectedStatus: 202,
				method: "POST",
				traceHeaders: memoryInput.traceHeaders,
				traceId: memoryInput.traceId,
			});
			return parsePersonalMemoryResult(parsed);
		},
	};
}

function parsePersonalMemoryOwnerDisableResult(value: JsonRecord): {
	status: string;
	updatedAt: string;
	userId: string;
} {
	return {
		status: readRequiredString(value, "status"),
		updatedAt: readRequiredString(value, "updated_at"),
		userId: readRequiredString(value, "user_id"),
	};
}

export function createExecutionControlRequester(
	env: ExecutionControlRuntimeEnv,
	input: {
		fetchImplementation: typeof fetch;
		traceDataProvider: () => Record<string, unknown>;
	},
): (
	path: string,
	options: {
		body?: JsonRecord;
		expectedStatus: number;
		method: "GET" | "POST";
		traceHeaders?: TracePropagationHeaders;
		traceId?: string | null;
	},
) => Promise<JsonRecord> {
	return async function requestExecutionControl(
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

				input
					.fetchImplementation(`${baseUrl}${path}`, {
						body: options.body ? JSON.stringify(options.body) : undefined,
						headers: createExecutionControlRequestHeaders({
							env,
							payload: {
								traceHeaders: options.traceHeaders,
								traceId: options.traceId?.trim() || "",
							},
							sharedSecret,
							traceDataProvider: input.traceDataProvider,
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

function parseRunStepTrajectory(payload: JsonRecord): ExecutionControlRunStepTrajectory {
	const steps = readRequiredArray(payload, "steps");
	const attempts = readRequiredArray(payload, "attempts");
	const results = readRequiredArray(payload, "results");
	return {
		attempts: attempts.map((attempt, index) => parseStepAttempt(attempt, index)),
		results: results.map((result, index) => parseStepResult(result, index)),
		steps: steps.map((step, index) => parseRunStep(step, index)),
	};
}

function parsePersonalMemoryResult(payload: JsonRecord): ExecutionControlPersonalMemoryResult {
	return {
		memoryId: readRequiredString(payload, "memory_id"),
		pointId: readRequiredString(payload, "point_id"),
		schemaVersion: readRequiredString(payload, "schema_version"),
		status: readRequiredString(payload, "status"),
		updatedAt: readRequiredString(payload, "updated_at"),
	};
}

function parseRunStep(value: unknown, index: number): ExecutionControlRunStep {
	const record = readArrayRecord(value, `steps[${index}]`);
	return {
		capability: readRequiredString(record, "capability"),
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
		estimatedCostMicrousd: readRequiredNumber(record, "estimated_cost_microusd"),
		failCloseReason: readRequiredString(record, "fail_close_reason"),
		inputTokens: readRequiredNumber(record, "input_tokens"),
		lateCompletionOutcome: readRequiredString(record, "late_completion_outcome"),
		modelName: readRequiredString(record, "model_name"),
		modelProvider: readRequiredString(record, "model_provider"),
		outputTokens: readRequiredNumber(record, "output_tokens"),
		payloadSchemaVersion: readRequiredString(record, "payload_schema_version"),
		pricingVersion: readRequiredString(record, "pricing_version"),
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
		replanReason: readRequiredString(record, "replan_reason"),
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

function invalidDurableResponse(detail: string): ExecutionControlTransportError {
	return new ExecutionControlTransportError({
		code: "execution_control_invalid_response",
		message: `Execution control runtime response violates the contract: ${detail}`,
		retryable: true,
		status: 502,
	});
}
