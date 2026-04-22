import { AppApiRouteError } from "../../http";
import type { OfficialWebCollectorPrincipal } from "../auth";
import type { OfficialWebTerminalRunStatus, StoredOfficialWebRun } from "./store";

export function buildStartResponse(run: StoredOfficialWebRun, heartbeatIntervalSeconds: number) {
	return {
		run: {
			heartbeatIntervalSeconds,
			runId: run.runId,
			siteId: run.siteId,
			startedAt: run.startedAt,
			status: run.status,
		},
	};
}

export function buildHeartbeatResponse(run: StoredOfficialWebRun) {
	return {
		run: {
			lastHeartbeatAt: run.lastHeartbeatAt,
			runId: run.runId,
			status: run.status,
		},
	};
}

export function buildFinalizeResponse(run: StoredOfficialWebRun) {
	return {
		run: {
			finishedAt: run.finishedAt,
			ingestionDispatchStatus: run.ingestionDispatchStatus,
			runId: run.runId,
			status: run.status,
		},
	};
}

export function requireCollectorPrincipal(principal: OfficialWebCollectorPrincipal): void {
	if (principal.kind !== "service" || principal.serviceClass !== "official_web_collector") {
		throw new AppApiRouteError({
			code: "forbidden",
			message: "Official web collector access is not available for this principal.",
			retryable: false,
			status: 403,
		});
	}
}

export function ensureRunExists(
	run: StoredOfficialWebRun | null,
	runId: string,
): StoredOfficialWebRun {
	if (run) {
		return run;
	}

	throw new AppApiRouteError({
		code: "run_not_found",
		details: { runId },
		message: "Official web run not found.",
		retryable: false,
		status: 404,
	});
}

export function buildTerminalEventType(status: OfficialWebTerminalRunStatus): string {
	return `official_web.run.${status}`;
}
