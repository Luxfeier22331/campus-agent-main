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
	requestedTool: string | null;
	requestedScope: Record<string, unknown> | null;
	resolvedScope: Record<string, unknown> | null;
	selectedTool: string | null;
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
	request: RawRequestProjectionRecord | null;
}

export interface RequestMetricModel {
	name: string | null;
	provider: string | null;
}

export interface RequestPromptModel {
	id: string | null;
	runtimeDetail: string | null;
	runtimeState: string | null;
	templateSha256: string | null;
	version: string | null;
}

export interface RequestObservabilityModel {
	aclDecision: string | null;
	candidateCount: number | null;
	citationCount: number | null;
	citationExpected: boolean | null;
	citationMissing: boolean | null;
	durationMs: number | null;
	estimatedCost: {
		currency: string;
		microusd: number | null;
	};
	failClosed: boolean | null;
	inputTokens: number | null;
	measuredAt: string;
	model: RequestMetricModel;
	outputTokens: number | null;
	projectionLagMs: number | null;
	prompt: RequestPromptModel;
	retrievalAdequacyReason: string | null;
	retrievalAdequacyVerdict: string | null;
	retrievalAttempted: boolean | null;
	retrievedSourceCount: number | null;
	sourceTrace?: {
		retrieved: RequestSourceTraceItem[];
		supporting: RequestSourceTraceItem[];
	};
	traceAvailable: boolean;
}

export interface RequestSourceTraceItem {
	chunkId: string | null;
	collection: string | null;
	docId: string | null;
	score: number | null;
	sourceTitle: string | null;
}

export interface RequestRuntimeRunModel {
	run?: {
		runId: string;
		status: string;
		phase?: string | null;
		terminalReason?: string | null;
	};
	stepTrajectory?: {
		steps: RequestRuntimeStepModel[];
	};
}

export interface RequestRuntimeStepModel {
	tool: string | null;
	durationMs: number | null;
	failCloseReason: string | null;
	modelName: string | null;
	modelProvider: string | null;
	status: string;
	stepId: string;
	stepKind: string;
	taskQueue: string | null;
	timeoutOutcome: string | null;
}

export interface RequestObservabilityLinks {
	issueFingerprint: string | null;
	issueLink: string | null;
	langfuseEvalBacklinks?: RequestLangfuseEvalBacklink[];
	traceLink: string | null;
}

export interface RequestLangfuseEvalBacklink {
	environment: string;
	evalRunId: string;
	langfuseUrl: string;
	release: string;
	scoreName: string;
	scoreValue: string | number | boolean;
	traceId: string;
}

export interface RawRequestObservabilityResponse {
	links: RequestObservabilityLinks;
	observability: RequestObservabilityModel;
	request: RawRequestProjectionRecord;
	runtimeRun?: RequestRuntimeRunModel | null;
}

export function normalizeRequestRecord(input: RawRequestProjectionRecord): RequestProjectionRecord {
	return {
		...input,
		id: input.requestId,
	};
}
