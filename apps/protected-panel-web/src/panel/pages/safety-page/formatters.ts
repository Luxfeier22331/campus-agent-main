import { PANEL_COPY, translateRuntimeErrorMessage } from "../../panel-copy";
import type { OperatorOverviewWindow, OperatorSafetySummaryRecord } from "../../types";
import { SAFETY_WINDOW_OPTIONS } from "./constants";

export type SafetySummaryCard = {
	detail: string;
	label: string;
	value: string;
};

export function normalizeFilterValue(value: string) {
	return value.trim() ? value : null;
}

export function formatSafetyWindowLabel(window: OperatorOverviewWindow) {
	return SAFETY_WINDOW_OPTIONS.find((option) => option.value === window)?.label ?? window;
}

export function toQueryErrorMessage(error: unknown, fallback: string) {
	if (!error || typeof error !== "object") {
		return fallback;
	}

	const maybeError = error as {
		body?: {
			error?: {
				code?: string | null;
				message?: string | null;
			};
		};
		message?: string | null;
		statusText?: string;
	};

	return translateRuntimeErrorMessage({
		code: maybeError.body?.error?.code,
		message: maybeError.body?.error?.message ?? maybeError.message,
		statusText: maybeError.statusText,
	});
}

export function buildDecisionSummaryCards(
	summary: OperatorSafetySummaryRecord["summary"],
): SafetySummaryCard[] {
	const entries = [
		{
			count: summary.decisionDistribution.allowed,
			label: "允许",
		},
		{
			count: summary.decisionDistribution.approvalRequired,
			label: PANEL_COPY.requestStatus.approval_required,
		},
		{
			count: summary.decisionDistribution.denied,
			label: "拒绝",
		},
		{
			count: summary.decisionDistribution.failClosed,
			label: "Fail Closed",
		},
	];
	const total = entries.reduce((accumulator, entry) => accumulator + entry.count, 0);

	return entries.map((entry) => ({
		detail:
			total > 0
				? `占比 ${((entry.count / total) * 100).toFixed(1)}% · 当前窗口共 ${total} 次授权决策`
				: PANEL_COPY.safetyPage.cards.noDecisionTraffic,
		label: entry.label,
		value: String(entry.count),
	}));
}

export function buildPostureHint(
	key: "aclAnomaly" | "failClosed" | "restrictedDeny",
	tone: string,
) {
	if (key === "failClosed") {
		return tone === "warning"
			? PANEL_COPY.safetyPage.posture.failClosedWarning
			: PANEL_COPY.safetyPage.posture.failClosedStable;
	}
	if (key === "restrictedDeny") {
		return tone === "info"
			? PANEL_COPY.safetyPage.posture.restrictedDenyActive
			: PANEL_COPY.safetyPage.posture.restrictedDenyQuiet;
	}

	return tone === "warning"
		? PANEL_COPY.safetyPage.posture.aclAnomalyWarning
		: PANEL_COPY.safetyPage.posture.aclAnomalyStable;
}
