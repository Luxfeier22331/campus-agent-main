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
	selectedTarget: string | null;
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

export interface RawRequestDetailResponse {
	request: RawRequestProjectionRecord;
}

export interface RequestIntentObservabilitySummary {
	capability: string | null;
	taskKind: string | null;
	launchState: string | null;
	nextAction: string | null;
	scopeClass: string | null;
	scopeReason: string | null;
	policyReason: string | null;
	classifierVersion: string | null;
	schemaVersion?: string | null;
	routingConfidence?: string | null;
	ambiguitySignal?: string | null;
	contextResolutionState?: string | null;
	contextReferenceType?: string | null;
	resolvedSlots?: Record<string, string> | null;
	missingSlots?: string[] | null;
	ambiguityReason?: string | null;
}

export interface RawRequestObservabilityRecord {
	request: {
		completedAt: string | null;
		conversationId: string;
		requestId: string;
		requestedCapability: string | null;
		requestedScope: Record<string, unknown> | null;
		resolvedScope?: Record<string, unknown> | null;
		selectedTarget: string | null;
		startedAt: string;
		status: string;
		surface: string;
		traceId: string;
		versionQuery?: Record<string, unknown>;
	};
	observability: {
		aclAnomalyCode: string | null;
		aclDecision: string | null;
		cachedInputTokens: number | null;
		candidateCount: number | null;
		citationCount: number | null;
		citationExpected: boolean | null;
		citationMissing: boolean | null;
		durationMs: number | null;
		emptyRecall: boolean | null;
		estimatedCost: {
			currency: "USD";
			microusd: number | null;
		};
		failClosed: boolean | null;
		intent?: RequestIntentObservabilitySummary;
		inputTokens: number | null;
		measuredAt: string | null;
		model: {
			name: string | null;
			provider: string | null;
		};
		outputTokens: number | null;
		projectionLagMs: number | null;
		refusalClass: string | null;
		retrievedSourceCount: number | null;
		retrievalAttempted: boolean | null;
		traceAvailable: boolean;
	};
	links: {
		issueFingerprint: string | null;
		issueLink: string | null;
		traceLink: string | null;
	};
	auditSummary: {
		auditEventCount: number;
		latestTerminalCode: string | null;
	};
	replay?: {
		context?: {
			applicabilityScope: string | null;
			entitlementGroups: string[];
			entitlementSnapshotId: string | null;
			policyProjectionVersion: string | null;
			principalType: string;
			visibilityScope: string | null;
		};
		execution?: {
			errorCode: string | null;
			failClosed: boolean | null;
			refusalClass: string | null;
			scopeClass: string | null;
			semanticOutcome: string | null;
			status: string;
		};
		routing?: {
			intent?: RequestIntentObservabilitySummary;
			requestedCapability: string | null;
			requestedScope: Record<string, unknown> | null;
			resolvedScope: Record<string, unknown> | null;
			selectedTarget: string | null;
		};
	};
}

export type RequestObservabilityRecord = RawRequestObservabilityRecord;

export function normalizeRequestRecord(input: RawRequestProjectionRecord): RequestProjectionRecord {
	return {
		...input,
		id: input.requestId,
	};
}
