export const OPS_STAGE_TIMING_BUDGETS = [
	{ criticalMs: 15_000, field: "request.total_ms", warnMs: 8_000 },
	{ criticalMs: 5_000, field: "stream.browser_ttft_ms", warnMs: 2_500 },
	{ criticalMs: 1_500, field: "execution.admission_ms", warnMs: 500 },
	{ criticalMs: 2_000, field: "memory.recall_ms", warnMs: 800 },
	{ criticalMs: 14_000, field: "agent.primary_ms", warnMs: 7_000 },
	{ criticalMs: 12_000, field: "agent.runtime_ms", warnMs: 6_000 },
	{ criticalMs: 4_500, field: "agent.first_delta_ms", warnMs: 2_000 },
	{ criticalMs: 12_000, field: "tool.total_ms", warnMs: 6_000 },
	{ criticalMs: 12_000, field: "tool.knowledge_query_ms", warnMs: 6_000 },
	{ criticalMs: 8_000, field: "tool.transport_schedule_lookup_ms", warnMs: 3_000 },
	{ criticalMs: 8_000, field: "tool.campus_notice_discover_ms", warnMs: 3_000 },
	{ criticalMs: 2_000, field: "rag.plan_ms", warnMs: 800 },
	{ criticalMs: 3_500, field: "rag.lookup_ms", warnMs: 1_500 },
	{ criticalMs: 3_500, field: "rag.rerank_ms", warnMs: 1_500 },
	{ criticalMs: 10_000, field: "rag.synthesis_ms", warnMs: 5_000 },
	{ criticalMs: 3_500, field: "rag.grounding_ms", warnMs: 1_500 },
	{ criticalMs: 1_500, field: "finalization.write_ms", warnMs: 500 },
	{ criticalMs: 3_000, field: "projection.closeout_ms", warnMs: 1_000 },
] as const;

export type OpsStageTimingField = (typeof OPS_STAGE_TIMING_BUDGETS)[number]["field"];
export type OpsStageTimingBudgetState = "OK" | "WARN" | "BREACH";

const OPS_STAGE_TIMING_BUDGET_BY_FIELD = new Map(
	OPS_STAGE_TIMING_BUDGETS.map((rule) => [rule.field, rule] as const),
);

export function isOpsStageTimingField(field: string): field is OpsStageTimingField {
	return OPS_STAGE_TIMING_BUDGET_BY_FIELD.has(field as OpsStageTimingField);
}

export function projectOpsStageTiming(
	value: unknown,
): Partial<Record<OpsStageTimingField, number>> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	const projected: Partial<Record<OpsStageTimingField, number>> = {};
	for (const [field, durationMs] of Object.entries(value)) {
		if (
			isOpsStageTimingField(field) &&
			typeof durationMs === "number" &&
			Number.isFinite(durationMs) &&
			durationMs >= 0
		) {
			projected[field] = durationMs;
		}
	}
	return projected;
}

export function projectOpsStageTimingBudget(
	value: unknown,
): Partial<Record<OpsStageTimingField, OpsStageTimingBudgetState>> {
	const stageTiming = projectOpsStageTiming(value);
	const projected: Partial<Record<OpsStageTimingField, OpsStageTimingBudgetState>> = {};
	for (const [field, durationMs] of Object.entries(stageTiming) as [
		OpsStageTimingField,
		number,
	][]) {
		projected[field] = projectOpsStageTimingBudgetState(field, durationMs);
	}
	return projected;
}

function projectOpsStageTimingBudgetState(
	field: OpsStageTimingField,
	durationMs: number,
): OpsStageTimingBudgetState {
	const rule = OPS_STAGE_TIMING_BUDGET_BY_FIELD.get(field);
	if (!rule || durationMs < rule.warnMs) {
		return "OK";
	}
	return durationMs >= rule.criticalMs ? "BREACH" : "WARN";
}
