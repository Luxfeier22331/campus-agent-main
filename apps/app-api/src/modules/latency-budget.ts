import budgetArtifact from "../../../../configs/runtime/latency-budgets.v1.json";
import {
	STAGE_TIMING_FIELDS,
	type StageTimingField,
} from "./integration/execution-finalization-contract";

export type LatencyBudgetSeverity = "warn" | "critical";
export type StageTimingBudgetState = "within_budget" | LatencyBudgetSeverity;

export interface LatencyBudgetBreach {
	durationMs: number;
	field: StageTimingField;
	severity: LatencyBudgetSeverity;
	thresholdMs: number;
}

export interface LatencyBudgetEvaluation {
	breaches: LatencyBudgetBreach[];
	version: string;
	worstBreach: LatencyBudgetBreach | null;
}

export interface StageTimingBudgetProjection {
	budgetState: StageTimingBudgetState;
	budgetVersion: string;
	criticalMs: number;
	durationMs: number;
	warnMs: number;
}

interface LatencyBudgetRule {
	critical_ms: number;
	field: StageTimingField;
	warn_ms: number;
}

interface LatencyBudgetArtifact {
	budget_version: string;
	rules: LatencyBudgetRule[];
	schema_version: "runtime-latency-budgets-v1";
}

const latencyBudgetArtifact = budgetArtifact as LatencyBudgetArtifact;

export const LATENCY_BUDGET_VERSION = latencyBudgetArtifact.budget_version;

const STAGE_TIMING_FIELD_SET = new Set<string>(STAGE_TIMING_FIELDS);

function validateLatencyBudgetArtifact(artifact: LatencyBudgetArtifact): void {
	if (artifact.schema_version !== "runtime-latency-budgets-v1") {
		throw new Error("latency budget schema_version must be runtime-latency-budgets-v1");
	}
	if (artifact.budget_version.trim() === "") {
		throw new Error("latency budget budget_version is required");
	}
	const enabledFields = new Set<string>();
	for (const [index, rule] of artifact.rules.entries()) {
		if (!STAGE_TIMING_FIELD_SET.has(rule.field)) {
			throw new Error(`latency budget rule ${index} uses non-canonical field ${rule.field}`);
		}
		if (rule.critical_ms <= rule.warn_ms) {
			throw new Error(`latency budget rule ${index} critical_ms must be greater than warn_ms`);
		}
		if (enabledFields.has(rule.field)) {
			throw new Error(`latency budget duplicate field ${rule.field}`);
		}
		enabledFields.add(rule.field);
	}
}

validateLatencyBudgetArtifact(latencyBudgetArtifact);

export const LATENCY_BUDGET_RULES = latencyBudgetArtifact.rules;
const LATENCY_BUDGET_RULE_BY_FIELD = new Map(
	LATENCY_BUDGET_RULES.map((rule) => [rule.field, rule] as const),
);

export function isStageTimingField(field: string): field is StageTimingField {
	return STAGE_TIMING_FIELD_SET.has(field);
}

export function evaluateStageTimingBudget(
	stageTiming: Record<string, unknown> | null | undefined,
): LatencyBudgetEvaluation {
	const breaches: LatencyBudgetBreach[] = [];
	for (const rule of LATENCY_BUDGET_RULES) {
		const value = stageTiming?.[rule.field];
		if (!(typeof value === "number" && Number.isFinite(value) && value >= rule.warn_ms)) {
			continue;
		}
		const critical = value >= rule.critical_ms;
		breaches.push({
			durationMs: value,
			field: rule.field,
			severity: critical ? "critical" : "warn",
			thresholdMs: critical ? rule.critical_ms : rule.warn_ms,
		});
	}
	return {
		breaches,
		version: LATENCY_BUDGET_VERSION,
		worstBreach: worstLatencyBudgetBreach(breaches),
	};
}

export function stageTimingBudgetState(field: string, durationMs: number): StageTimingBudgetState {
	const rule = LATENCY_BUDGET_RULE_BY_FIELD.get(field as StageTimingField);
	if (!rule) {
		return "within_budget";
	}
	if (durationMs >= rule.critical_ms) {
		return "critical";
	}
	if (durationMs >= rule.warn_ms) {
		return "warn";
	}
	return "within_budget";
}

export function projectStageTimingBudget(
	stageTiming: Record<string, unknown> | null | undefined,
): Partial<Record<StageTimingField, StageTimingBudgetProjection>> {
	const output: Partial<Record<StageTimingField, StageTimingBudgetProjection>> = {};
	for (const [field, durationMs] of Object.entries(stageTiming ?? {})) {
		if (
			!(
				isStageTimingField(field) &&
				typeof durationMs === "number" &&
				Number.isFinite(durationMs) &&
				durationMs >= 0
			)
		) {
			continue;
		}
		const rule = LATENCY_BUDGET_RULE_BY_FIELD.get(field);
		if (!rule) {
			continue;
		}
		output[field] = {
			budgetState: stageTimingBudgetState(field, durationMs),
			budgetVersion: LATENCY_BUDGET_VERSION,
			criticalMs: rule.critical_ms,
			durationMs,
			warnMs: rule.warn_ms,
		};
	}
	return output;
}

function worstLatencyBudgetBreach(breaches: LatencyBudgetBreach[]): LatencyBudgetBreach | null {
	return (
		[...breaches].sort((left, right) => {
			if (left.severity !== right.severity) {
				return left.severity === "critical" ? -1 : 1;
			}
			return right.durationMs - left.durationMs;
		})[0] ?? null
	);
}
