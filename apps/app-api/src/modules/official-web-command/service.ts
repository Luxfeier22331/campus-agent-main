import { AppApiRouteError } from "../../http";
import { buildPersistedPageObservations } from "./service-freshness";
import {
	defaultComputeFingerprint,
	defaultGenerateId,
	normalizeFinalizePayload,
	normalizeHeartbeatPayload,
	normalizeStartPayload,
	normalizeString,
} from "./service-normalization";
import {
	buildFinalizeResponse,
	buildHeartbeatResponse,
	buildStartResponse,
	buildTerminalEventType,
	ensureRunExists,
	requireCollectorPrincipal,
} from "./service-runtime";
import type {
	OfficialWebCommandService,
	OfficialWebCommandServiceDependencies,
} from "./service-types";
import type { OfficialWebRunStatus } from "./store";

const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 60;
const TERMINAL_STATUSES = new Set<OfficialWebRunStatus>([
	"completed",
	"completed_with_errors",
	"failed",
	"abandoned",
]);

export type {
	OfficialWebCommandService,
	OfficialWebCommandServiceDependencies,
	OfficialWebFinalizePayload,
	OfficialWebHeartbeatPayload,
	OfficialWebStartPayload,
} from "./service-types";

export function buildOfficialWebCommandService(
	dependencies: OfficialWebCommandServiceDependencies,
): OfficialWebCommandService {
	const computeFinalizeFingerprint =
		dependencies.computeFinalizeFingerprint ?? ((payload) => defaultComputeFingerprint(payload));
	const computeStartFingerprint =
		dependencies.computeStartFingerprint ?? ((payload) => defaultComputeFingerprint(payload));
	const generateId = dependencies.generateId ?? defaultGenerateId;
	const heartbeatIntervalSeconds =
		dependencies.heartbeatIntervalSeconds ?? DEFAULT_HEARTBEAT_INTERVAL_SECONDS;
	const now = dependencies.now ?? (() => new Date());

	return {
		async start(input) {
			requireCollectorPrincipal(input.principal);
			const normalized = normalizeStartPayload(input.payload);
			const startFingerprintSha256 = computeStartFingerprint(normalized);
			const existing = await dependencies.store.getRunBySchedulerKey(
				normalized.siteId,
				normalized.schedulerRunKey,
				normalized.runIntent,
			);

			if (existing) {
				if (existing.startFingerprintSha256 !== startFingerprintSha256) {
					throw new AppApiRouteError({
						code: "idempotency_conflict",
						message: "schedulerRunKey already exists with a different payload.",
						retryable: false,
						status: 409,
					});
				}

				return buildStartResponse(existing, heartbeatIntervalSeconds);
			}

			const acceptedAt = now().toISOString();
			const runId = generateId("owrun");
			const eventId = generateId("owevt_accepted");
			const run = await dependencies.store.acceptRun({
				outboxEvent: {
					attemptCount: 0,
					availableAt: acceptedAt,
					eventId,
					eventType: "official_web.run.accepted",
					lastError: null,
					occurredAt: acceptedAt,
					payload: {
						runId,
						runIntent: normalized.runIntent,
						schedulerRunKey: normalized.schedulerRunKey,
						siteId: normalized.siteId,
						startedAt: normalized.startedAt,
						status: "accepted",
					},
					processedAt: null,
					runId,
				},
				run: {
					collectorVersion: normalized.collectorVersion,
					configVersion: normalized.configVersion,
					crawlPolicyVersion: normalized.crawlPolicyVersion,
					finishedAt: null,
					hostSet: normalized.hostSet,
					ingestionDispatchRef: null,
					ingestionDispatchStatus: "pending",
					ingestionDispatchedAt: null,
					ingestionExecutionErrorCode: null,
					ingestionExecutionErrorMessage: null,
					ingestionExecutionRef: null,
					ingestionExecutionStatus: "pending",
					ingestionExecutionUpdatedAt: null,
					lastHeartbeatAt: null,
					latestHeartbeatSequence: 0,
					runId,
					runIntent: normalized.runIntent,
					schedulerRunKey: normalized.schedulerRunKey,
					seedSet: normalized.seedSet,
					siteId: normalized.siteId,
					startFingerprintSha256,
					startedAt: normalized.startedAt,
					status: "accepted",
					summary: null,
					terminalErrorCode: null,
					terminalErrorMessage: null,
					terminalPayloadSha256: null,
					triggerType: normalized.triggerType,
				},
			});

			return buildStartResponse(run, heartbeatIntervalSeconds);
		},

		async heartbeat(input) {
			requireCollectorPrincipal(input.principal);
			const normalizedRunId = normalizeString(input.runId);
			if (!normalizedRunId) {
				throw new AppApiRouteError({
					code: "run_not_found",
					message: "Official web run not found.",
					retryable: false,
					status: 404,
				});
			}

			const normalized = normalizeHeartbeatPayload(input.payload);
			const existing = ensureRunExists(
				await dependencies.store.getRunById(normalizedRunId),
				normalizedRunId,
			);

			if (TERMINAL_STATUSES.has(existing.status)) {
				throw new AppApiRouteError({
					code: existing.status === "abandoned" ? "run_abandoned" : "run_not_active",
					message:
						existing.status === "abandoned"
							? "Official web run is already abandoned."
							: "Official web run is already terminal.",
					retryable: false,
					status: 409,
				});
			}
			if (normalized.sequence <= existing.latestHeartbeatSequence) {
				throw new AppApiRouteError({
					code: "heartbeat_out_of_order",
					message: "Heartbeat sequence must increase monotonically.",
					retryable: false,
					status: 409,
				});
			}

			const nextRun = await dependencies.store.appendHeartbeat({
				heartbeat: {
					counts: normalized.counts,
					createdAt: now().toISOString(),
					heartbeatId: generateId("owhb"),
					observedAt: normalized.observedAt,
					runId: existing.runId,
					sequence: normalized.sequence,
				},
				run: {
					...existing,
					lastHeartbeatAt: normalized.observedAt,
					latestHeartbeatSequence: normalized.sequence,
					status: "running",
					summary: normalized.counts,
				},
			});

			return buildHeartbeatResponse(nextRun);
		},

		async finalize(input) {
			requireCollectorPrincipal(input.principal);
			const normalizedRunId = normalizeString(input.runId);
			const existing = ensureRunExists(
				await dependencies.store.getRunById(normalizedRunId),
				normalizedRunId,
			);
			const normalized = normalizeFinalizePayload(input.payload);
			const terminalPayloadSha256 = computeFinalizeFingerprint(normalized);
			const terminalEventId = generateId("owevt_completed");
			const existingStates = await dependencies.store.listPageFreshnessStates(
				existing.siteId,
				normalized.pageObservations.map((item) => item.normalizedCanonicalUrl),
			);
			const pageObservationResult = buildPersistedPageObservations({
				existingStates: new Map(
					existingStates.map((item) => [item.normalizedCanonicalUrl, item] as const),
				),
				generateId,
				pageObservations: normalized.pageObservations,
				run: existing,
			});
			const mergedSummary = {
				...normalized.summary,
				...pageObservationResult.summary,
			};

			if (existing.status === "abandoned") {
				throw new AppApiRouteError({
					code: "run_abandoned",
					message: "Official web run is already abandoned.",
					retryable: false,
					status: 409,
				});
			}
			if (TERMINAL_STATUSES.has(existing.status)) {
				if (existing.terminalPayloadSha256 === terminalPayloadSha256) {
					return buildFinalizeResponse(existing);
				}

				throw new AppApiRouteError({
					code: "run_already_finalized",
					message: "Official web run is already finalized with a different payload.",
					retryable: false,
					status: 409,
				});
			}

			const finalizedAt = now().toISOString();
			const nextRun = await dependencies.store.finalizeRun({
				artifacts: normalized.artifacts,
				observations: pageObservationResult.observations,
				outboxEvent: {
					attemptCount: 0,
					availableAt: finalizedAt,
					eventId: terminalEventId,
					eventType: buildTerminalEventType(normalized.terminalStatus),
					lastError: null,
					occurredAt: finalizedAt,
					payload: {
						artifacts: normalized.artifacts,
						finishedAt: normalized.finishedAt,
						pageChanges: pageObservationResult.pageChanges,
						pageChangeSummary: pageObservationResult.summary,
						runId: existing.runId,
						runIntent: existing.runIntent,
						schedulerRunKey: existing.schedulerRunKey,
						siteId: existing.siteId,
						status: normalized.terminalStatus,
						summary: mergedSummary,
					},
					processedAt: null,
					runId: existing.runId,
				},
				run: {
					...existing,
					finishedAt: normalized.finishedAt,
					ingestionDispatchRef: null,
					ingestionDispatchStatus: "queued",
					ingestionExecutionErrorCode: existing.ingestionExecutionErrorCode,
					ingestionExecutionErrorMessage: existing.ingestionExecutionErrorMessage,
					ingestionExecutionRef: existing.ingestionExecutionRef,
					ingestionExecutionStatus: existing.ingestionExecutionStatus,
					ingestionExecutionUpdatedAt: existing.ingestionExecutionUpdatedAt,
					summary: mergedSummary,
					terminalPayloadSha256,
					status: normalized.terminalStatus,
				},
			});

			return buildFinalizeResponse(nextRun);
		},
	};
}
