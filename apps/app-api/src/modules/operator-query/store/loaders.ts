import { and } from "drizzle-orm";

import { requestObservabilityFact } from "../../../db/schema";
import type { NormalizedOperatorOverviewFilters } from "../service";
import type { OperatorQueryRuntime } from "./runtime";
import { buildObservabilityConditions, resolveWindowBounds } from "./shared";

export async function loadObservabilityRows(
	runtime: OperatorQueryRuntime,
	filters: NormalizedOperatorOverviewFilters,
) {
	const db = await runtime.getDb();
	const bounds = resolveWindowBounds(filters.window, runtime.now());
	const rows = await db
		.select()
		.from(requestObservabilityFact)
		.where(and(...buildObservabilityConditions(filters, bounds)));

	return { bounds, rows };
}
