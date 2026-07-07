import { createOverviewMetricHandlers } from "./metrics-overview";
import type { OperatorQueryRuntime } from "./runtime";

export function createMetricStoreHandlers(runtime: OperatorQueryRuntime) {
	return {
		...createOverviewMetricHandlers(runtime),
	};
}
