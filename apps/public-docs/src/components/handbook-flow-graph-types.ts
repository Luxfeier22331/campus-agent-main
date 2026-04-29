export type HandbookFlowExtractionStatus = "ready" | "needs_review";

export interface HandbookFlowStep {
	readonly stepId: string;
	readonly stepText: string;
	readonly nextStepIds: readonly string[];
}

export interface HandbookFlow {
	readonly flowHeading: string;
	readonly audienceScope: string;
	readonly steps: readonly HandbookFlowStep[];
	readonly manualReviewNotes: readonly string[];
}

export interface HandbookFlowPageFinding {
	readonly sourcePage: number;
	readonly pageHeading: string;
	readonly flows: readonly HandbookFlow[];
}

export interface HandbookFlowGraphDocumentData {
	readonly title: string;
	readonly sourceHandbookSection: string;
	readonly sourcePageStart: number;
	readonly sourcePageEnd: number;
	readonly manualReviewRequired: boolean;
	readonly extractionStatus: HandbookFlowExtractionStatus;
	readonly pageFindings: readonly HandbookFlowPageFinding[];
}
