import { createIntentMetricHandlers } from "./metrics-intent";
import { createOverviewMetricHandlers } from "./metrics-overview";
import { createQualityMetricHandlers } from "./metrics-quality";
import { createSafetyCostMetricHandlers } from "./metrics-safety-cost";
import type { OperatorQueryRuntime } from "./runtime";

export function createMetricStoreHandlers(runtime: OperatorQueryRuntime) {
	return {
		...createOverviewMetricHandlers(runtime),
		...createQualityMetricHandlers(runtime),
		...createIntentMetricHandlers(runtime),
		...createSafetyCostMetricHandlers(runtime),
	};
}
