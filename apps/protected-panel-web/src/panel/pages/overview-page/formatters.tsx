import { Chip } from "@mui/material";

import { formatPanelMicrousd, PANEL_COPY, translateRuntimeErrorMessage } from "../../panel-copy";
import type {
	OperatorMetricRatio,
	OperatorOverviewRecord,
	OperatorOverviewWindow,
} from "../../types";
import { OVERVIEW_WINDOW_OPTIONS } from "./constants";

export function normalizeFilterValue(value: string) {
	return value.trim() ? value : null;
}

export function formatOverviewWindowLabel(window: OperatorOverviewWindow) {
	return OVERVIEW_WINDOW_OPTIONS.find((option) => option.value === window)?.label ?? window;
}

export function formatMetricRate(metric: OperatorMetricRatio) {
	return `${(metric.value * 100).toFixed(metric.value * 100 >= 10 ? 0 : 1)}%`;
}

export function formatMetricEvidence(metric: OperatorMetricRatio) {
	if (metric.eligibleCount === null) {
		return `${metric.count}`;
	}

	return `${metric.count} / ${metric.eligibleCount}`;
}

export function formatLatency(value: number | null) {
	if (value === null) {
		return PANEL_COPY.unknown;
	}

	if (value < 1000) {
		return `${value} ms`;
	}

	return `${(value / 1000).toFixed(2)} s`;
}

export function formatCount(value: number) {
	return new Intl.NumberFormat("zh-CN").format(value);
}

export function formatTrendBucketLabel(value: string) {
	return new Intl.DateTimeFormat("zh-CN", {
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		month: "numeric",
	}).format(new Date(value));
}

export function formatAlertTitle(code: string) {
	switch (code) {
		case "safety.provider_content_filter_spike":
			return "上游内容过滤激增";
		case "safety.rate_limit_exceeded":
			return "限流错误升高";
		case "safety.remote_content_suspicion_spike":
			return "远程内容风险激增";
		default:
			return code;
	}
}

export function formatAlertSeverity(severity: string) {
	switch (severity) {
		case "high":
			return "高";
		case "medium":
			return "中";
		default:
			return severity;
	}
}

export function formatAlertDomain(domain: string) {
	if (domain === "safety") {
		return "安全";
	}

	return domain;
}

export function formatPrincipalClass(value: string) {
	if (value === "human") {
		return "人工运维";
	}

	return value;
}

export function renderDomainStatus(status: string) {
	if (status === "ready") {
		return <Chip color="success" label={PANEL_COPY.domainStatus.ready} size="small" />;
	}
	if (status === "deferred") {
		return (
			<Chip
				color="warning"
				label={PANEL_COPY.domainStatus.deferred}
				size="small"
				variant="outlined"
			/>
		);
	}

	return (
		<Chip color="default" label={PANEL_COPY.domainStatus.blocked} size="small" variant="outlined" />
	);
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

export function buildOverviewCards(record: OperatorOverviewRecord) {
	return [
		{
			detail: `${PANEL_COPY.overviewPage.cardDetail.completed} ${formatCount(
				record.overview.requestVolume.completed,
			)} · ${PANEL_COPY.overviewPage.cardDetail.errored} ${formatCount(
				record.overview.requestVolume.errored,
			)}`,
			label: PANEL_COPY.overviewPage.cards.requestVolume,
			value: formatCount(record.overview.requestVolume.accepted),
		},
		{
			detail: `${PANEL_COPY.overviewPage.cardDetail.p95} ${formatLatency(
				record.overview.latency.p95Ms,
			)} · ${PANEL_COPY.overviewPage.cardDetail.p99} ${formatLatency(
				record.overview.latency.p99Ms,
			)}`,
			label: PANEL_COPY.overviewPage.cards.latency,
			value: `${PANEL_COPY.overviewPage.cardDetail.p50} ${formatLatency(
				record.overview.latency.p50Ms,
			)}`,
		},
		{
			detail: formatMetricEvidence(record.overview.failureRate),
			label: PANEL_COPY.overviewPage.cards.failureRate,
			value: formatMetricRate(record.overview.failureRate),
		},
		{
			detail: formatMetricEvidence(record.overview.emptyRecallRate),
			label: PANEL_COPY.overviewPage.cards.emptyRecallRate,
			value: formatMetricRate(record.overview.emptyRecallRate),
		},
		{
			detail: formatMetricEvidence(record.overview.citationMissRate),
			label: PANEL_COPY.overviewPage.cards.citationMissRate,
			value: formatMetricRate(record.overview.citationMissRate),
		},
		{
			detail: formatMetricEvidence(record.overview.refusalRate),
			label: PANEL_COPY.overviewPage.cards.refusalRate,
			value: formatMetricRate(record.overview.refusalRate),
		},
		{
			detail: formatMetricEvidence(record.overview.aclAnomalyRate),
			label: PANEL_COPY.overviewPage.cards.aclAnomalyRate,
			value: formatMetricRate(record.overview.aclAnomalyRate),
		},
		{
			detail: record.overview.estimatedCost.currency,
			label: PANEL_COPY.overviewPage.cards.estimatedCost,
			value: formatPanelMicrousd(record.overview.estimatedCost.microusd),
		},
		{
			detail: `${PANEL_COPY.overviewPage.cardDetail.projectionFailureCount} ${formatCount(
				record.overview.sinkHealth.projectionFailureCount,
			)} · ${PANEL_COPY.overviewPage.cardDetail.outboxPendingCount} ${formatCount(
				record.overview.sinkHealth.outboxPendingCount,
			)} · ${PANEL_COPY.overviewPage.cardDetail.outboxStaleCount} ${formatCount(
				record.overview.sinkHealth.outboxStaleCount,
			)}`,
			label: PANEL_COPY.overviewPage.cards.sinkHealth,
			value: `${PANEL_COPY.overviewPage.cardDetail.missingTraceRate} ${formatMetricRate(
				record.overview.sinkHealth.missingTraceRate,
			)} · ${PANEL_COPY.overviewPage.cardDetail.outboxRetryCount} ${formatCount(
				record.overview.sinkHealth.outboxRetryCount,
			)}`,
		},
	];
}
