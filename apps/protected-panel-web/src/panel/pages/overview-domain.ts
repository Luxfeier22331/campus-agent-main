import type {
  OperatorOverviewWindow,
  OperatorQualityTimeseriesRecord,
} from "../types";

export function resolveOverviewGranularity(window: OperatorOverviewWindow) {
  switch (window) {
    case "15m":
      return "5m";
    case "1h":
      return "15m";
    case "24h":
      return "1h";
    case "7d":
    case "30d":
      return "1d";
    default:
      return "1h";
  }
}

function roundPercentage(value: number | null) {
  if (value === null) {
    return null;
  }

  return Number((value * 100).toFixed(1));
}

export function buildQualityTrendSeries(
  series: OperatorQualityTimeseriesRecord["series"],
) {
  return series.map((point) => ({
    bucketEnd: point.bucketEnd,
    bucketStart: point.bucketStart,
    citationMissRatePct: roundPercentage(point.citationMissRate),
    emptyRecallRatePct: roundPercentage(point.emptyRecallRate),
    needsClarificationRatePct: roundPercentage(point.needsClarificationRate),
    noAnswerRatePct: roundPercentage(point.noAnswerRate),
    requestCount: point.requestCount,
    sampledGroundingPassRatePct: roundPercentage(point.sampledGroundingPassRate),
  }));
}
