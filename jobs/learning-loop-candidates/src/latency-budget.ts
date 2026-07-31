import budgetArtifact from "../../../configs/runtime/latency-budgets.v1.json";
import type { ImprovementCategory, LatencyBudgetBreach } from "./types";

const STAGE_TIMING_FIELDS = [
	"request.total_ms",
	"execution.dispatch_ms",
	"agent.schedule_to_start_ms",
	"stream.first_delta_persist_ms",
	"stream.app_api_ttft_ms",
	"stream.orchestration_overhead_ms",
	"execution.admission_ms",
	"grounding.prepare_ms",
	"memory.recall_ms",
	"agent.primary_ms",
	"agent.runtime_ms",
	"agent.first_delta_ms",
	"tool.total_ms",
	"finalization.write_ms",
	"projection.closeout_ms",
] as const;

interface LatencyBudgetRule {
	candidate_category: ImprovementCategory;
	candidate_reason: string;
	critical_ms: number;
	enabled: boolean;
	field: string;
	warn_ms: number;
}

interface LatencyBudgetArtifact {
	budget_version: string;
	rules: LatencyBudgetRule[];
	schema_version: "runtime-latency-budgets-v1";
}

const artifact = budgetArtifact as LatencyBudgetArtifact;

export const LATENCY_BUDGET_VERSION = artifact.budget_version;

const STAGE_TIMING_FIELD_SET = new Set<string>(STAGE_TIMING_FIELDS);

function validateLatencyBudgetArtifact(input: LatencyBudgetArtifact): void {
	if (input.schema_version !== "runtime-latency-budgets-v1") {
		throw new Error("latency budget schema_version must be runtime-latency-budgets-v1");
	}
	if (input.budget_version.trim() === "") {
		throw new Error("latency budget budget_version is required");
	}
	const enabledFields = new Set<string>();
	const reasons = new Set<string>();
	for (const [index, rule] of input.rules.entries()) {
		if (!STAGE_TIMING_FIELD_SET.has(rule.field)) {
			throw new Error(`latency budget rule ${index} uses non-canonical field ${rule.field}`);
		}
		if (rule.critical_ms <= rule.warn_ms) {
			throw new Error(`latency budget rule ${index} critical_ms must be greater than warn_ms`);
		}
		if (reasons.has(rule.candidate_reason)) {
			throw new Error(`latency budget duplicate candidate_reason ${rule.candidate_reason}`);
		}
		reasons.add(rule.candidate_reason);
		if (rule.enabled) {
			if (enabledFields.has(rule.field)) {
				throw new Error(`latency budget duplicate enabled field ${rule.field}`);
			}
			enabledFields.add(rule.field);
		}
	}
}

validateLatencyBudgetArtifact(artifact);

const rules = artifact.rules.filter((rule) => rule.enabled);

export function evaluateStageTimingBudget(
	stageTiming: Record<string, unknown> | null | undefined,
): {
	breaches: LatencyBudgetBreach[];
	worstBreach: LatencyBudgetBreach | null;
} {
	const breaches = rules.flatMap((rule): LatencyBudgetBreach[] => {
		const value = stageTiming?.[rule.field];
		if (!(typeof value === "number" && Number.isFinite(value) && value >= rule.warn_ms)) {
			return [];
		}
		const critical = value >= rule.critical_ms;
		return [
			{
				category: rule.candidate_category,
				durationMs: value,
				field: rule.field,
				reason: rule.candidate_reason,
				severity: critical ? "critical" : "warn",
				thresholdMs: critical ? rule.critical_ms : rule.warn_ms,
			},
		];
	});
	return {
		breaches,
		worstBreach:
			[...breaches].sort((left, right) => {
				if (left.severity !== right.severity) {
					return left.severity === "critical" ? -1 : 1;
				}
				return right.durationMs - left.durationMs;
			})[0] ?? null,
	};
}
