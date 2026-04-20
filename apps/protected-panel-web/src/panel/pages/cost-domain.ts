import { formatSurfaceLabel } from "../requests/request-formatters";
import type {
  OperatorCostSummaryRecord,
  OperatorCostTimeseriesRecord,
} from "../types";

function toUsd(value: number) {
  return Number((value / 1_000_000).toFixed(4));
}

function toSharePct(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Number(((value / total) * 100).toFixed(1).replace(/\.0$/, ""));
}

export function buildCostTrendSeries(
  series: OperatorCostTimeseriesRecord["series"],
) {
  return series.map((point) => ({
    bucketEnd: point.bucketEnd,
    bucketStart: point.bucketStart,
    cachedInputTokens: point.cachedInputTokens,
    estimatedCostUsd: toUsd(point.estimatedCostMicrousd),
    inputTokens: point.inputTokens,
    outputTokens: point.outputTokens,
    totalTokens: point.inputTokens + point.outputTokens + point.cachedInputTokens,
  }));
}

export function buildCostModelDistributionEntries(
  entries: OperatorCostSummaryRecord["summary"]["byModel"],
) {
  const totalMicrousd = entries.reduce(
    (accumulator, entry) => accumulator + entry.estimatedCostMicrousd,
    0,
  );

  return entries.map((entry) => ({
    estimatedCostUsd: toUsd(entry.estimatedCostMicrousd),
    key: entry.modelName,
    label: entry.modelName,
    requestCount: entry.requestCount,
    sharePct: toSharePct(entry.estimatedCostMicrousd, totalMicrousd),
  }));
}

export function buildCostSurfaceDistributionEntries(
  entries: OperatorCostSummaryRecord["summary"]["bySurface"],
) {
  const totalMicrousd = entries.reduce(
    (accumulator, entry) => accumulator + entry.estimatedCostMicrousd,
    0,
  );

  return entries.map((entry) => ({
    estimatedCostUsd: toUsd(entry.estimatedCostMicrousd),
    key: entry.surface,
    label: formatSurfaceLabel(entry.surface),
    requestCount: entry.requestCount,
    sharePct: toSharePct(entry.estimatedCostMicrousd, totalMicrousd),
  }));
}
