import { createRuntimeDatabase } from "../../../db/runtime";
import {
  metricRollup,
  qualityGradeProjection,
  requestObservabilityFact,
  traceBacklinkProjection,
} from "../../../db/schema";

export type RequestObservabilityFactRow = typeof requestObservabilityFact.$inferSelect;
export type MetricRollupRow = typeof metricRollup.$inferSelect;
export type QualityGradeProjectionRow = typeof qualityGradeProjection.$inferSelect;
export type TraceBacklinkProjectionRow = typeof traceBacklinkProjection.$inferSelect;
export type RuntimeDatabase = Awaited<ReturnType<typeof createRuntimeDatabase>>;
export type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export interface OperatorQueryRuntime {
  getDb: RuntimeDbGetter;
  now: () => Date;
}
