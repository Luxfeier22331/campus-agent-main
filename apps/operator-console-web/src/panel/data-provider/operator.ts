import { fetchJson } from "../http";
import {
	normalizeOperatorOverviewRecord,
	normalizeOperatorRuntimeHealthRecord,
	type OperatorAggregateFilterInput,
	type OperatorOverviewRecord,
	type OperatorRuntimeHealthRecord,
	type RawOperatorOverviewRecord,
	type RawOperatorRuntimeHealthRecord,
} from "../types";
import { appendOperatorAggregateFilters } from "./filters";

export async function getOperatorOverview(
	input?: OperatorAggregateFilterInput & { signal?: AbortSignal },
): Promise<{ data: OperatorOverviewRecord }> {
	const query = new URLSearchParams();
	appendOperatorAggregateFilters(query, input);

	const payload = await fetchJson<RawOperatorOverviewRecord>(
		`/api/operator/overview?${query.toString()}`,
		{
			signal: input?.signal,
		},
	);

	return {
		data: normalizeOperatorOverviewRecord(payload),
	};
}

export async function getOperatorRuntimeHealth(input?: {
	signal?: AbortSignal;
}): Promise<{ data: OperatorRuntimeHealthRecord }> {
	const payload = await fetchJson<RawOperatorRuntimeHealthRecord>("/api/operator/runtime/health", {
		signal: input?.signal,
	});

	return {
		data: normalizeOperatorRuntimeHealthRecord(payload),
	};
}
