import { createHash, randomUUID } from "node:crypto";
import type { OfficialWebRunIntent, OfficialWebRunStatus } from "ingestion-contracts";
import { OfficialWebControlPlaneError } from "./official-web-control-plane-errors";
import {
	assertCanonicalWorkset,
	normalizeFinalizePayload,
	normalizeHeartbeatPayload,
	normalizeResolvePayload,
	normalizeStartPayload,
	normalizeString,
} from "./official-web-control-plane-normalization";
import type {
	NormalizedOfficialWebPlannerFilters,
	OfficialWebArtifactRecord,
	OfficialWebCollectorPrincipal,
	OfficialWebFinalizePayload,
	OfficialWebHeartbeatPayload,
	OfficialWebPlannerPageCandidate,
	OfficialWebPlannerResolvePayload,
	OfficialWebRunOutboxWrite,
	OfficialWebStartPayload,
	PersistedOfficialWebPageObservation,
	StoredOfficialWebPageFreshnessState,
	StoredOfficialWebRun,
} from "./official-web-control-plane-types";
import { buildPersistedPageObservations } from "./official-web-observation-materialization";

const HEARTBEAT_INTERVAL_SECONDS = 60;
const TERMINAL_STATUSES = new Set<OfficialWebRunStatus>([
	"completed",
	"completed_with_errors",
	"failed",
	"abandoned",
]);

export interface OfficialWebControlPlaneStore {
	acceptRun(input: {
		outboxEvent: OfficialWebRunOutboxWrite;
		run: StoredOfficialWebRun;
	}): Promise<StoredOfficialWebRun>;
	appendHeartbeat(input: {
		heartbeat: {
			counts: Record<string, number>;
			createdAt: string;
			heartbeatId: string;
			observedAt: string;
			runId: string;
			sequence: number;
		};
		run: StoredOfficialWebRun;
	}): Promise<StoredOfficialWebRun>;
	finalizeRun(input: {
		artifacts: OfficialWebArtifactRecord[];
		observations: PersistedOfficialWebPageObservation[];
		outboxEvent: OfficialWebRunOutboxWrite;
		run: StoredOfficialWebRun;
	}): Promise<StoredOfficialWebRun>;
	getRunById(runId: string): Promise<StoredOfficialWebRun | null>;
	getRunBySchedulerKey(
		siteId: string,
		schedulerRunKey: string,
		runIntent: OfficialWebRunIntent,
	): Promise<StoredOfficialWebRun | null>;
	listDuePages(
		filters: NormalizedOfficialWebPlannerFilters,
	): Promise<OfficialWebPlannerPageCandidate[]>;
	listPageFreshnessStates(
		siteId: string,
		normalizedCanonicalUrls: string[],
	): Promise<StoredOfficialWebPageFreshnessState[]>;
}

export interface OfficialWebControlPlaneService {
	finalize(input: {
		payload: OfficialWebFinalizePayload;
		principal: OfficialWebCollectorPrincipal;
		runId: string;
	}): Promise<{
		run: {
			finishedAt: string | null;
			ingestionDispatchStatus: string;
			runId: string;
			status: string;
		};
	}>;
	heartbeat(input: {
		payload: OfficialWebHeartbeatPayload;
		principal: OfficialWebCollectorPrincipal;
		runId: string;
	}): Promise<{
		run: {
			lastHeartbeatAt: string | null;
			runId: string;
			status: string;
		};
	}>;
	resolvePlan(input: {
		payload: OfficialWebPlannerResolvePayload;
		principal: OfficialWebCollectorPrincipal;
	}): Promise<{
		plan: {
			duePages: OfficialWebPlannerPageCandidate[];
			hostFilter: string[];
			maxPagesPerHost: number;
			maxTotalPages: number;
			resolvedAt: string;
			runIntent: OfficialWebRunIntent;
			siteId: string;
			summary: {
				duePages: number;
				listingPages: number;
				repairPages: number;
				selectedHosts: number;
				staticPages: number;
				targetJobs: number;
				worksetRows: number;
			};
		};
	}>;
	start(input: {
		payload: OfficialWebStartPayload;
		principal: OfficialWebCollectorPrincipal;
	}): Promise<{
		run: {
			heartbeatIntervalSeconds: number;
			runId: string;
			siteId: string;
			startedAt: string;
			status: string;
		};
	}>;
}

export function createOfficialWebControlPlaneService(input: {
	generateId?: (prefix: string) => string;
	now?: () => Date;
	store: OfficialWebControlPlaneStore;
}): OfficialWebControlPlaneService {
	const generateId = input.generateId ?? defaultGenerateId;
	const now = input.now ?? (() => new Date());

	return {
		async start(request) {
			requireCollectorPrincipal(request.principal);
			const normalized = normalizeStartPayload(request.payload);
			const startPayloadSha256 = fingerprint(normalized);
			const existing = await input.store.getRunBySchedulerKey(
				normalized.siteId,
				normalized.schedulerRunKey,
				normalized.runIntent,
			);
			if (existing) {
				if (existing.startFingerprintSha256 !== startPayloadSha256) {
					throw routeError({
						code: "idempotency_conflict",
						message: "schedulerRunKey already exists with a different payload.",
						status: 409,
					});
				}
				return buildStartResponse(existing);
			}

			const acceptedAt = now().toISOString();
			const runId = generateId("owrun");
			const run: StoredOfficialWebRun = {
				sourceAdapterVersion: normalized.sourceAdapterVersion,
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
				startFingerprintSha256: startPayloadSha256,
				startedAt: normalized.startedAt,
				status: "accepted",
				summary: null,
				terminalErrorCode: null,
				terminalErrorMessage: null,
				terminalPayloadSha256: null,
				triggerType: normalized.triggerType,
			};
			const accepted = await input.store.acceptRun({
				outboxEvent: {
					attemptCount: 0,
					availableAt: acceptedAt,
					eventId: generateId("owevt_accepted"),
					eventType: "official_web.run.accepted",
					lastError: null,
					occurredAt: acceptedAt,
					payload: {
						runId,
						runIntent: run.runIntent,
						schedulerRunKey: run.schedulerRunKey,
						siteId: run.siteId,
						startedAt: run.startedAt,
						status: run.status,
					},
					processedAt: null,
					runId,
				},
				run,
			});
			return buildStartResponse(accepted);
		},

		async heartbeat(request) {
			requireCollectorPrincipal(request.principal);
			const runId = normalizeString(request.runId);
			if (!runId) {
				throw routeError({
					code: "run_not_found",
					message: "Official web run not found.",
					status: 404,
				});
			}
			const normalized = normalizeHeartbeatPayload(request.payload);
			const existing = ensureRunExists(await input.store.getRunById(runId), runId);
			if (TERMINAL_STATUSES.has(existing.status)) {
				throw routeError({
					code: existing.status === "abandoned" ? "run_abandoned" : "run_not_active",
					message:
						existing.status === "abandoned"
							? "Official web run is already abandoned."
							: "Official web run is already terminal.",
					status: 409,
				});
			}
			if (normalized.sequence <= existing.latestHeartbeatSequence) {
				throw routeError({
					code: "heartbeat_out_of_order",
					message: "Heartbeat sequence must increase monotonically.",
					status: 409,
				});
			}
			const nextRun = await input.store.appendHeartbeat({
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
			return {
				run: {
					lastHeartbeatAt: nextRun.lastHeartbeatAt,
					runId: nextRun.runId,
					status: nextRun.status,
				},
			};
		},

		async finalize(request) {
			requireCollectorPrincipal(request.principal);
			const runId = normalizeString(request.runId);
			const existing = ensureRunExists(await input.store.getRunById(runId), runId);
			if (existing.status === "abandoned") {
				throw routeError({
					code: "run_abandoned",
					message: "Official web run is already abandoned.",
					status: 409,
				});
			}
			const normalized = normalizeFinalizePayload(request.payload);
			const terminalPayloadSha256 = fingerprint(normalized);
			if (TERMINAL_STATUSES.has(existing.status)) {
				if (existing.terminalPayloadSha256 === terminalPayloadSha256) {
					return buildFinalizeResponse(existing);
				}
				throw routeError({
					code: "run_already_finalized",
					message: "Official web run is already finalized with a different payload.",
					status: 409,
				});
			}

			const existingStates = await input.store.listPageFreshnessStates(
				existing.siteId,
				normalized.pageObservations.map((item) => item.normalizedCanonicalUrl),
			);
			const observationResult = buildPersistedPageObservations({
				existingStates: new Map(
					existingStates.map((item) => [item.normalizedCanonicalUrl, item] as const),
				),
				generateId,
				pageObservations: normalized.pageObservations,
				run: existing,
			});
			const summary = {
				...normalized.summary,
				...observationResult.summary,
			};
			const finalizedAt = now().toISOString();
			const nextRun = await input.store.finalizeRun({
				artifacts: normalized.artifacts,
				observations: observationResult.observations,
				outboxEvent: {
					attemptCount: 0,
					availableAt: finalizedAt,
					eventId: generateId("owevt_completed"),
					eventType: `official_web.run.${normalized.terminalStatus}`,
					lastError: null,
					occurredAt: finalizedAt,
					payload: {
						artifacts: normalized.artifacts,
						finishedAt: normalized.finishedAt,
						pageChanges: observationResult.pageChanges,
						pageChangeSummary: observationResult.summary,
						runId: existing.runId,
						runIntent: existing.runIntent,
						schedulerRunKey: existing.schedulerRunKey,
						siteId: existing.siteId,
						status: normalized.terminalStatus,
						summary,
					},
					processedAt: null,
					runId: existing.runId,
				},
				run: {
					...existing,
					finishedAt: normalized.finishedAt,
					ingestionDispatchRef: null,
					ingestionDispatchStatus: "queued",
					summary,
					terminalPayloadSha256,
					status: normalized.terminalStatus,
				},
			});
			return buildFinalizeResponse(nextRun);
		},

		async resolvePlan(request) {
			requireCollectorPrincipal(request.principal);
			const filters = normalizeResolvePayload(request.payload);
			const duePages = await input.store.listDuePages(filters);
			assertCanonicalWorkset(duePages);
			const selectedHosts = new Set<string>();
			const targetJobs = new Set<string>();
			let listingPages = 0;
			let repairPages = 0;
			let staticPages = 0;
			for (const page of duePages) {
				selectedHosts.add(page.host);
				targetJobs.add(page.targetJobId);
				if (page.worksetReason === "target_candidate_repair") {
					repairPages += 1;
				} else if (page.cadenceClass === "listing_hot") {
					listingPages += 1;
				} else {
					staticPages += 1;
				}
			}
			return {
				plan: {
					duePages,
					hostFilter: filters.hostFilter,
					maxPagesPerHost: filters.maxPagesPerHost,
					maxTotalPages: filters.maxTotalPages,
					resolvedAt: filters.now,
					runIntent: filters.runIntent,
					siteId: filters.siteId,
					summary: {
						duePages: duePages.length,
						listingPages,
						repairPages,
						selectedHosts: selectedHosts.size,
						staticPages,
						targetJobs: targetJobs.size,
						worksetRows: duePages.length,
					},
				},
			};
		},
	};
}

function defaultGenerateId(prefix: string): string {
	return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function fingerprint(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function routeError(input: { code: string; details?: unknown; message: string; status: number }) {
	return new OfficialWebControlPlaneError({
		...input,
		retryable: input.status >= 500,
	});
}

function requireCollectorPrincipal(principal: OfficialWebCollectorPrincipal): void {
	if (principal.kind !== "service" || principal.serviceClass !== "official_web_collector") {
		throw routeError({
			code: "forbidden",
			message: "Official web collector access is not available for this principal.",
			status: 403,
		});
	}
}

function ensureRunExists(run: StoredOfficialWebRun | null, runId: string): StoredOfficialWebRun {
	if (run) {
		return run;
	}
	throw routeError({
		code: "run_not_found",
		details: { runId },
		message: "Official web run not found.",
		status: 404,
	});
}

function buildStartResponse(run: StoredOfficialWebRun) {
	return {
		run: {
			heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
			runId: run.runId,
			siteId: run.siteId,
			startedAt: run.startedAt,
			status: run.status,
		},
	};
}

function buildFinalizeResponse(run: StoredOfficialWebRun) {
	return {
		run: {
			finishedAt: run.finishedAt,
			ingestionDispatchStatus: run.ingestionDispatchStatus,
			runId: run.runId,
			status: run.status,
		},
	};
}
