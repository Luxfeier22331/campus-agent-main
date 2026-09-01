import { NOTICE_CATEGORIES, type NoticeCategory } from "@campus-agent/notices";
import type { NoticeClassificationTask } from "notice-classifier-core/batch";

export const BALANCED_DIAGNOSTIC_PROFILE = "balanced_diagnostic_v1";
export const RANDOM_DIAGNOSTIC_PROFILE = "random_diagnostic_v1";

export type ConcreteNoticeCategory = Exclude<NoticeCategory, "unclassified">;

export const CONCRETE_CATEGORIES = NOTICE_CATEGORIES.filter(
	(category): category is ConcreteNoticeCategory => category !== "unclassified",
);
export const CONCRETE_CATEGORY_SET = new Set<string>(CONCRETE_CATEGORIES);
export const CATEGORY_SET = new Set<string>(NOTICE_CATEGORIES);

export type EvalProfile = typeof BALANCED_DIAGNOSTIC_PROFILE | typeof RANDOM_DIAGNOSTIC_PROFILE;
export type EvalSplit = "balanced" | "random" | "regression";
export type EvalReviewGroup =
	| "category_consensus"
	| "category_disagreement"
	| "regression"
	| "random";
export type PredictionStatus = "invalid_output" | "ok" | "provider_error";

export interface EvalSample {
	notice_id: number;
	notice_title: string;
	review_group: EvalReviewGroup;
	split: EvalSplit;
}

export interface LabelGoldEntry {
	category: NoticeCategory;
	notice_id: number;
}

export interface EvalPrediction {
	attempt: 1;
	category: NoticeCategory | null;
	elapsed_ms: number;
	error?: string;
	model: string;
	notice_id: number;
	raw_response?: string;
	repeat: 1 | 2 | 3;
	status: PredictionStatus;
}

export type StratificationPrediction = EvalPrediction;

export interface EvalSampleOptions {
	categoryCount: number;
	categoryCountOverrides?: Partial<Record<ConcreteNoticeCategory, number>>;
	randomCount: number;
	seed: string;
	stratificationModels: readonly string[];
}

export interface RegressionCase {
	boundary_group: string;
	notice_id: number;
	notice_title: string;
	product_expected_category: NoticeCategory;
	rationale: string;
}

export interface CategoryAgreementMetrics {
	agreed: number;
	agreement_rate: number | null;
	confusion: Record<string, Record<string, number>>;
	invalid_output_count: number;
	macro_f1: number | null;
	per_category: Record<
		string,
		{ f1: number | null; precision: number | null; recall: number | null; support: number }
	>;
	provider_error_count: number;
	scoreable: number;
}

export interface ModelOutcomeMetrics {
	invalid_output_count: number;
	ok_count: number;
	provider_error_count: number;
	provider_error_rate: number | null;
	response_received_count: number;
	response_valid_rate: number | null;
	total_task_count: number;
}

export interface RepeatMetrics {
	repeat_complete_count: number;
	repeat_incomplete_count: number;
	selected_repeat_consistency: number | null;
	stable_complete_count: number;
}

export interface ModelEvaluationMetrics {
	latency_p50_ms: number | null;
	latency_p90_ms: number | null;
	outcomes: ModelOutcomeMetrics;
	repeat: RepeatMetrics;
}

export interface AgreementBySample {
	all: Record<string, CategoryAgreementMetrics>;
	balanced: Record<string, CategoryAgreementMetrics>;
	random: Record<string, CategoryAgreementMetrics>;
}

export interface CandidateEvaluationReport {
	agreement: AgreementBySample;
	generated_at: string;
	models: Record<string, ModelEvaluationMetrics>;
	profile: EvalProfile;
}

export interface CandidateEvaluationCheckResult extends CandidateEvaluationReport {
	evidence_status: "complete" | "partial";
}

export interface RegressionRepeatResult {
	category: NoticeCategory | null;
	matches_product_expected: boolean | null;
	status: PredictionStatus;
}

export interface RegressionModelCaseResult {
	primary: RegressionRepeatResult;
	repeat_complete: boolean | null;
	repeat_results: RegressionRepeatResult[];
	stable_complete: boolean | null;
}

export interface RegressionCaseResult {
	boundary_group: string;
	models: Record<string, RegressionModelCaseResult>;
	notice_id: number;
	notice_title: string;
	product_expected_category: NoticeCategory;
}

export interface RegressionEvaluationCheckResult {
	candidate_models: string[];
	cases: RegressionCaseResult[];
	evidence_status: "complete" | "partial";
	models: Record<
		string,
		{
			outcomes: ModelOutcomeMetrics;
			primary_agreement: { agreed: number; rate: number | null; scoreable: number };
			repeat: RepeatMetrics;
		}
	>;
	regression_case_count: number;
	stability_case_count: number;
}

export interface StratificationSummary {
	categories: ReadonlySet<NoticeCategory>;
	consensus: NoticeCategory | null;
	disagreement: boolean;
}

export interface SelectedInput {
	input: NoticeClassificationTask;
	reviewGroup: EvalReviewGroup;
}
