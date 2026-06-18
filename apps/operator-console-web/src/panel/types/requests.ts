export interface RawRequestProjectionRecord {
	answerPreview: string | null;
	applicabilityScope: string | null;
	completedAt: string | null;
	conversationId: string;
	diagnostics?: RequestProjectionDiagnostics;
	durationMs: number | null;
	errorCode: string | null;
	entitlementGroups: string[];
	entitlementSnapshotId: string | null;
	principalId: string;
	principalLabel: string | null;
	principalType: string;
	projectedAt: string;
	questionPreview: string;
	requestId: string;
	requestedCapability: string | null;
	requestedScope: Record<string, unknown> | null;
	resolvedScope: Record<string, unknown> | null;
	selectedCapability: string | null;
	sourceDocIds: string[];
	startedAt: string;
	status: string;
	surface: string;
	traceId: string;
	visibilityScope: string | null;
}

export interface RequestProjectionDiagnostics {
	clarificationReason: string | null;
	noAnswerReason: string | null;
	resolvedPolicyDocumentId: string | null;
	resolvedPolicyTitle: string | null;
	retrievedTitleSummary: string[];
	rewrittenQuery: string | null;
}

export interface RequestProjectionRecord extends RawRequestProjectionRecord {
	id: string;
}

export interface RawRequestListResponse {
	page: {
		nextCursor: string | null;
	};
	requests: RawRequestProjectionRecord[];
}

export function normalizeRequestRecord(input: RawRequestProjectionRecord): RequestProjectionRecord {
	return {
		...input,
		id: input.requestId,
	};
}
