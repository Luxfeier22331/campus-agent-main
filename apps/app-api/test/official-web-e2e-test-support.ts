import { vi } from "vitest";

import { createWorkerRuntime } from "../src/index";
import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type { IngestionTaskProjectionClient } from "../src/modules/integration";
import {
	buildOfficialWebCommandService,
	type OfficialWebArtifactRecord,
	type OfficialWebCommandServiceDependencies,
	type OfficialWebCommandStore,
	type StoredOfficialWebPageFreshnessState,
	type StoredOfficialWebRun,
} from "../src/modules/official-web-command";
import {
	buildOfficialWebProjectionProjector,
	type OfficialWebProjectionProjectorStore,
	type OfficialWebRunOutboxEvent,
	type OfficialWebRunProjectionMaterialization,
	type OfficialWebRunProjectionSource,
	type OfficialWebSiteProjectionMaterialization,
	type OfficialWebSiteProjectionSource,
} from "../src/modules/official-web-projection";
import {
	buildOfficialWebQueryService,
	type OfficialWebPageChangeRecord,
	type OfficialWebQueryStore,
	type OfficialWebRunRecord,
	type OfficialWebSiteFreshnessSummary,
	type OfficialWebSiteRecord,
} from "../src/modules/official-web-query";
import type { RequestProjectionProjector } from "../src/modules/projection";

export interface MemoryOutboxEvent extends OfficialWebRunOutboxEvent {
	lastError: string | null;
}

export interface MemoryState {
	artifactsByRunId: Map<string, OfficialWebArtifactRecord[]>;
	outboxEvents: MemoryOutboxEvent[];
	pageChanges: OfficialWebPageChangeRecord[];
	pageFreshnessByUrl: Map<string, StoredOfficialWebPageFreshnessState>;
	runProjections: Map<string, OfficialWebRunRecord>;
	runs: Map<string, StoredOfficialWebRun>;
	siteProjections: Map<string, OfficialWebSiteRecord>;
}

export const OFFICIAL_WEB_E2E_ENV = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN: "trusted-collector-token",
	APP_API_OFFICIAL_WEB_PROJECTION_SWEEPER_ENABLED: "true",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	OBJECT_STORE_BUCKET_SOURCE: "campus-agent-source",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

export function createOperatorPrincipal(): ResolvedAppPrincipal {
	return {
		actor: {
			departments: ["ops"],
			principalId: "ops@example.com",
			principalType: "operator",
			roles: ["operator"],
			userId: "ops@example.com",
		},
		permissions: {
			chat: false,
			operator: true,
		},
		principal: {
			displayName: "Ops Team",
			email: "ops@example.com",
			principalId: "ops@example.com",
			type: "operator",
		},
		session: null,
	};
}

export function createMemoryState(): MemoryState {
	return {
		artifactsByRunId: new Map(),
		outboxEvents: [],
		pageChanges: [],
		pageFreshnessByUrl: new Map(),
		runProjections: new Map(),
		runs: new Map(),
		siteProjections: new Map(),
	};
}

export function createMemoryCommandStore(state: MemoryState): OfficialWebCommandStore {
	return {
		async acceptRun(input) {
			state.runs.set(input.run.runId, { ...input.run });
			state.outboxEvents.push({
				...input.outboxEvent,
				lastError: input.outboxEvent.lastError,
			});
			return { ...input.run };
		},
		async appendHeartbeat(input) {
			state.runs.set(input.run.runId, { ...input.run });
			return { ...input.run };
		},
		async finalizeRun(input) {
			state.runs.set(input.run.runId, { ...input.run });
			state.artifactsByRunId.set(
				input.run.runId,
				input.artifacts.map((artifact) => ({ ...artifact })),
			);
			for (const observation of input.observations) {
				state.pageChanges.push({
					changeStatus: observation.changeStatus,
					fetchDisposition: observation.fetchDisposition,
					host: observation.host,
					httpStatus: observation.httpStatus,
					id: observation.observationId,
					lastChangeReason: observation.lastChangeReason,
					normalizedCanonicalUrl: observation.normalizedCanonicalUrl,
					observedAt: observation.observedAt,
					pageFamily: observation.pageFamily,
					pageTitleNormalized: observation.pageTitleNormalized,
					rawAssetId: observation.rawAssetId,
					rawVersionId: observation.rawVersionId,
					runId: observation.runId,
				});
				state.pageFreshnessByUrl.set(
					`${observation.siteId}::${observation.normalizedCanonicalUrl}`,
					{
						cadenceClass: observation.cadenceClass,
						contentType: observation.contentType,
						discoveredFromUrl: observation.discoveredFromUrl,
						discoveryMethod: observation.discoveryMethod,
						etag: observation.etag,
						host: observation.host,
						lastChangeReason: observation.lastChangeReason,
						lastChangedAt: observation.freshness.lastChangedAt,
						lastFetchDisposition: observation.fetchDisposition,
						lastHttpStatus: observation.httpStatus,
						lastModified: observation.lastModified,
						lastNotModifiedAt: observation.freshness.lastNotModifiedAt,
						lastSeenAt: observation.observedAt,
						lastSuccessfulRunId: observation.freshness.lastSuccessfulRunId,
						mainContentHash: observation.freshness.mainContentHash,
						nextEligibleFetchAt: observation.nextEligibleFetchAt,
						normalizedCanonicalUrl: observation.normalizedCanonicalUrl,
						pageFamily: observation.pageFamily,
						pageTitleNormalized: observation.pageTitleNormalized,
						priorityScore: observation.priorityScore,
						responseBodyHash: observation.freshness.responseBodyHash,
						siteId: observation.siteId,
					},
				);
			}
			state.outboxEvents.push({
				...input.outboxEvent,
				lastError: input.outboxEvent.lastError,
			});
			return { ...input.run };
		},
		async getRunById(runId) {
			const run = state.runs.get(runId);
			return run ? { ...run } : null;
		},
		async getRunBySchedulerKey(siteId, schedulerRunKey, runIntent) {
			for (const run of state.runs.values()) {
				if (
					run.siteId === siteId &&
					run.schedulerRunKey === schedulerRunKey &&
					run.runIntent === runIntent
				) {
					return { ...run };
				}
			}

			return null;
		},
		async listPageFreshnessStates(siteId, normalizedCanonicalUrls) {
			return normalizedCanonicalUrls
				.map((url) => state.pageFreshnessByUrl.get(`${siteId}::${url}`))
				.filter((item): item is StoredOfficialWebPageFreshnessState => Boolean(item))
				.map((item) => ({ ...item }));
		},
	};
}

function toRunProjectionSource(
	run: StoredOfficialWebRun,
	artifacts: OfficialWebArtifactRecord[],
): OfficialWebRunProjectionSource {
	return {
		artifacts: artifacts.map((artifact) => ({ ...artifact })),
		collectorVersion: run.collectorVersion,
		configVersion: run.configVersion,
		crawlPolicyVersion: run.crawlPolicyVersion,
		failureCount:
			typeof run.summary?.failureCount === "number" ? (run.summary.failureCount as number) : 0,
		finishedAt: run.finishedAt,
		hostSet: [...run.hostSet],
		ingestionDispatchRef: run.ingestionDispatchRef,
		ingestionDispatchStatus: run.ingestionDispatchStatus,
		ingestionExecutionErrorCode: run.ingestionExecutionErrorCode,
		ingestionExecutionErrorMessage: run.ingestionExecutionErrorMessage,
		ingestionExecutionRef: run.ingestionExecutionRef,
		ingestionExecutionStatus: run.ingestionExecutionStatus,
		ingestionExecutionUpdatedAt: run.ingestionExecutionUpdatedAt,
		lastHeartbeatAt: run.lastHeartbeatAt,
		runId: run.runId,
		runIntent: run.runIntent,
		schedulerRunKey: run.schedulerRunKey,
		seedSet: [...run.seedSet],
		siteId: run.siteId,
		startedAt: run.startedAt,
		status: run.status,
		summary: run.summary,
		triggerType: run.triggerType,
	};
}

export function createMemoryProjectionStore(
	state: MemoryState,
): OfficialWebProjectionProjectorStore {
	return {
		async getRunProjectionSource(runId) {
			const run = state.runs.get(runId);
			if (!run) {
				return null;
			}

			return toRunProjectionSource(run, state.artifactsByRunId.get(runId) ?? []);
		},
		async getSiteProjectionSource(siteId) {
			const runs = [...state.runs.values()]
				.filter((run) => run.siteId === siteId)
				.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
			const latest = runs[0];
			if (!latest) {
				return null;
			}

			return {
				displayName: "Www Muc Edu Cn",
				hostRoots: [...latest.hostSet],
				lastFailureAt: null,
				lastSuccessAt: latest.finishedAt,
				latestCollectorVersion: latest.collectorVersion,
				latestConfigVersion: latest.configVersion,
				latestIngestionDispatchStatus: latest.ingestionDispatchStatus,
				latestIngestionExecutionErrorCode: latest.ingestionExecutionErrorCode,
				latestIngestionExecutionStatus: latest.ingestionExecutionStatus,
				latestIngestionExecutionUpdatedAt: latest.ingestionExecutionUpdatedAt,
				latestRunId: latest.runId,
				latestRunStatus: latest.status,
				siteId: latest.siteId,
			} satisfies OfficialWebSiteProjectionSource;
		},
		async listPendingEvents(limit, now) {
			return state.outboxEvents
				.filter((event) => !event.processedAt && new Date(event.availableAt) <= now)
				.slice(0, limit)
				.map((event) => ({ ...event }));
		},
		async markEventFailed(input) {
			const event = state.outboxEvents.find((candidate) => candidate.eventId === input.eventId);
			if (!event) {
				return;
			}

			event.attemptCount = input.attemptCount;
			event.availableAt = input.availableAt;
			event.lastError = input.lastError;
			event.processedAt = input.processedAt;
		},
		async markEventProcessed(input) {
			const event = state.outboxEvents.find((candidate) => candidate.eventId === input.eventId);
			if (!event) {
				return;
			}

			event.attemptCount = 1;
			event.lastError = null;
			event.processedAt = input.processedAt;
		},
		async markTimedOutRunsAsAbandoned() {
			return 0;
		},
		async updateRunDispatchStatus(input) {
			const run = state.runs.get(input.runId);
			if (!run) {
				return;
			}

			state.runs.set(input.runId, {
				...run,
				ingestionDispatchRef: input.dispatchRef,
				ingestionDispatchStatus: input.status,
				ingestionDispatchedAt: input.dispatchedAt,
			});
		},
		async updateRunExecutionStatus(input) {
			const run = state.runs.get(input.runId);
			if (!run) {
				return false;
			}

			state.runs.set(input.runId, {
				...run,
				ingestionExecutionErrorCode: input.errorCode,
				ingestionExecutionErrorMessage: input.errorMessage,
				ingestionExecutionRef: input.executionRef,
				ingestionExecutionStatus: input.status,
				ingestionExecutionUpdatedAt: input.updatedAt,
			});
			return true;
		},
		async upsertRunProjection(projection: OfficialWebRunProjectionMaterialization) {
			state.runProjections.set(projection.runId, {
				artifacts: projection.artifacts.map((artifact) => ({ ...artifact })),
				collectorVersion: projection.collectorVersion,
				configVersion: projection.configVersion,
				failureCount: projection.failureCount,
				finishedAt: projection.finishedAt,
				id: projection.runId,
				ingestionDispatchRef: projection.ingestionDispatchRef,
				ingestionDispatchStatus: projection.ingestionDispatchStatus,
				ingestionExecutionErrorCode: projection.ingestionExecutionErrorCode,
				ingestionExecutionErrorMessage: projection.ingestionExecutionErrorMessage,
				ingestionExecutionRef: projection.ingestionExecutionRef,
				ingestionExecutionStatus: projection.ingestionExecutionStatus,
				ingestionExecutionUpdatedAt: projection.ingestionExecutionUpdatedAt,
				lastHeartbeatAt: projection.lastHeartbeatAt,
				projectedAt: projection.projectedAt,
				runId: projection.runId,
				runIntent: projection.runIntent,
				siteId: projection.siteId,
				startedAt: projection.startedAt,
				status: projection.status,
				summary: projection.summary,
			});
		},
		async upsertSiteProjection(projection: OfficialWebSiteProjectionMaterialization) {
			state.siteProjections.set(projection.siteId, {
				displayName: projection.displayName,
				hostRoots: [...projection.hostRoots],
				id: projection.siteId,
				lastFailureAt: projection.lastFailureAt,
				lastSuccessAt: projection.lastSuccessAt,
				latestCollectorVersion: projection.latestCollectorVersion,
				latestConfigVersion: projection.latestConfigVersion,
				latestIngestionDispatchStatus: projection.latestIngestionDispatchStatus,
				latestIngestionExecutionErrorCode: projection.latestIngestionExecutionErrorCode,
				latestIngestionExecutionStatus: projection.latestIngestionExecutionStatus,
				latestIngestionExecutionUpdatedAt: projection.latestIngestionExecutionUpdatedAt,
				latestRunId: projection.latestRunId,
				latestRunStatus: projection.latestRunStatus,
				projectedAt: projection.projectedAt,
				siteId: projection.siteId,
			});
		},
	};
}

export function createMemoryQueryStore(state: MemoryState): OfficialWebQueryStore {
	return {
		async getRunById(runId) {
			const run = state.runProjections.get(runId);
			return run ? { ...run, artifacts: run.artifacts.map((artifact) => ({ ...artifact })) } : null;
		},
		async getSiteById(siteId) {
			const site = state.siteProjections.get(siteId);
			return site ? { ...site, hostRoots: [...site.hostRoots] } : null;
		},
		async getSiteFreshnessSummary(input): Promise<OfficialWebSiteFreshnessSummary> {
			const now = new Date(input.now).valueOf();
			const changedSince = now - 24 * 60 * 60 * 1000;
			const rows = [...state.pageFreshnessByUrl.values()].filter(
				(row) => row.siteId === input.siteId,
			);

			return {
				changedLast24h: rows.filter(
					(row) => row.lastChangedAt && new Date(row.lastChangedAt).valueOf() >= changedSince,
				).length,
				deletedPages: rows.filter((row) => row.lastFetchDisposition === "deleted").length,
				duePages: rows.filter(
					(row) =>
						row.lastFetchDisposition !== "deleted" &&
						new Date(row.nextEligibleFetchAt).valueOf() <= now,
				).length,
				failedFetchPages: rows.filter((row) => row.lastFetchDisposition === "fetch_failed").length,
				hotPages: rows.filter(
					(row) =>
						row.lastFetchDisposition !== "deleted" &&
						(row.cadenceClass === "listing_hot" || row.cadenceClass === "detail_recent"),
				).length,
				repairPages: rows.filter(
					(row) =>
						row.lastFetchDisposition !== "deleted" &&
						(row.cadenceClass === "repair" || row.lastFetchDisposition === "fetch_failed"),
				).length,
				totalPages: rows.length,
			};
		},
		async listSiteFreshnessBacklog(input) {
			const rows = [...state.pageFreshnessByUrl.values()]
				.filter((row) => row.siteId === input.siteId)
				.map((row) => ({
					cadenceClass: row.cadenceClass,
					host: row.host,
					lastChangeReason: row.lastChangeReason,
					lastChangedAt: row.lastChangedAt,
					lastFetchDisposition: row.lastFetchDisposition,
					lastHttpStatus: row.lastHttpStatus,
					lastSeenAt: row.lastSeenAt,
					nextEligibleFetchAt: row.nextEligibleFetchAt,
					normalizedCanonicalUrl: row.normalizedCanonicalUrl,
					pageFamily: row.pageFamily,
					pageTitleNormalized: row.pageTitleNormalized,
					priorityScore: row.priorityScore,
					siteId: row.siteId,
				}))
				.slice(0, input.limit);

			return {
				deletedPages: rows.filter((row) => row.lastFetchDisposition === "deleted"),
				duePages: rows.filter(
					(row) =>
						row.lastFetchDisposition !== "deleted" &&
						new Date(row.nextEligibleFetchAt).valueOf() <= new Date(input.now).valueOf(),
				),
				failedFetchPages: rows.filter((row) => row.lastFetchDisposition === "fetch_failed"),
				hotPages: rows.filter(
					(row) =>
						row.lastFetchDisposition !== "deleted" &&
						(row.cadenceClass === "listing_hot" || row.cadenceClass === "detail_recent"),
				),
			};
		},
		async listPageChangesByRunId(runId) {
			return state.pageChanges
				.filter((change) => change.runId === runId && change.changeStatus !== "not_modified")
				.map((change) => ({ ...change }));
		},
		async listRecentPageChangesBySiteId(siteId) {
			const urls = new Set(
				[...state.pageFreshnessByUrl.values()]
					.filter((item) => item.siteId === siteId)
					.map((item) => item.normalizedCanonicalUrl),
			);
			return state.pageChanges
				.filter(
					(change) =>
						urls.has(change.normalizedCanonicalUrl) && change.changeStatus !== "not_modified",
				)
				.map((change) => ({ ...change }));
		},
		async listRecentRunsBySiteId(siteId) {
			return [...state.runProjections.values()]
				.filter((run) => run.siteId === siteId)
				.sort((left, right) => right.startedAt.localeCompare(left.startedAt))
				.map((run) => ({ ...run, artifacts: run.artifacts.map((artifact) => ({ ...artifact })) }));
		},
		async listRuns() {
			return {
				page: {
					nextCursor: null,
				},
				runs: [...state.runProjections.values()].map((run) => ({
					...run,
					artifacts: run.artifacts.map((artifact) => ({ ...artifact })),
				})),
			};
		},
		async listSites() {
			return {
				sites: [...state.siteProjections.values()].map((site) => ({
					...site,
					hostRoots: [...site.hostRoots],
				})),
			};
		},
	};
}

export type MockIngestionTaskClient = IngestionTaskProjectionClient & {
	admitTask: ReturnType<typeof vi.fn>;
	listTasks: ReturnType<typeof vi.fn>;
};

export type GenerateIdFn = NonNullable<OfficialWebCommandServiceDependencies["generateId"]>;

interface CreateOfficialWebE2ERuntimeInput {
	commandNow: () => Date;
	generateId: GenerateIdFn;
	ingestionTasks: IngestionTaskProjectionClient;
	projectorNow: () => Date;
	queryNow: () => Date;
	state: MemoryState;
}

function createRequestProjectorStub(): RequestProjectionProjector {
	return {
		drain: vi.fn().mockResolvedValue({
			failed: 0,
			processed: 0,
		}),
		drainRequest: vi.fn().mockResolvedValue({
			failed: 0,
			processed: 0,
		}),
	} satisfies RequestProjectionProjector;
}

export function createIngestionTaskClient(taskId: string): MockIngestionTaskClient {
	const admitTask = vi.fn().mockResolvedValue({
		task_id: taskId,
		status: "queued",
	}) as unknown as MockIngestionTaskClient["admitTask"];
	const listTasks = vi
		.fn()
		.mockResolvedValue({ tasks: [] }) as unknown as MockIngestionTaskClient["listTasks"];

	return {
		admitTask,
		listTasks,
	};
}

export function createGenerateIdMock(ids: string[]): GenerateIdFn {
	const generateId = vi.fn();
	for (const id of ids) {
		generateId.mockReturnValueOnce(id);
	}
	return generateId as unknown as GenerateIdFn;
}

export function createOfficialWebE2ERuntime(input: CreateOfficialWebE2ERuntimeInput) {
	return createWorkerRuntime(OFFICIAL_WEB_E2E_ENV, {
		getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
		officialWebCommandService: buildOfficialWebCommandService({
			generateId: input.generateId,
			now: input.commandNow,
			store: createMemoryCommandStore(input.state),
		}),
		officialWebProjector: buildOfficialWebProjectionProjector({
			ingestionTasks: input.ingestionTasks,
			now: input.projectorNow,
			sourceBucket: OFFICIAL_WEB_E2E_ENV.OBJECT_STORE_BUCKET_SOURCE,
			store: createMemoryProjectionStore(input.state),
		}),
		officialWebQueryService: buildOfficialWebQueryService({
			now: input.queryNow,
			store: createMemoryQueryStore(input.state),
		}),
		requestProjector: createRequestProjectorStub(),
	});
}
