import { createHash } from "node:crypto";

import { formatOperatorCapabilitySummaryLabel } from "../../operator-target-labels";
import {
	buildIncidentBackfillHint,
	SAFETY_ALERT_LOOKBACK_MS,
	SAFETY_ALERT_THRESHOLD,
	type SafetyAlertCode,
} from "../../safety-ops-policy";
import type { OperatorOverviewAlert } from "../service";
import type { RequestObservabilityFactRow } from "./runtime";

function buildSafetyAlertId(input: {
	code: SafetyAlertCode;
	safetyIdentifier: string;
	startedAt: string;
}): string {
	return `opalert_${createHash("sha256")
		.update(`${input.code}:${input.safetyIdentifier}:${input.startedAt}`)
		.digest("hex")
		.slice(0, 16)}`;
}

export function buildSafetyAnomalyId(input: { anomalyCode: string; requestId: string }): string {
	return `aclanom_${createHash("sha256")
		.update(`${input.anomalyCode}:${input.requestId}`)
		.digest("hex")
		.slice(0, 16)}`;
}

export function inferSafetyAnomalySeverity(
	row: Pick<RequestObservabilityFactRow, "aclAnomalyCode" | "failClosed">,
): "high" | "medium" {
	const code = row.aclAnomalyCode ?? "";

	if (
		row.failClosed === true ||
		code.includes("projection_missing") ||
		code.includes("projection_conflict") ||
		code.includes("fail_open") ||
		code.includes("unauthorized")
	) {
		return "high";
	}

	return "medium";
}

export function summarizeSafetyAnomaly(
	row: Pick<
		RequestObservabilityFactRow,
		"aclAnomalyCode" | "failClosed" | "requestedCapability" | "selectedCapability" | "status"
	>,
): string {
	const capability = row.requestedCapability ?? "request";
	const target = formatOperatorCapabilitySummaryLabel(row.selectedCapability);

	switch (row.aclAnomalyCode) {
		case "projection_missing":
			return `${capability} request finalized without the required policy projection for ${target}.`;
		case "projection_conflict":
			return `${capability} request recorded a policy projection conflict for ${target}.`;
		case "fail_open_suspected":
			return `${capability} request shows a suspected fail-open authorization path for ${target}.`;
		default:
			if (row.failClosed === true) {
				return `${capability} request fail-closed with ACL anomaly ${row.aclAnomalyCode ?? "unknown"}.`;
			}
			return `${capability} request recorded ACL anomaly ${row.aclAnomalyCode ?? "unknown"} for ${target}.`;
	}
}

function hasRemoteContentSuspicionSignal(row: RequestObservabilityFactRow): boolean {
	const summary = row.remoteContentSuspicionSummaryJson;
	if (!summary) {
		return false;
	}

	return summary.generationBlocked === true || summary.flagLabels.length > 0;
}

function hasProviderContentFilterSignal(row: RequestObservabilityFactRow): boolean {
	return (
		row.promptRuntimeState === "content_filter" || row.promptRuntimeDetail === "content_filter"
	);
}

export function buildSafetyAlerts(input: {
	asOf: Date;
	rows: RequestObservabilityFactRow[];
}): OperatorOverviewAlert[] {
	const alertWindowStart = input.asOf.valueOf() - SAFETY_ALERT_LOOKBACK_MS;
	const alerts: OperatorOverviewAlert[] = [];
	const definitions: Array<{
		code: SafetyAlertCode;
		severity: "high" | "medium";
		signal: (row: RequestObservabilityFactRow) => boolean;
	}> = [
		{
			code: "safety.rate_limit_exceeded",
			severity: "medium",
			signal: (row) => row.errorCode === "rate_limit_exceeded",
		},
		{
			code: "safety.remote_content_suspicion_spike",
			severity: "high",
			signal: hasRemoteContentSuspicionSignal,
		},
		{
			code: "safety.provider_content_filter_spike",
			severity: "high",
			signal: hasProviderContentFilterSignal,
		},
	];

	for (const definition of definitions) {
		const rowsBySafetyIdentifier = new Map<string, RequestObservabilityFactRow[]>();
		for (const row of input.rows) {
			if (!row.safetyIdentifier) {
				continue;
			}
			if (row.startedAt.valueOf() < alertWindowStart) {
				continue;
			}
			if (!definition.signal(row)) {
				continue;
			}

			const bucket = rowsBySafetyIdentifier.get(row.safetyIdentifier) ?? [];
			bucket.push(row);
			rowsBySafetyIdentifier.set(row.safetyIdentifier, bucket);
		}

		for (const [safetyIdentifier, matchingRows] of rowsBySafetyIdentifier.entries()) {
			if (matchingRows.length < SAFETY_ALERT_THRESHOLD) {
				continue;
			}
			const earliestRow = matchingRows[0];
			if (!earliestRow) {
				continue;
			}

			const earliestStartedAt = matchingRows.reduce(
				(earliest, row) =>
					row.startedAt.valueOf() < earliest.valueOf() ? row.startedAt : earliest,
				earliestRow.startedAt,
			);
			alerts.push({
				alertId: buildSafetyAlertId({
					code: definition.code,
					safetyIdentifier,
					startedAt: earliestStartedAt.toISOString(),
				}),
				code: definition.code,
				domain: "safety",
				incidentBackfill: buildIncidentBackfillHint(definition.code),
				requestCount: matchingRows.length,
				severity: definition.severity,
				startedAt: earliestStartedAt.toISOString(),
				status: "open",
			});
		}
	}

	const severityRank = {
		high: 2,
		medium: 1,
	} as const;

	return alerts.sort(
		(left, right) =>
			severityRank[right.severity as keyof typeof severityRank] -
				severityRank[left.severity as keyof typeof severityRank] ||
			right.startedAt.localeCompare(left.startedAt) ||
			left.code.localeCompare(right.code),
	);
}
