import { PANEL_COPY, translateRuntimeErrorMessage } from "../../panel-copy";
import type {
	OperatorMetricRatio,
	OperatorOverviewWindow,
	OperatorQualitySummaryRecord,
} from "../../types";
import { buildRefusalDistributionEntries } from "../quality-domain";
import { QUALITY_WINDOW_OPTIONS } from "./constants";

export interface QualitySummaryCard {
	detail: string;
	label: string;
	value: string;
}

export function normalizeFilterValue(value: string) {
	return value.trim() ? value : null;
}

function formatMetricRate(metric: OperatorMetricRatio | null) {
	if (!metric) {
		return PANEL_COPY.unknown;
	}

	return `${(metric.value * 100).toFixed(metric.value * 100 >= 10 ? 0 : 1)}%`;
}

function formatMetricEvidence(metric: OperatorMetricRatio | null) {
	if (!metric) {
		return PANEL_COPY.unknown;
	}

	if (metric.eligibleCount === null) {
		return `${metric.count}`;
	}

	return `${metric.count} / ${metric.eligibleCount}`;
}

export function formatGradeScore(score: number | null) {
	if (score === null) {
		return PANEL_COPY.unknown;
	}

	return score.toFixed(2);
}

export function formatQualityWindowLabel(window: OperatorOverviewWindow) {
	return QUALITY_WINDOW_OPTIONS.find((option) => option.value === window)?.label ?? window;
}

export function formatTrendBucketLabel(value: string) {
	return new Intl.DateTimeFormat("zh-CN", {
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		month: "numeric",
	}).format(new Date(value));
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

export function buildRuntimeSummaryCards(
	record: OperatorQualitySummaryRecord,
): QualitySummaryCard[] {
	const refusalEntries = buildRefusalDistributionEntries(record.runtime.refusalDistribution);

	return [
		{
			detail: refusalEntries.map((entry) => `${entry.label} ${entry.count}`).join(" · "),
			label: PANEL_COPY.qualityPage.cards.requestCount,
			value: String(record.runtime.requestCount),
		},
		{
			detail: formatMetricEvidence(record.runtime.emptyRecallRate),
			label: PANEL_COPY.qualityPage.cards.emptyRecallRate,
			value: formatMetricRate(record.runtime.emptyRecallRate),
		},
		{
			detail: formatMetricEvidence(record.runtime.citationMissRate),
			label: PANEL_COPY.qualityPage.cards.citationMissRate,
			value: formatMetricRate(record.runtime.citationMissRate),
		},
	];
}

export function buildSampledCards(record: OperatorQualitySummaryRecord): QualitySummaryCard[] {
	if (!record.sampledGrades) {
		return [];
	}

	return [
		{
			detail: formatMetricEvidence(record.sampledGrades.groundingPassRate),
			label: PANEL_COPY.qualityPage.cards.groundingPassRate,
			value: formatMetricRate(record.sampledGrades.groundingPassRate),
		},
		{
			detail: formatMetricEvidence(record.sampledGrades.citationPassRate),
			label: PANEL_COPY.qualityPage.cards.citationPassRate,
			value: formatMetricRate(record.sampledGrades.citationPassRate),
		},
		{
			detail: formatMetricEvidence(record.sampledGrades.policyPassRate),
			label: PANEL_COPY.qualityPage.cards.policyPassRate,
			value: formatMetricRate(record.sampledGrades.policyPassRate),
		},
		{
			detail: formatMetricEvidence(record.sampledGrades.coverageRate),
			label: PANEL_COPY.qualityPage.cards.coverageRate,
			value: formatMetricRate(record.sampledGrades.coverageRate),
		},
		{
			detail: PANEL_COPY.qualityPage.cardDetail.sampledGradesMissing,
			label: PANEL_COPY.qualityPage.cards.badcaseOpenCount,
			value: String(record.sampledGrades.badcaseOpenCount ?? 0),
		},
	];
}
