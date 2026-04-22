export interface RequestClaimSupportSummary {
	totalClaims: number;
	supportedClaims: number;
	unsupportedClaims: number;
	unsupportedClaimTypes: string[];
	unsupportedFields: string[];
}

export interface RequestSourceTrustSummary {
	observedTiers: string[];
	answerBearingTiers: string[];
	blockedClaimTypes: string[];
	freshnessClaimBlocked: boolean;
	authorizationClaimBlocked: boolean;
}

export interface RequestRemoteContentSuspicionSummary {
	flaggedSourceCount: number;
	flagLabels: string[];
	generationBlocked: boolean;
}

export interface RequestRetrievalStepActivitySummary {
	stepId: string;
	stepType: string;
	corpus: string;
	collection: string;
	status: string;
	topK: number;
	latencyMs: number | null;
	candidateCount: number;
	referenceCount: number;
	failureKind: string | null;
}

export interface RequestRetrievalPlanSummary {
	planId: string;
	queryMode: string;
	replanCount: number;
	terminalState: string;
	stepActivities: RequestRetrievalStepActivitySummary[];
}

export interface RequestDiagnosticsSummary {
	claimSupportSummary: RequestClaimSupportSummary | null;
	sourceTrustSummary?: RequestSourceTrustSummary | null;
	remoteContentSuspicionSummary?: RequestRemoteContentSuspicionSummary | null;
	retrievalPlanSummary?: RequestRetrievalPlanSummary | null;
	resolvedPolicyDocumentId: string | null;
	resolvedPolicyTitle: string | null;
	rewrittenQuery: string | null;
	clarificationReason: string | null;
	noAnswerReason: string | null;
	semanticOutcome: string | null;
	retrievalAdequacyVerdict: string | null;
	retrievalAdequacyReason: string | null;
	groundingVerdict: string | null;
	groundingDowngraded: boolean | null;
	freshnessFailClosed: boolean | null;
	scopeClass: string | null;
	policyReason: string | null;
	retrievedTitleSummary: string[];
	unsupportedFields: string[];
	resolvedEntityType: string | null;
	resolvedProgramFamilyTitle: string | null;
	sessionProgramFamily: string | null;
	sessionProgram: string | null;
	sessionSemester: string | null;
}

function normalizeOptionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.map((item) => normalizeOptionalString(item))
		.filter((item): item is string => item !== null);
}

function normalizeOptionalBoolean(value: unknown): boolean | null {
	return typeof value === "boolean" ? value : null;
}

function getRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function readField(
	source: Record<string, unknown>,
	snakeCaseKey: string,
	camelCaseKey: string,
): unknown {
	return source[snakeCaseKey] ?? source[camelCaseKey];
}

function summarizeClaimSupports(
	diagnosticsRecord: Record<string, unknown>,
): RequestClaimSupportSummary | null {
	const rawClaimSupports = readField(diagnosticsRecord, "claim_supports", "claimSupports");
	if (!Array.isArray(rawClaimSupports)) {
		return null;
	}

	let totalClaims = 0;
	let supportedClaims = 0;
	let unsupportedClaims = 0;
	const unsupportedClaimTypes = new Set<string>();

	for (const item of rawClaimSupports) {
		const record = getRecord(item);
		if (!record) {
			continue;
		}

		const claimType = normalizeOptionalString(readField(record, "claim_type", "claimType"));
		const supported = normalizeOptionalBoolean(record.supported);
		totalClaims += 1;
		if (supported === true) {
			supportedClaims += 1;
			continue;
		}
		unsupportedClaims += 1;
		if (claimType) {
			unsupportedClaimTypes.add(claimType);
		}
	}

	if (totalClaims === 0) {
		return null;
	}

	return {
		supportedClaims,
		totalClaims,
		unsupportedClaimTypes: Array.from(unsupportedClaimTypes).sort(),
		unsupportedClaims,
		unsupportedFields: normalizeStringList(
			readField(diagnosticsRecord, "unsupported_fields", "unsupportedFields"),
		),
	};
}

function summarizeSourceTrust(
	diagnosticsRecord: Record<string, unknown>,
): RequestSourceTrustSummary | null {
	const rawSourceTrustSummary = getRecord(
		readField(diagnosticsRecord, "source_trust_summary", "sourceTrustSummary"),
	);
	if (!rawSourceTrustSummary) {
		return null;
	}

	return {
		observedTiers: normalizeStringList(
			readField(rawSourceTrustSummary, "observed_tiers", "observedTiers"),
		),
		answerBearingTiers: normalizeStringList(
			readField(rawSourceTrustSummary, "answer_bearing_tiers", "answerBearingTiers"),
		),
		blockedClaimTypes: normalizeStringList(
			readField(rawSourceTrustSummary, "blocked_claim_types", "blockedClaimTypes"),
		),
		freshnessClaimBlocked:
			normalizeOptionalBoolean(
				readField(rawSourceTrustSummary, "freshness_claim_blocked", "freshnessClaimBlocked"),
			) ?? false,
		authorizationClaimBlocked:
			normalizeOptionalBoolean(
				readField(
					rawSourceTrustSummary,
					"authorization_claim_blocked",
					"authorizationClaimBlocked",
				),
			) ?? false,
	};
}

function summarizeRemoteContentSuspicion(
	diagnosticsRecord: Record<string, unknown>,
): RequestRemoteContentSuspicionSummary | null {
	const rawRemoteContentSuspicionSummary = getRecord(
		readField(
			diagnosticsRecord,
			"remote_content_suspicion_summary",
			"remoteContentSuspicionSummary",
		),
	);
	if (!rawRemoteContentSuspicionSummary) {
		return null;
	}

	return {
		flaggedSourceCount:
			typeof readField(
				rawRemoteContentSuspicionSummary,
				"flagged_source_count",
				"flaggedSourceCount",
			) === "number"
				? (readField(
						rawRemoteContentSuspicionSummary,
						"flagged_source_count",
						"flaggedSourceCount",
					) as number)
				: 0,
		flagLabels: normalizeStringList(
			readField(rawRemoteContentSuspicionSummary, "flag_labels", "flagLabels"),
		),
		generationBlocked:
			normalizeOptionalBoolean(
				readField(rawRemoteContentSuspicionSummary, "generation_blocked", "generationBlocked"),
			) ?? false,
	};
}

function summarizeRetrievalStepActivities(
	rawStepActivities: unknown,
): RequestRetrievalStepActivitySummary[] {
	if (!Array.isArray(rawStepActivities)) {
		return [];
	}

	return rawStepActivities.flatMap((item) => {
		const record = getRecord(item);
		if (!record) {
			return [];
		}
		const stepId = normalizeOptionalString(readField(record, "step_id", "stepId"));
		const stepType = normalizeOptionalString(readField(record, "step_type", "stepType"));
		const corpus = normalizeOptionalString(readField(record, "corpus", "corpus"));
		const collection = normalizeOptionalString(readField(record, "collection", "collection"));
		const status = normalizeOptionalString(readField(record, "status", "status"));
		if (!stepId || !stepType || !corpus || !collection || !status) {
			return [];
		}
		return [
			{
				stepId,
				stepType,
				corpus,
				collection,
				status,
				topK:
					typeof readField(record, "top_k", "topK") === "number"
						? (readField(record, "top_k", "topK") as number)
						: 0,
				latencyMs:
					typeof readField(record, "latency_ms", "latencyMs") === "number"
						? (readField(record, "latency_ms", "latencyMs") as number)
						: null,
				candidateCount:
					typeof readField(record, "candidate_count", "candidateCount") === "number"
						? (readField(record, "candidate_count", "candidateCount") as number)
						: 0,
				referenceCount:
					typeof readField(record, "reference_count", "referenceCount") === "number"
						? (readField(record, "reference_count", "referenceCount") as number)
						: 0,
				failureKind: normalizeOptionalString(readField(record, "failure_kind", "failureKind")),
			},
		];
	});
}

function summarizeRetrievalPlan(
	diagnosticsRecord: Record<string, unknown>,
): RequestRetrievalPlanSummary | null {
	const rawSummary = getRecord(
		readField(diagnosticsRecord, "retrieval_plan_summary", "retrievalPlanSummary"),
	);
	if (!rawSummary) {
		return null;
	}
	const planId = normalizeOptionalString(readField(rawSummary, "plan_id", "planId"));
	const queryMode = normalizeOptionalString(readField(rawSummary, "query_mode", "queryMode"));
	const terminalState = normalizeOptionalString(
		readField(rawSummary, "terminal_state", "terminalState"),
	);
	if (!planId || !queryMode || !terminalState) {
		return null;
	}

	return {
		planId,
		queryMode,
		replanCount:
			typeof readField(rawSummary, "replan_count", "replanCount") === "number"
				? (readField(rawSummary, "replan_count", "replanCount") as number)
				: 0,
		terminalState,
		stepActivities: summarizeRetrievalStepActivities(
			readField(rawSummary, "step_activities", "stepActivities"),
		),
	};
}

export function extractRequestDiagnosticsSummary(
	result: unknown,
): RequestDiagnosticsSummary | null {
	const resultRecord = getRecord(result);
	const diagnosticsRecord = getRecord(resultRecord?.diagnostics);
	if (!diagnosticsRecord) {
		return null;
	}

	const summary: RequestDiagnosticsSummary = {
		claimSupportSummary: summarizeClaimSupports(diagnosticsRecord),
		sourceTrustSummary: summarizeSourceTrust(diagnosticsRecord),
		remoteContentSuspicionSummary: summarizeRemoteContentSuspicion(diagnosticsRecord),
		retrievalPlanSummary: summarizeRetrievalPlan(diagnosticsRecord),
		clarificationReason: normalizeOptionalString(
			readField(diagnosticsRecord, "clarification_reason", "clarificationReason"),
		),
		noAnswerReason: normalizeOptionalString(
			readField(diagnosticsRecord, "no_answer_reason", "noAnswerReason"),
		),
		semanticOutcome: normalizeOptionalString(
			readField(diagnosticsRecord, "semantic_outcome", "semanticOutcome"),
		),
		retrievalAdequacyVerdict: normalizeOptionalString(
			readField(diagnosticsRecord, "retrieval_adequacy_verdict", "retrievalAdequacyVerdict"),
		),
		retrievalAdequacyReason: normalizeOptionalString(
			readField(diagnosticsRecord, "retrieval_adequacy_reason", "retrievalAdequacyReason"),
		),
		groundingVerdict: normalizeOptionalString(
			readField(diagnosticsRecord, "grounding_verdict", "groundingVerdict"),
		),
		groundingDowngraded: normalizeOptionalBoolean(
			readField(diagnosticsRecord, "grounding_downgraded", "groundingDowngraded"),
		),
		freshnessFailClosed: normalizeOptionalBoolean(
			readField(diagnosticsRecord, "freshness_fail_closed", "freshnessFailClosed"),
		),
		scopeClass: normalizeOptionalString(readField(diagnosticsRecord, "scope_class", "scopeClass")),
		policyReason: normalizeOptionalString(
			readField(diagnosticsRecord, "policy_reason", "policyReason"),
		),
		resolvedPolicyDocumentId: normalizeOptionalString(
			readField(diagnosticsRecord, "resolved_policy_document_id", "resolvedPolicyDocumentId"),
		),
		resolvedPolicyTitle: normalizeOptionalString(
			readField(diagnosticsRecord, "resolved_policy_title", "resolvedPolicyTitle"),
		),
		retrievedTitleSummary: normalizeStringList(
			readField(diagnosticsRecord, "retrieved_title_summary", "retrievedTitleSummary"),
		),
		unsupportedFields: normalizeStringList(
			readField(diagnosticsRecord, "unsupported_fields", "unsupportedFields"),
		),
		resolvedEntityType: normalizeOptionalString(
			readField(diagnosticsRecord, "resolved_entity_type", "resolvedEntityType"),
		),
		resolvedProgramFamilyTitle: normalizeOptionalString(
			readField(diagnosticsRecord, "resolved_program_family_title", "resolvedProgramFamilyTitle"),
		),
		sessionProgramFamily: normalizeOptionalString(
			readField(diagnosticsRecord, "session_program_family", "sessionProgramFamily"),
		),
		sessionProgram: normalizeOptionalString(
			readField(diagnosticsRecord, "session_program", "sessionProgram"),
		),
		sessionSemester: normalizeOptionalString(
			readField(diagnosticsRecord, "session_semester", "sessionSemester"),
		),
		rewrittenQuery: normalizeOptionalString(
			readField(diagnosticsRecord, "rewritten_query", "rewrittenQuery"),
		),
	};

	if (
		summary.claimSupportSummary === null &&
		summary.sourceTrustSummary === null &&
		summary.remoteContentSuspicionSummary === null &&
		summary.retrievalPlanSummary === null &&
		!summary.resolvedPolicyDocumentId &&
		!summary.resolvedPolicyTitle &&
		!summary.rewrittenQuery &&
		!summary.clarificationReason &&
		!summary.noAnswerReason &&
		!summary.semanticOutcome &&
		!summary.retrievalAdequacyVerdict &&
		!summary.retrievalAdequacyReason &&
		!summary.groundingVerdict &&
		summary.groundingDowngraded === null &&
		summary.freshnessFailClosed === null &&
		!summary.scopeClass &&
		!summary.policyReason &&
		!summary.resolvedEntityType &&
		!summary.resolvedProgramFamilyTitle &&
		!summary.sessionProgramFamily &&
		!summary.sessionProgram &&
		!summary.sessionSemester &&
		summary.retrievedTitleSummary.length === 0 &&
		summary.unsupportedFields.length === 0
	) {
		return null;
	}

	return summary;
}
