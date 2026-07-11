export interface RawRequestProjectionRecord {
	answerPreview: string | null;
	applicabilityScope: string | null;
	completedAt: string | null;
	conversationId: string;
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
	runId: string | null;
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

export interface RawRequestOpsIndex {
	stageTiming: Record<string, number>;
	stageTimingBudget?: Record<
		string,
		{
			budgetState: "within_budget" | "warn" | "critical";
			budgetVersion: string;
			criticalMs: number;
			durationMs: number;
			warnMs: number;
		}
	>;
	debugTraceRefs: Array<{
		sink: string;
		traceId: string | null;
		traceRef: string;
		url?: string;
	}>;
	model: {
		modelProvider: string | null;
		modelName: string | null;
		answerEvalFingerprint: Record<string, unknown> | null;
		llmIoFingerprint: Record<string, unknown> | null;
		promptId: string | null;
		promptVersion: string | null;
		templateSha256: string | null;
	};
	tool: {
		requestedTool: string | null;
		selectedTool: string | null;
		failClosed: boolean | null;
	};
	sources: Array<{
		canonicalUrl: string;
		sourceKind: string | null;
		sourceTitle: string;
		targetKind: string | null;
		versionId: string | null;
	}>;
	sinkLinks: {
		traceAvailable: boolean;
		projectionLagMs: number | null;
	};
}

export interface RequestProjectionRecord extends RawRequestProjectionRecord {
	id: string;
}

export interface RequestDetailRecord {
	request: RequestProjectionRecord | null;
	opsIndex: RawRequestOpsIndex | null;
}

export interface RawRequestListResponse {
	page: {
		nextCursor: string | null;
	};
	requests: RawRequestProjectionRecord[];
}

export interface RawRequestDetailResponse {
	request: RawRequestProjectionRecord | null;
	opsIndex: RawRequestOpsIndex | null;
}

export function normalizeRequestRecord(input: RawRequestProjectionRecord): RequestProjectionRecord {
	return {
		...input,
		id: input.requestId,
	};
}
