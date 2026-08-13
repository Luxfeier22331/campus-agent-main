import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import { turnDispatches } from "../../db/schema";
import { AppApiRouteError } from "../../http";
import type { ResolvedAppPrincipal } from "../auth";
import {
	type ExecutionControlRun,
	type ExecutionControlRunEvent,
	type ExecutionControlRunStepTrajectory,
	type ExecutionControlRuntimeClient,
	ExecutionControlTransportError,
} from "../integration";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export interface RuntimeRunOwnershipRecord {
	admissionStatus: string;
	cancelOutboxStatus: string;
	cancelReason: string | null;
	cancelRequestedAt: string | null;
	completedAt: string | null;
	conversationId: string;
	requestId: string;
	runId: string;
	status: string;
	traceId: string;
}

export interface RuntimeRunCancellationRecord extends RuntimeRunOwnershipRecord {
	requestedAt: string;
}

export type RuntimeRunCancellationDecision =
	| { kind: "local_finalization"; run: RuntimeRunCancellationRecord }
	| { kind: "remote_delivery"; run: RuntimeRunCancellationRecord }
	| { kind: "remote_delivered"; run: RuntimeRunCancellationRecord }
	| { kind: "terminal"; run: RuntimeRunCancellationRecord };

export interface RuntimeRunStore {
	getOwnedRun(input: {
		ownerUserId: string;
		runId: string;
	}): Promise<RuntimeRunOwnershipRecord | null>;
	listPendingCancellations(input?: { limit?: number }): Promise<
		Array<{
			kind: "local_finalization" | "remote_delivery";
			run: RuntimeRunCancellationRecord;
		}>
	>;
	markCancellationDelivered(input: { deliveredAt: string; runId: string }): Promise<boolean>;
	recordCancellationFailure(input: {
		errorCode: string;
		failedAt: string;
		runId: string;
	}): Promise<boolean>;
	requestCancellation(input: {
		ownerUserId: string;
		reason: string;
		requestedAt: string;
		runId: string;
	}): Promise<RuntimeRunCancellationDecision | null>;
}

export interface RuntimeRunSummary {
	conversationId: string;
	phase: RuntimeRunPhase;
	requestId: string;
	runId: string;
	status: string;
	terminalReason?: string;
	traceId: string;
}

export type RuntimeRunPhase =
	| "created"
	| "queued"
	| "admitted"
	| "running"
	| "streaming"
	| "completed"
	| "failed"
	| "canceled"
	| "expired";

export function runtimeRunPhaseFromExecutionStatus(status: string): RuntimeRunPhase {
	switch (status) {
		case "created":
			return "created";
		case "queued":
			return "queued";
		case "admitted":
			return "admitted";
		case "running":
			return "running";
		case "streaming":
			return "streaming";
		case "completed":
			return "completed";
		case "failed":
			return "failed";
		case "canceled":
			return "canceled";
		case "expired":
			return "expired";
		default:
			throw new ExecutionControlTransportError({
				code: "execution_control_invalid_response",
				message: "Execution durable run status is not supported.",
				retryable: true,
				status: 502,
			});
	}
}

export interface RuntimeRunEventProjection {
	eventId: string;
	eventType: string;
	occurredAt: string;
	payload: Record<string, unknown>;
	runId: string;
	sequence: number;
	visibility: string;
}

export interface RuntimeRunStepTrajectory extends ExecutionControlRunStepTrajectory {
	run: RuntimeRunSummary;
}

export interface RuntimeRunEventSubscriptionPolicy {
	maxAttempts: number;
	waitMs?: number;
}

export interface RuntimeRunService {
	cancel(input: {
		principal: ResolvedAppPrincipal;
		reason: string;
		runId: string;
	}): Promise<{ run: RuntimeRunSummary }>;
	dispatchPendingCancellations?(input?: { limit?: number }): Promise<{
		delivered: number;
		failed: number;
		finalized: number;
		processed: number;
	}>;
	getStatus(input: {
		principal: ResolvedAppPrincipal;
		runId: string;
	}): Promise<{ run: RuntimeRunSummary }>;
	listEvents(input: {
		afterSequence?: number;
		principal: ResolvedAppPrincipal;
		runId: string;
		signal?: AbortSignal;
	}): Promise<{
		events: RuntimeRunEventProjection[];
		nextSequence: number;
		run: RuntimeRunSummary;
	}>;
	listSteps(input: {
		principal: ResolvedAppPrincipal;
		runId: string;
	}): Promise<RuntimeRunStepTrajectory>;
	subscribeEvents(input: {
		afterSequence?: number;
		polling?: RuntimeRunEventSubscriptionPolicy;
		principal: ResolvedAppPrincipal;
		runId: string;
		signal?: AbortSignal;
	}): AsyncIterable<RuntimeRunEventProjection>;
}

const DEFAULT_RUN_EVENT_SUBSCRIPTION_POLICY = {
	maxAttempts: 180,
	waitMs: 25_000,
} as const;

const STUDENT_FORBIDDEN_MEMORY_REF_KEYS = new Set([
	"bank_id",
	"bankId",
	"operation_id",
	"operationId",
	"operation_ref",
	"operationRef",
	"operation_status_ref",
	"operationStatusRef",
	"result_metadata_shape",
	"resultMetadataShape",
	"runtime_document_ref",
	"runtimeDocumentRef",
]);

const STUDENT_FORBIDDEN_MEMORY_REF_TOKENS = [
	"hindsight_bank_",
	"memory/documents",
	"memory/operations",
] as const;

function isHindsightMemoryDocumentID(value: string): boolean {
	return /^conversation:[a-f0-9]{32}$/i.test(value) || /^profile:[A-Za-z0-9_-]{3,128}$/.test(value);
}

function sanitizeStudentRunStepTrajectory(
	trajectory: ExecutionControlRunStepTrajectory,
): ExecutionControlRunStepTrajectory {
	return sanitizeStudentRuntimeValue(trajectory) as ExecutionControlRunStepTrajectory;
}

function getStringPayloadField(payload: Record<string, unknown>, key: string): string | undefined {
	const value = payload[key];
	return typeof value === "string" ? value : undefined;
}

function getNumberPayloadField(payload: Record<string, unknown>, key: string): number | undefined {
	const value = payload[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getBooleanPayloadField(
	payload: Record<string, unknown>,
	key: string,
): boolean | undefined {
	const value = payload[key];
	return typeof value === "boolean" ? value : undefined;
}

function getRecordPayloadField(
	payload: Record<string, unknown>,
	key: string,
): Record<string, unknown> | undefined {
	const value = payload[key];
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function pickStringPayloadFields(
	payload: Record<string, unknown>,
	keys: string[],
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const key of keys) {
		const value = getStringPayloadField(payload, key);
		if (value !== undefined) {
			result[key] = value;
		}
	}
	return result;
}

function sanitizeBrowserRunEventPayload(event: ExecutionControlRunEvent): Record<string, unknown> {
	const payload = event.payload;
	switch (event.eventType) {
		case "execution.queued":
		case "execution.running":
		case "run.queued":
		case "run.started":
		case "run.running":
			return pickStringPayloadFields(payload, ["request_id", "status", "trace_id"]);
		case "run.answer_started":
			return pickStringPayloadFields(payload, ["message_id", "request_id", "status", "trace_id"]);
		case "run.answer_delta": {
			const result = pickStringPayloadFields(payload, [
				"delta",
				"message_id",
				"request_id",
				"trace_id",
			]);
			const chunkIndex = getNumberPayloadField(payload, "chunk_index");
			if (chunkIndex !== undefined) {
				result.chunk_index = chunkIndex;
			}
			return result;
		}
		case "run.answer_completed":
			return pickStringPayloadFields(payload, [
				"accumulated_text",
				"message_id",
				"request_id",
				"trace_id",
			]);
		case "finalization.completed":
			return pickStringPayloadFields(payload, ["request_id", "trace_id"]);
		case "run.completed":
			return pickStringPayloadFields(payload, [
				"request_id",
				"status",
				"terminal_reason",
				"trace_id",
			]);
		case "run.canceled":
			return pickStringPayloadFields(payload, [
				"request_id",
				"status",
				"terminal_reason",
				"trace_id",
			]);
		case "run.failed":
		case "run.expired": {
			const result = pickStringPayloadFields(payload, [
				"failure_kind",
				"request_id",
				"status",
				"terminal_reason",
				"trace_id",
			]);
			const error = getRecordPayloadField(payload, "error");
			if (error) {
				const errorProjection = pickStringPayloadFields(error, ["code", "message"]);
				const retryable = getBooleanPayloadField(error, "retryable");
				if (retryable !== undefined) {
					errorProjection.retryable = retryable;
				}
				result.error = errorProjection;
			}
			return result;
		}
		default:
			return {};
	}
}

function sanitizeStudentRuntimeValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value
			.map((item) => sanitizeStudentRuntimeValue(item))
			.filter((item) => item !== undefined);
	}
	if (value && typeof value === "object") {
		const sanitized: Record<string, unknown> = {};
		for (const [key, nested] of Object.entries(value)) {
			if (STUDENT_FORBIDDEN_MEMORY_REF_KEYS.has(key)) {
				continue;
			}
			const nextValue = sanitizeStudentRuntimeValue(nested);
			if (nextValue !== undefined) {
				sanitized[key] = nextValue;
			}
		}
		return sanitized;
	}
	if (
		typeof value === "string" &&
		(STUDENT_FORBIDDEN_MEMORY_REF_TOKENS.some((token) => value.includes(token)) ||
			isHindsightMemoryDocumentID(value))
	) {
		return;
	}
	return value;
}

function toRuntimeRunOwnershipRecord(
	row: typeof turnDispatches.$inferSelect | undefined,
): RuntimeRunOwnershipRecord | null {
	if (!(row?.runId && row.conversationId && row.requestId && row.traceId)) {
		return null;
	}
	return {
		admissionStatus: row.admissionStatus,
		cancelOutboxStatus: row.cancelOutboxStatus,
		cancelReason: row.cancelReason,
		cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null,
		completedAt: row.completedAt?.toISOString() ?? null,
		conversationId: row.conversationId,
		requestId: row.requestId,
		runId: row.runId,
		status: row.status,
		traceId: row.traceId,
	};
}

function toCancellationRecord(record: RuntimeRunOwnershipRecord): RuntimeRunCancellationRecord {
	if (!record.cancelRequestedAt) {
		throw new Error(`Run ${record.runId} has cancellation state without requested_at.`);
	}
	return { ...record, requestedAt: record.cancelRequestedAt };
}

export function createPgRuntimeRunStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): RuntimeRunStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);

	return {
		async getOwnedRun(query) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(turnDispatches)
				.where(
					and(
						eq(turnDispatches.actorUserId, query.ownerUserId),
						eq(turnDispatches.runId, query.runId),
					),
				)
				.limit(1);
			return toRuntimeRunOwnershipRecord(rows[0]);
		},

		async listPendingCancellations(input = {}) {
			const db = await getDb();
			const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
			const rows = await db
				.select()
				.from(turnDispatches)
				.where(
					inArray(turnDispatches.cancelOutboxStatus, [
						"local_finalization_pending",
						"pending_delivery",
					]),
				)
				.orderBy(asc(turnDispatches.updatedAt))
				.limit(limit);
			return rows.flatMap((row) => {
				const record = toRuntimeRunOwnershipRecord(row);
				if (!record?.cancelRequestedAt) {
					return [];
				}
				return [
					{
						kind:
							row.cancelOutboxStatus === "local_finalization_pending"
								? ("local_finalization" as const)
								: ("remote_delivery" as const),
						run: toCancellationRecord(record),
					},
				];
			});
		},

		async markCancellationDelivered(input) {
			const db = await getDb();
			const deliveredAt = new Date(input.deliveredAt);
			const rows = await db
				.update(turnDispatches)
				.set({
					cancelAttemptCount: sql<number>`${turnDispatches.cancelAttemptCount} + 1`,
					cancelDeliveredAt: deliveredAt,
					cancelLastAttemptAt: deliveredAt,
					cancelLastErrorCode: null,
					cancelOutboxStatus: "delivered",
					updatedAt: deliveredAt,
				})
				.where(
					and(
						eq(turnDispatches.runId, input.runId),
						eq(turnDispatches.cancelOutboxStatus, "pending_delivery"),
					),
				)
				.returning({ runId: turnDispatches.runId });
			return rows.length === 1;
		},

		async recordCancellationFailure(input) {
			const db = await getDb();
			const failedAt = new Date(input.failedAt);
			const rows = await db
				.update(turnDispatches)
				.set({
					cancelAttemptCount: sql<number>`${turnDispatches.cancelAttemptCount} + 1`,
					cancelLastAttemptAt: failedAt,
					cancelLastErrorCode: input.errorCode.slice(0, 64),
					updatedAt: failedAt,
				})
				.where(
					and(
						eq(turnDispatches.runId, input.runId),
						eq(turnDispatches.cancelOutboxStatus, "pending_delivery"),
					),
				)
				.returning({ runId: turnDispatches.runId });
			return rows.length === 1;
		},

		async requestCancellation(input) {
			const db = await getDb();
			return db.transaction(async (tx) => {
				const rows = await tx
					.select()
					.from(turnDispatches)
					.where(
						and(
							eq(turnDispatches.actorUserId, input.ownerUserId),
							eq(turnDispatches.runId, input.runId),
						),
					)
					.limit(1)
					.for("update");
				const current = toRuntimeRunOwnershipRecord(rows[0]);
				if (!current) {
					return null;
				}
				if (current.status !== "accepted" || current.cancelOutboxStatus === "closed") {
					return {
						kind: "terminal" as const,
						run: toCancellationRecord({
							...current,
							cancelRequestedAt: current.cancelRequestedAt ?? input.requestedAt,
						}),
					};
				}
				if (current.cancelOutboxStatus !== "not_requested") {
					const kind =
						current.cancelOutboxStatus === "local_finalization_pending"
							? ("local_finalization" as const)
							: current.cancelOutboxStatus === "delivered"
								? ("remote_delivered" as const)
								: ("remote_delivery" as const);
					return { kind, run: toCancellationRecord(current) };
				}

				const requestedAt = new Date(input.requestedAt);
				const local = current.admissionStatus === "pending_admission";
				const updatedRows = await tx
					.update(turnDispatches)
					.set({
						...(local
							? {
									admissionInputJson: null,
									admissionInputSha256: null,
									admissionStatus: "cancelled",
								}
							: {}),
						cancelOutboxStatus: local ? "local_finalization_pending" : "pending_delivery",
						cancelReason: input.reason,
						cancelRequestedAt: requestedAt,
						updatedAt: requestedAt,
					})
					.where(eq(turnDispatches.requestId, current.requestId))
					.returning();
				const updated = toRuntimeRunOwnershipRecord(updatedRows[0]);
				if (!updated) {
					throw new Error(`Run ${current.runId} disappeared while recording cancellation.`);
				}
				return {
					kind: local ? ("local_finalization" as const) : ("remote_delivery" as const),
					run: toCancellationRecord(updated),
				};
			});
		},
	};
}

export function buildRuntimeRunService(input: {
	executionRuntime: ExecutionControlRuntimeClient;
	finalizeLocalCancellation?: (input: { completedAt: string; runId: string }) => Promise<void>;
	now?: () => Date;
	store: RuntimeRunStore;
}): RuntimeRunService {
	const now = input.now ?? (() => new Date());
	function validateSubscriptionPolicy(
		policy?: RuntimeRunEventSubscriptionPolicy,
	): Required<RuntimeRunEventSubscriptionPolicy> {
		const maxAttempts = policy?.maxAttempts ?? DEFAULT_RUN_EVENT_SUBSCRIPTION_POLICY.maxAttempts;
		const waitMs = policy?.waitMs ?? DEFAULT_RUN_EVENT_SUBSCRIPTION_POLICY.waitMs;
		if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
			throw new AppApiRouteError({
				code: "invalid_request",
				message: "run event subscription maxAttempts must be a positive integer.",
				retryable: false,
				status: 400,
			});
		}
		if (!Number.isInteger(waitMs) || waitMs < 0) {
			throw new AppApiRouteError({
				code: "invalid_request",
				message: "run event subscription waitMs must be a non-negative integer.",
				retryable: false,
				status: 400,
			});
		}
		return {
			maxAttempts,
			waitMs,
		};
	}

	async function requireOwnedRun(
		principal: ResolvedAppPrincipal,
		runId: string,
	): Promise<RuntimeRunOwnershipRecord> {
		if (!principal.permissions.chat) {
			throw new AppApiRouteError({
				code: "forbidden",
				message: "Chat access is not available for this principal.",
				retryable: false,
				status: 403,
			});
		}
		const normalizedRunId = runId.trim();
		if (!normalizedRunId) {
			throw new AppApiRouteError({
				code: "invalid_request",
				message: "run_id is required.",
				retryable: false,
				status: 400,
			});
		}

		const owned = await input.store.getOwnedRun({
			ownerUserId: principal.actor.userId,
			runId: normalizedRunId,
		});
		if (!owned) {
			throw new AppApiRouteError({
				code: "run_not_found",
				message: "Run not found.",
				retryable: false,
				status: 404,
			});
		}
		return owned;
	}

	function assertRunMatchesOwnership(
		owned: RuntimeRunOwnershipRecord,
		run: ExecutionControlRun,
	): void {
		if (
			run.runId !== owned.runId ||
			run.requestId !== owned.requestId ||
			run.conversationId !== owned.conversationId ||
			run.traceId !== owned.traceId
		) {
			throw new ExecutionControlTransportError({
				code: "execution_control_invalid_response",
				message: "Execution durable run identity does not match app-api request ownership.",
				retryable: true,
				status: 502,
			});
		}
	}

	function toRunSummary(run: ExecutionControlRun): RuntimeRunSummary {
		return {
			conversationId: run.conversationId,
			phase: runtimeRunPhaseFromExecutionStatus(run.status),
			requestId: run.requestId,
			runId: run.runId,
			status: run.status,
			...(run.terminalReason ? { terminalReason: run.terminalReason } : {}),
			traceId: run.traceId,
		};
	}

	function toLocalRunSummary(
		run: RuntimeRunOwnershipRecord,
		override: { status?: string; terminalReason?: string } = {},
	): RuntimeRunSummary {
		let status = override.status;
		if (!status) {
			switch (run.status) {
				case "accepted":
					status = "pending_admission";
					break;
				case "completed":
				case "needs_clarification":
				case "no_answer":
				case "approval_required":
				case "rejected":
					status = "completed";
					break;
				case "error":
					status = "failed";
					break;
				case "cancelled":
					status = "canceled";
					break;
				default:
					throw new ExecutionControlTransportError({
						code: "runtime_invariant_failed",
						message: "Product run status is not supported.",
						retryable: false,
						status: 500,
					});
			}
		}
		const phase: RuntimeRunPhase =
			status === "canceled"
				? "canceled"
				: status === "completed"
					? "completed"
					: status === "failed"
						? "failed"
						: "queued";
		return {
			conversationId: run.conversationId,
			phase,
			requestId: run.requestId,
			runId: run.runId,
			status,
			...(override.terminalReason || run.cancelReason
				? { terminalReason: override.terminalReason ?? run.cancelReason ?? "" }
				: {}),
			traceId: run.traceId,
		};
	}

	async function finalizeLocalCancellation(
		run: RuntimeRunCancellationRecord,
	): Promise<RuntimeRunSummary> {
		if (!input.finalizeLocalCancellation) {
			throw new ExecutionControlTransportError({
				code: "dependency_not_ready",
				message: "Local run cancellation finalization is not configured.",
				retryable: true,
				status: 503,
			});
		}
		await input.finalizeLocalCancellation({
			completedAt: run.requestedAt,
			runId: run.runId,
		});
		return toLocalRunSummary(run, {
			status: "canceled",
			terminalReason: run.cancelReason ?? "user_requested",
		});
	}

	async function deliverRemoteCancellation(
		run: RuntimeRunCancellationRecord,
	): Promise<ExecutionControlRun> {
		try {
			const remote = await input.executionRuntime.cancelRun({
				reason: run.cancelReason ?? "user_requested",
				runId: run.runId,
				traceId: run.traceId,
			});
			assertRunMatchesOwnership(run, remote);
			await input.store.markCancellationDelivered({
				deliveredAt: now().toISOString(),
				runId: run.runId,
			});
			return remote;
		} catch (error) {
			await input.store.recordCancellationFailure({
				errorCode:
					error instanceof ExecutionControlTransportError
						? error.code
						: "execution_control_unavailable",
				failedAt: now().toISOString(),
				runId: run.runId,
			});
			throw error;
		}
	}

	function toBrowserRunEvent(event: ExecutionControlRunEvent): RuntimeRunEventProjection | null {
		if (event.visibility !== "browser" || event.eventType === "execution.queued") {
			return null;
		}
		return {
			eventId: event.eventId,
			eventType: event.eventType,
			occurredAt: event.occurredAt,
			payload: sanitizeBrowserRunEventPayload(event),
			runId: event.runId,
			sequence: event.sequence,
			visibility: event.visibility,
		};
	}

	function isTerminalRunEvent(event: RuntimeRunEventProjection): boolean {
		return (
			event.eventType === "finalization.completed" ||
			event.eventType === "run.completed" ||
			event.eventType === "run.failed" ||
			event.eventType === "run.canceled" ||
			event.eventType === "run.expired"
		);
	}

	function isTerminalRunPhase(phase: RuntimeRunPhase): boolean {
		return (
			phase === "completed" || phase === "failed" || phase === "canceled" || phase === "expired"
		);
	}

	function assertSequenceAdvances(
		lastSequence: number,
		event: Pick<RuntimeRunEventProjection, "sequence">,
	): number {
		if (!Number.isInteger(event.sequence) || event.sequence <= lastSequence) {
			throw new ExecutionControlTransportError({
				code: "execution_control_invalid_response",
				message: "Execution durable run events must advance the requested cursor.",
				retryable: true,
				status: 502,
			});
		}
		return event.sequence;
	}

	async function listEvents(eventsInput: {
		afterSequence?: number;
		principal: ResolvedAppPrincipal;
		runId: string;
		signal?: AbortSignal;
		waitMs?: number;
	}): Promise<{
		events: RuntimeRunEventProjection[];
		nextSequence: number;
		run: RuntimeRunSummary;
	}> {
		const owned = await requireOwnedRun(eventsInput.principal, eventsInput.runId);
		const run = await input.executionRuntime.getRun({
			runId: owned.runId,
			...(eventsInput.signal ? { signal: eventsInput.signal } : {}),
			traceId: owned.traceId,
		});
		assertRunMatchesOwnership(owned, run);
		const page = await input.executionRuntime.listRunEvents({
			...(eventsInput.afterSequence === undefined
				? {}
				: { afterSequence: eventsInput.afterSequence }),
			runId: owned.runId,
			...(eventsInput.signal ? { signal: eventsInput.signal } : {}),
			traceId: owned.traceId,
			...(eventsInput.waitMs === undefined ? {} : { waitMs: eventsInput.waitMs }),
		});
		let lastSequence = eventsInput.afterSequence ?? 0;
		const browserEvents: RuntimeRunEventProjection[] = [];
		for (const event of page.events) {
			if (event.runId !== owned.runId) {
				throw new ExecutionControlTransportError({
					code: "execution_control_invalid_response",
					message: "Execution durable run event identity does not match requested run.",
					retryable: true,
					status: 502,
				});
			}
			lastSequence = assertSequenceAdvances(lastSequence, event);
			const browserEvent = toBrowserRunEvent(event);
			if (browserEvent) {
				browserEvents.push(browserEvent);
			}
		}
		if (!Number.isInteger(page.nextSequence) || page.nextSequence < lastSequence) {
			throw new ExecutionControlTransportError({
				code: "execution_control_invalid_response",
				message: "Execution durable run event page returned a stale next_sequence.",
				retryable: true,
				status: 502,
			});
		}
		return {
			events: browserEvents,
			nextSequence: page.nextSequence,
			run: toRunSummary(run),
		};
	}

	return {
		async cancel(cancelInput) {
			await requireOwnedRun(cancelInput.principal, cancelInput.runId);
			const decision = await input.store.requestCancellation({
				ownerUserId: cancelInput.principal.actor.userId,
				reason: cancelInput.reason.trim(),
				requestedAt: now().toISOString(),
				runId: cancelInput.runId.trim(),
			});
			if (!decision) {
				throw new AppApiRouteError({
					code: "run_not_found",
					message: "Run not found.",
					retryable: false,
					status: 404,
				});
			}
			if (decision.kind === "local_finalization") {
				return { run: await finalizeLocalCancellation(decision.run) };
			}
			if (decision.kind === "terminal") {
				throw new AppApiRouteError({
					code: "run_already_terminal",
					message: "Run is already terminal.",
					retryable: false,
					status: 409,
				});
			}
			if (decision.kind === "remote_delivered") {
				const remote = await input.executionRuntime.getRun({
					runId: decision.run.runId,
					traceId: decision.run.traceId,
				});
				assertRunMatchesOwnership(decision.run, remote);
				return { run: toRunSummary(remote) };
			}
			return { run: toRunSummary(await deliverRemoteCancellation(decision.run)) };
		},
		async dispatchPendingCancellations(dispatchInput = {}) {
			const candidates = await input.store.listPendingCancellations({
				limit: dispatchInput.limit ?? 25,
			});
			let delivered = 0;
			let failed = 0;
			let finalized = 0;
			for (const candidate of candidates) {
				try {
					if (candidate.kind === "local_finalization") {
						await finalizeLocalCancellation(candidate.run);
						finalized += 1;
					} else {
						await deliverRemoteCancellation(candidate.run);
						delivered += 1;
					}
				} catch {
					failed += 1;
				}
			}
			return { delivered, failed, finalized, processed: candidates.length };
		},
		async getStatus(statusInput) {
			const owned = await requireOwnedRun(statusInput.principal, statusInput.runId);
			if (
				owned.status !== "accepted" ||
				owned.admissionStatus === "pending_admission" ||
				owned.admissionStatus === "cancelled" ||
				(owned.admissionStatus === "dispatching" && owned.cancelOutboxStatus !== "not_requested")
			) {
				return { run: toLocalRunSummary(owned) };
			}
			const run = await input.executionRuntime.getRun({
				runId: owned.runId,
				traceId: owned.traceId,
			});
			assertRunMatchesOwnership(owned, run);
			return { run: toRunSummary(run) };
		},
		listEvents,
		async listSteps(stepsInput) {
			const owned = await requireOwnedRun(stepsInput.principal, stepsInput.runId);
			const run = await input.executionRuntime.getRun({
				runId: owned.runId,
				traceId: owned.traceId,
			});
			assertRunMatchesOwnership(owned, run);
			const trajectory = await input.executionRuntime.listRunSteps({
				runId: owned.runId,
				traceId: owned.traceId,
			});
			return {
				...sanitizeStudentRunStepTrajectory(trajectory),
				run: toRunSummary(run),
			};
		},
		async *subscribeEvents(eventsInput) {
			const polling = validateSubscriptionPolicy(eventsInput.polling);
			let lastSequence = eventsInput.afterSequence ?? 0;
			for (let attempt = 0; attempt < polling.maxAttempts; attempt += 1) {
				if (eventsInput.signal?.aborted) {
					throw new DOMException("The operation was aborted.", "AbortError");
				}
				const result = await listEvents({
					afterSequence: lastSequence,
					principal: eventsInput.principal,
					runId: eventsInput.runId,
					...(eventsInput.signal ? { signal: eventsInput.signal } : {}),
					waitMs: polling.waitMs,
				});
				for (const event of result.events) {
					lastSequence = assertSequenceAdvances(lastSequence, event);
					yield event;
					if (isTerminalRunEvent(event)) {
						return;
					}
				}
				if (isTerminalRunPhase(result.run.phase)) {
					return;
				}
				lastSequence = result.nextSequence;
			}
		},
	};
}
