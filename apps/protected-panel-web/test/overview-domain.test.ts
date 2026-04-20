import { describe, expect, it } from "vitest";

import {
  buildQualityTrendSeries,
  resolveOverviewGranularity,
} from "../src/panel/pages/overview-domain";

describe("operator overview domain helpers", () => {
  it("maps overview window to the expected default timeseries granularity", () => {
    expect(resolveOverviewGranularity("15m")).toBe("5m");
    expect(resolveOverviewGranularity("1h")).toBe("15m");
    expect(resolveOverviewGranularity("24h")).toBe("1h");
    expect(resolveOverviewGranularity("7d")).toBe("1d");
    expect(resolveOverviewGranularity("30d")).toBe("1d");
  });

  it("projects quality timeseries buckets into chart-friendly series points", () => {
    expect(
      buildQualityTrendSeries([
        {
          bucketEnd: "2026-04-20T09:00:00.000Z",
          bucketStart: "2026-04-20T08:00:00.000Z",
          citationMissRate: 0.2,
          emptyRecallRate: 0.1,
          needsClarificationRate: 0.05,
          noAnswerRate: 0.15,
          requestCount: 42,
          sampledGroundingPassRate: 0.85,
        },
      ]),
    ).toEqual([
      {
        bucketEnd: "2026-04-20T09:00:00.000Z",
        bucketStart: "2026-04-20T08:00:00.000Z",
        citationMissRatePct: 20,
        emptyRecallRatePct: 10,
        needsClarificationRatePct: 5,
        noAnswerRatePct: 15,
        requestCount: 42,
        sampledGroundingPassRatePct: 85,
      },
    ]);
  });
});
