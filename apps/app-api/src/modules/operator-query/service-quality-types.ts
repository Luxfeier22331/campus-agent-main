import type { EvalDiagnosticTrajectoryAttribution } from "../operator-eval-diagnostic-badcases";
import type {
	MetricRatio,
	OperatorDistributionBucket,
	OperatorOverviewWindow,
	OperatorResultWindow,
} from "./service-metric-types";

export interface OperatorQualityTimeseriesResult {
	window: OperatorResultWindow;
	series: Array<{
		bucketStart: string;
		bucketEnd: string;
		requestCount: number;
		emptyRecallRate: number;
		citationMissRate: number;
		noAnswerRate: number;
		needsClarificationRate: number;
		sampledGroundingPassRate: number | null;
		feedbackEligibleAnswerCount: number;
		feedbackCount: number;
		feedbackCoverageRate: number;
		feedbackHelpfulCount: number;
		feedbackHelpfulRate: number;
		feedbackUnhelpfulCount: number;
		feedbackUnhelpfulRate: number;
		feedbackNoAnswerEligibleCount: number;
		feedbackNoAnswerUnhelpfulCount: number;
		feedbackNoAnswerUnhelpfulRate: number;
	}>;
	asOf: string;
}

export interface OperatorQualityBadcaseListFilters {
	limit?: number | null;
	cursor?: string | null;
	window?: string | null;
	surface?: string | null;
	selectedCapability?: string | null;
	status?: string | null;
	causeClass?: string | null;
	detectedBy?: string | null;
}

export interface NormalizedOperatorQualityBadcaseListFilters {
	limit: number;
	cursor: string | null;
	window: OperatorOverviewWindow | null;
	surface: string | null;
	selectedCapability: string | null;
	status: string | null;
	causeClass: string | null;
	detectedBy: string | null;
}

export interface OperatorQualityBadcaseListResult {
	badcases: Array<{
		badcaseId: string;
		requestId: string;
		runId: string | null;
		traceId: string;
		surface: string;
		selectedCapability: string | null;
		status: string;
		causeClass: string;
		diagnosisStage:
			| "routing"
			| "planning"
			| "tool"
			| "retrieval"
			| "rerank"
			| "selection"
			| "synthesis"
			| "grounding"
			| "finalization";
		detectedBy: string;
		openedAt: string;
		summary: string;
		grade: {
			result: string;
			score: number | null;
			graderVersion: string;
		} | null;
		links: {
			traceLink: string | null;
			issueLink: string | null;
			issueFingerprint: string | null;
		};
	}>;
	page: {
		nextCursor: string | null;
	};
}

export interface OperatorQualityEvalCandidateListResult {
	candidates: Array<{
		candidateId: string;
		requestId: string | null;
		runId: string | null;
		traceId: string | null;
		surface: string;
		selectedCapability: string | null;
		causeClass: string;
		diagnosisStage:
			| "routing"
			| "planning"
			| "tool"
			| "retrieval"
			| "rerank"
			| "selection"
			| "synthesis"
			| "grounding"
			| "finalization";
		summary: string;
		grade: {
			result: string;
			score: number | null;
			graderVersion: string;
		} | null;
		correlation?: {
			conversationId: string;
			assistantMessageId: string;
			answerKind: string;
			citationPosture: string;
			intent: {
				capability?: string | null;
				taskKind?: string | null;
				launchState?: string | null;
				nextAction?: string | null;
				scopeClass?: string | null;
				classifierVersion?: string | null;
			};
		};
		feedback?: {
			feedbackId: string;
			vote: "unhelpful";
			reasonCodes: string[];
			updatedAt: string;
		};
		diagnostic?: {
			answerShape: string | null;
			caseId: string;
			expectedDocIds: string[];
			failureStage:
				| "routing"
				| "planning"
				| "tool"
				| "retrieval"
				| "rerank"
				| "selection"
				| "evidence_selection"
				| "synthesis"
				| "grounding"
				| "finalization"
				| "diagnostic";
			metricFailureReason: string;
			metricName: string;
			presentationKind: string | null;
			retrievedContextIds: string[];
			retrievedDocIds: string[];
			score: number;
			supportingDocIds: string[];
			threshold: number;
			trajectoryAttribution: EvalDiagnosticTrajectoryAttribution;
		};
		links: {
			traceLink: string | null;
			issueLink: string | null;
			issueFingerprint: string | null;
		};
		privacy?: {
			rawTranscriptIncluded: false;
			rawAuthMaterialIncluded: false;
			providerRawResponseIncluded: false;
		};
		review?: {
			suggestedLabels: Array<
				| "false_positive"
				| "false_negative"
				| "wrong_intent"
				| "stale_missing_evidence"
				| "answer_style_issue"
			>;
		};
		intake: {
			source: "operator_badcase" | "negative_feedback" | "ragas_diagnostic";
			status: "pending_review";
			suggestedEvalFamily: "citation" | "grounding" | "intent" | "policy" | "unknown";
			createdAt: string;
		};
	}>;
	page: {
		nextCursor: string | null;
	};
}

export interface OperatorQualitySummaryResult {
	window: OperatorResultWindow;
	runtime: {
		requestCount: number;
		emptyRecallRate: MetricRatio;
		citationMissRate: MetricRatio;
		feedback: {
			feedbackCount: number;
			coverageRate: MetricRatio;
			helpfulRate: MetricRatio;
			unhelpfulRate: MetricRatio;
			noAnswerUnhelpfulRate: MetricRatio;
			distributions: {
				surface: OperatorDistributionBucket[];
				answerKind: OperatorDistributionBucket[];
				capability: OperatorDistributionBucket[];
				citationPosture: OperatorDistributionBucket[];
				reasonCode: OperatorDistributionBucket[];
				vote: OperatorDistributionBucket[];
			};
		};
		refusalDistribution: {
			noAnswer: number;
			needsClarification: number;
			approvalRequired: number;
			rejected: number;
		};
	};
	sampledGrades: {
		coverageRate: MetricRatio | null;
		groundingPassRate: MetricRatio | null;
		citationPassRate: MetricRatio | null;
		intentPassRate: MetricRatio | null;
		policyPassRate: MetricRatio | null;
		badcaseOpenCount: number | null;
	} | null;
	asOf: string;
}
