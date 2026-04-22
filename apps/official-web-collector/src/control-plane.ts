import { requestJson } from "./control-plane-transport.ts";
import type {
	OfficialWebControlPlaneClient,
	OfficialWebControlPlaneFinalizeResponse,
	OfficialWebControlPlaneHeartbeatResponse,
	OfficialWebControlPlanePlanResponse,
	OfficialWebControlPlaneStartResponse,
	OfficialWebResolvePlanInput,
} from "./control-plane-types.ts";

export { OfficialWebControlPlaneTransportError } from "./control-plane-transport.ts";
export type {
	OfficialWebControlPlaneClient,
	OfficialWebControlPlaneFinalizeResponse,
	OfficialWebControlPlaneHeartbeatResponse,
	OfficialWebControlPlanePlanResponse,
	OfficialWebControlPlaneStartResponse,
	OfficialWebFinalizeInput,
	OfficialWebHeartbeatInput,
	OfficialWebPlannerPageCandidate,
	OfficialWebResolvePlanInput,
	OfficialWebRunStartInput,
	OfficialWebTerminalStatus,
	OfficialWebTriggerType,
} from "./control-plane-types.ts";

export function createOfficialWebControlPlaneClient(
	env: {
		appApiBaseUrl?: string | null;
		serviceToken?: string | null;
	},
	input: {
		fetchImplementation?: typeof fetch;
	} = {},
): OfficialWebControlPlaneClient {
	const fetchImplementation = input.fetchImplementation ?? fetch;

	return {
		startRun(payload) {
			return requestJson<OfficialWebControlPlaneStartResponse>({
				baseUrl: env.appApiBaseUrl,
				serviceToken: env.serviceToken,
				path: "/api/official-web/runs",
				body: {
					siteId: payload.siteId,
					schedulerRunKey: payload.schedulerRunKey,
					runIntent: payload.runIntent,
					triggerType: payload.triggerType,
					collectorVersion: payload.collectorVersion,
					configVersion: payload.configVersion,
					crawlPolicyVersion: payload.crawlPolicyVersion,
					hostSet: payload.hostSet,
					seedSet: payload.seedSet,
					startedAt: payload.startedAt,
				},
				traceId: payload.traceId,
				fetchImplementation,
			});
		},

		sendHeartbeat(payload) {
			return requestJson<OfficialWebControlPlaneHeartbeatResponse>({
				baseUrl: env.appApiBaseUrl,
				serviceToken: env.serviceToken,
				path: `/api/official-web/runs/${payload.runId}/heartbeats`,
				body: {
					sequence: payload.sequence,
					observedAt: payload.observedAt,
					counts: payload.counts,
				},
				traceId: payload.traceId,
				fetchImplementation,
			});
		},

		finalizeRun(payload) {
			return requestJson<OfficialWebControlPlaneFinalizeResponse>({
				baseUrl: env.appApiBaseUrl,
				serviceToken: env.serviceToken,
				path: `/api/official-web/runs/${payload.runId}/finalize`,
				body: {
					terminalStatus: payload.terminalStatus,
					finishedAt: payload.finishedAt,
					pageObservations: payload.pageObservations ?? [],
					summary: payload.summary,
					artifacts: payload.artifacts,
				},
				traceId: payload.traceId,
				fetchImplementation,
			});
		},

		resolvePlan(payload: OfficialWebResolvePlanInput) {
			return requestJson<OfficialWebControlPlanePlanResponse>({
				baseUrl: env.appApiBaseUrl,
				serviceToken: env.serviceToken,
				path: "/api/official-web/plans:resolve",
				body: {
					hostFilter: payload.hostFilter,
					maxPagesPerHost: payload.maxPagesPerHost,
					maxTotalPages: payload.maxTotalPages,
					now: payload.now,
					runIntent: payload.runIntent,
					siteId: payload.siteId,
				},
				traceId: payload.traceId,
				fetchImplementation,
			});
		},
	};
}
