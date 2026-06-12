import type { ResolvedAppPrincipal } from "./auth";
import type { CapabilityExecutionResponse, RequestedScope } from "./integration";
import type {
	RequestClaimSupportSummary,
	RequestDiagnosticsSummary,
	RequestRemoteContentSuspicionSummary,
	RequestSourceTrustSummary,
} from "./request-diagnostics";
import type {
	RequestExecutionStatus,
	RequestObservabilityFactWrite,
} from "./runtime-command/store";
import { extractObservedSourcesFromResult } from "./source-trace";
import { summarizeVersionQuery, type VersionQuery } from "./version-query";

function toScopeSummary(scope: RequestedScope | null | undefined): string | null {
	if (!(scope?.corpus && scope?.collection)) {
		return null;
	}

	return `${scope.corpus}/${scope.collection}`;
}

function normalizeAclDecision(input: {
	diagnostics: RequestDiagnosticsSummary | null;
	response: CapabilityExecutionResponse;
	status: RequestExecutionStatus;
}): string | null {
	if (input.response.observability?.aclDecision) {
		return input.response.observability.aclDecision;
	}
	if (input.status === "approval_required") {
		return "approval_required";
	}
	if (input.status === "rejected") {
		return "denied";
	}
	if (input.diagnostics?.noAnswerReason === "restricted_access_denied") {
		return "denied";
	}

	return input.status === "accepted" ? null : "allowed";
}

function normalizeFailClosed(input: {
	diagnostics: RequestDiagnosticsSummary | null;
	response: CapabilityExecutionResponse;
	status: RequestExecutionStatus;
}): boolean | null {
	if (typeof input.response.observability?.failClosed === "boolean") {
		return input.response.observability.failClosed;
	}
	if (input.status === "accepted") {
		return null;
	}
	if (input.status === "approval_required" || input.status === "rejected") {
		return true;
	}
	const semanticOutcome = normalizeSemanticOutcome(input);
	if (
		semanticOutcome === "restricted_access_denied" ||
		semanticOutcome === "out_of_scope" ||
		semanticOutcome === "unsupported_by_evidence" ||
		semanticOutcome === "freshness_fail_close"
	) {
		return true;
	}

	return false;
}

function normalizeRefusalClass(
	diagnostics: RequestDiagnosticsSummary | null,
	response: CapabilityExecutionResponse,
	status: RequestExecutionStatus,
): string | null {
	if (response.observability?.refusalClass) {
		return response.observability.refusalClass;
	}
	if (
		diagnostics?.semanticOutcome === "out_of_scope" ||
		diagnostics?.scopeClass === "out_of_scope"
	) {
		return "out_of_scope";
	}
	if (diagnostics?.noAnswerReason === "out_of_scope") {
		return "out_of_scope";
	}
	if (
		status === "needs_clarification" ||
		status === "no_answer" ||
		status === "approval_required" ||
		status === "rejected"
	) {
		return status;
	}

	return null;
}

function deriveSemanticOutcomeFromDiagnostics(
	diagnostics: RequestDiagnosticsSummary | null,
): string | null {
	if (!diagnostics) {
		return null;
	}
	if (diagnostics.semanticOutcome) {
		return diagnostics.semanticOutcome;
	}
	if (diagnostics.scopeClass === "out_of_scope" || diagnostics.noAnswerReason === "out_of_scope") {
		return "out_of_scope";
	}
	if (diagnostics.noAnswerReason === "restricted_access_denied") {
		return "restricted_access_denied";
	}
	if (diagnostics.groundingDowngraded === true) {
		return "unsupported_by_evidence";
	}

	return null;
}

function normalizeSemanticOutcome(input: {
	diagnostics: RequestDiagnosticsSummary | null;
	response: CapabilityExecutionResponse;
	status: RequestExecutionStatus;
}): string | null {
	if (input.response.observability?.semanticOutcome) {
		return input.response.observability.semanticOutcome;
	}
	const diagnosticsSemanticOutcome = deriveSemanticOutcomeFromDiagnostics(input.diagnostics);
	if (diagnosticsSemanticOutcome) {
		return diagnosticsSemanticOutcome;
	}
	if (input.status === "completed") {
		return "grounded_answer";
	}
	if (input.status === "needs_clarification") {
		return "needs_clarification";
	}
	if (input.status === "approval_required") {
		return "approval_required";
	}
	if (input.status === "rejected") {
		return "policy_refusal";
	}
	if (input.status === "no_answer") {
		if (input.diagnostics?.noAnswerReason === "restricted_access_denied") {
			return "restricted_access_denied";
		}
		return "unsupported_by_evidence";
	}
	return null;
}

function normalizeScopeClass(input: {
	diagnostics: RequestDiagnosticsSummary | null;
	requestedScope: RequestedScope | null;
	resolvedScope: RequestedScope | null;
	response: CapabilityExecutionResponse;
	status: RequestExecutionStatus;
}): string | null {
	if (input.response.observability?.scopeClass) {
		return input.response.observability.scopeClass;
	}
	if (input.diagnostics?.scopeClass) {
		return input.diagnostics.scopeClass;
	}
	const semanticOutcome = normalizeSemanticOutcome(input);
	if (semanticOutcome === "out_of_scope") {
		return "out_of_scope";
	}
	if (
		(input.status === "completed" ||
			input.status === "needs_clarification" ||
			input.status === "no_answer") &&
		(input.resolvedScope || input.requestedScope)
	) {
		return "in_scope";
	}
	return null;
}

function normalizePolicyReason(input: {
	diagnostics: RequestDiagnosticsSummary | null;
	response: CapabilityExecutionResponse;
	status: RequestExecutionStatus;
}): string | null {
	if (input.response.observability?.policyReason) {
		return input.response.observability.policyReason;
	}
	if (input.diagnostics?.policyReason) {
		return input.diagnostics.policyReason;
	}
	if (input.status === "approval_required") {
		return "approval_required";
	}
	if (input.status === "rejected") {
		return "request_rejected";
	}
	return null;
}

function normalizeIntentString(value: string | null | undefined): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function normalizeRetrievalAdequacyVerdict(
	diagnostics: RequestDiagnosticsSummary | null,
): string | null {
	return diagnostics?.retrievalAdequacyVerdict ?? null;
}

function normalizeRetrievalAdequacyReason(
	diagnostics: RequestDiagnosticsSummary | null,
): string | null {
	return diagnostics?.retrievalAdequacyReason ?? null;
}

function normalizeClaimSupportSummary(
	diagnostics: RequestDiagnosticsSummary | null,
): RequestClaimSupportSummary | null {
	return diagnostics?.claimSupportSummary ?? null;
}

function normalizeSourceTrustSummary(
	diagnostics: RequestDiagnosticsSummary | null,
): RequestSourceTrustSummary | null {
	return diagnostics?.sourceTrustSummary ?? null;
}

function normalizeRemoteContentSuspicionSummary(
	diagnostics: RequestDiagnosticsSummary | null,
): RequestRemoteContentSuspicionSummary | null {
	return diagnostics?.remoteContentSuspicionSummary ?? null;
}

export function buildAcceptedRequestObservabilityFact(input: {
	conversationId: string;
	principal: ResolvedAppPrincipal;
	requestId: string;
	requestedCapability: string | null;
	requestedScope: RequestedScope | null;
	resolvedScope: RequestedScope | null;
	safetyIdentifier?: string | null;
	surface: string;
	startedAt: string;
	traceId: string;
	versionQuery?: VersionQuery | null;
}): RequestObservabilityFactWrite {
	const versionSummary = summarizeVersionQuery(input.versionQuery);

	return {
		aclAnomalyCode: null,
		aclDecision: null,
		cachedInputTokens: null,
		candidateCount: null,
		claimSupportSummary: null,
		remoteContentSuspicionSummary: null,
		sourceTrustSummary: null,
		retrievedSources: [],
		supportingSources: [],
		citationCount: null,
		citationExpected: null,
		citationMissing: null,
		collection: input.resolvedScope?.collection ?? null,
		completedAt: null,
		conversationId: input.conversationId,
		durationMs: null,
		emptyRecall: null,
		entitlementSnapshotId: input.principal.authorization?.entitlementSnapshotId ?? null,
		errorCode: null,
		estimatedCostMicrousd: null,
		failClosed: null,
		inputTokens: null,
		intentCapability: null,
		intentClassifierVersion: null,
		intentLaunchState: null,
		intentNextAction: null,
		intentPolicyReason: null,
		intentScopeClass: null,
		intentScopeReason: null,
		intentTaskKind: null,
		intentSchemaVersion: null,
		intentRoutingConfidence: null,
		intentAmbiguitySignal: null,
		intentContextResolutionState: null,
		intentContextReferenceType: null,
		intentResolvedSlots: null,
		intentMissingSlots: null,
		intentAmbiguityReason: null,
		measuredAt: input.startedAt,
		modelName: null,
		modelProvider: null,
		promptId: null,
		promptRuntimeDetail: null,
		promptRuntimeState: null,
		promptVersion: null,
		outputTokens: null,
		policyProjectionVersion:
			input.principal.authorization?.retrievalFilter.policyProjectionVersion ?? null,
		policyReason: null,
		retrievalAdequacyReason: null,
		retrievalAdequacyVerdict: null,
		principalType: input.principal.principal.type,
		projectionLagMs: null,
		requestId: input.requestId,
		requestedCapability: input.requestedCapability,
		requestedScopeSummary: toScopeSummary(input.requestedScope),
		versionQueryMode: versionSummary.mode,
		versionQuerySummary: versionSummary.summary,
		resolvedScopeSummary: toScopeSummary(input.resolvedScope),
		refusalClass: null,
		scopeClass: null,
		semanticOutcome: null,
		safetyIdentifier: input.safetyIdentifier ?? null,
		templateSha256: null,
		retrievedSourceCount: null,
		retrievalAttempted: null,
		selectedCapability: null,
		selectedTool: null,
		startedAt: input.startedAt,
		status: "accepted",
		surface: input.surface,
		traceAvailable: Boolean(input.traceId),
		traceId: input.traceId,
		toolBusinessOutcome: null,
		toolFailCloseReason: null,
		toolHistoricalDowngradeReason: null,
		updatedAt: input.startedAt,
		workflowTraceSummary: null,
	};
}

export function buildFinalizedRequestObservabilityFact(input: {
	completedAt: string;
	diagnostics: RequestDiagnosticsSummary | null;
	durationMs: number;
	errorCode: string | null;
	principal: ResolvedAppPrincipal;
	requestId: string;
	requestedCapability: string | null;
	requestedScope: RequestedScope | null;
	resolvedScope: RequestedScope | null;
	response: CapabilityExecutionResponse;
	safetyIdentifier?: string | null;
	sourceDocIds: string[];
	startedAt: string;
	status: RequestExecutionStatus;
	surface: string;
	traceId: string;
	conversationId: string;
	versionQuery?: VersionQuery | null;
}): RequestObservabilityFactWrite {
	const observability = input.response.observability;
	const versionSummary = summarizeVersionQuery(input.versionQuery);
	const supportingSources = extractObservedSourcesFromResult(input.response.result);
	const retrievedSources = observability?.retrievedSources ?? [];
	const retrievalAttempted =
		typeof observability?.retrievalAttempted === "boolean"
			? observability.retrievalAttempted
			: null;
	const retrievedSourceCount =
		observability?.retrievedSourceCount ??
		(retrievalAttempted === true || retrievedSources.length > 0 ? retrievedSources.length : null);
	const citationExpected =
		typeof observability?.citationExpected === "boolean" ? observability.citationExpected : null;
	const citationCount =
		observability?.citationCount ?? (citationExpected === true ? supportingSources.length : 0);

	return {
		aclAnomalyCode: observability?.aclAnomalyCode ?? null,
		aclDecision: normalizeAclDecision({
			diagnostics: input.diagnostics,
			response: input.response,
			status: input.status,
		}),
		cachedInputTokens: observability?.cachedInputTokens ?? null,
		candidateCount: observability?.candidateCount ?? null,
		claimSupportSummary: normalizeClaimSupportSummary(input.diagnostics),
		remoteContentSuspicionSummary: normalizeRemoteContentSuspicionSummary(input.diagnostics),
		sourceTrustSummary: normalizeSourceTrustSummary(input.diagnostics),
		retrievedSources,
		supportingSources,
		citationCount,
		citationExpected,
		citationMissing:
			typeof observability?.citationMissing === "boolean"
				? observability.citationMissing
				: citationExpected === true
					? citationCount === 0
					: null,
		collection: input.resolvedScope?.collection ?? null,
		completedAt: input.completedAt,
		conversationId: input.conversationId,
		durationMs: input.durationMs,
		emptyRecall: retrievalAttempted === true ? retrievedSourceCount === 0 : null,
		entitlementSnapshotId: input.principal.authorization?.entitlementSnapshotId ?? null,
		errorCode: input.errorCode,
		estimatedCostMicrousd: observability?.estimatedCostMicrousd ?? null,
		failClosed: normalizeFailClosed({
			diagnostics: input.diagnostics,
			response: input.response,
			status: input.status,
		}),
		inputTokens: observability?.inputTokens ?? null,
		intentCapability: normalizeIntentString(observability?.intentCapability),
		intentClassifierVersion: normalizeIntentString(observability?.intentClassifierVersion),
		intentLaunchState: normalizeIntentString(observability?.intentLaunchState),
		intentNextAction: normalizeIntentString(observability?.intentNextAction),
		intentPolicyReason: normalizeIntentString(observability?.intentPolicyReason),
		intentScopeClass: normalizeIntentString(observability?.intentScopeClass),
		intentScopeReason: normalizeIntentString(observability?.intentScopeReason),
		intentTaskKind: normalizeIntentString(observability?.intentTaskKind),
		intentSchemaVersion: normalizeIntentString(observability?.intentSchemaVersion),
		intentRoutingConfidence: normalizeIntentString(observability?.intentRoutingConfidence),
		intentAmbiguitySignal: normalizeIntentString(observability?.intentAmbiguitySignal),
		intentContextResolutionState: normalizeIntentString(
			observability?.intentContextResolutionState,
		),
		intentContextReferenceType: normalizeIntentString(observability?.intentContextReferenceType),
		intentResolvedSlots: observability?.intentResolvedSlots ?? null,
		intentMissingSlots: observability?.intentMissingSlots ?? null,
		intentAmbiguityReason: normalizeIntentString(observability?.intentAmbiguityReason),
		measuredAt: input.completedAt,
		modelName: observability?.promptTrace?.modelName ?? observability?.modelName ?? null,
		modelProvider:
			observability?.promptTrace?.modelProvider ?? observability?.modelProvider ?? null,
		promptId: observability?.promptTrace?.promptId ?? null,
		promptRuntimeDetail: observability?.promptRuntimeDetail ?? null,
		promptRuntimeState: observability?.promptRuntimeState ?? null,
		promptVersion: observability?.promptTrace?.promptVersion ?? null,
		outputTokens: observability?.outputTokens ?? null,
		policyProjectionVersion:
			input.principal.authorization?.retrievalFilter.policyProjectionVersion ?? null,
		policyReason: normalizePolicyReason({
			diagnostics: input.diagnostics,
			response: input.response,
			status: input.status,
		}),
		retrievalAdequacyReason: normalizeRetrievalAdequacyReason(input.diagnostics),
		retrievalAdequacyVerdict: normalizeRetrievalAdequacyVerdict(input.diagnostics),
		principalType: input.principal.principal.type,
		projectionLagMs: null,
		requestId: input.requestId,
		requestedCapability: input.requestedCapability,
		requestedScopeSummary: toScopeSummary(input.requestedScope),
		versionQueryMode: versionSummary.mode,
		versionQuerySummary: versionSummary.summary,
		resolvedScopeSummary: toScopeSummary(input.resolvedScope),
		refusalClass: normalizeRefusalClass(input.diagnostics, input.response, input.status),
		scopeClass: normalizeScopeClass({
			diagnostics: input.diagnostics,
			requestedScope: input.requestedScope,
			resolvedScope: input.resolvedScope,
			response: input.response,
			status: input.status,
		}),
		semanticOutcome: normalizeSemanticOutcome({
			diagnostics: input.diagnostics,
			response: input.response,
			status: input.status,
		}),
		safetyIdentifier: input.safetyIdentifier ?? null,
		templateSha256: observability?.promptTrace?.templateSha256 ?? null,
		retrievedSourceCount,
		retrievalAttempted,
		selectedCapability: input.response.selectedCapability,
		selectedTool: observability?.selectedTool ?? null,
		startedAt: input.startedAt,
		status: input.status,
		surface: input.surface,
		traceAvailable: Boolean(input.traceId),
		traceId: input.traceId,
		toolBusinessOutcome: observability?.toolBusinessOutcome ?? null,
		toolFailCloseReason: observability?.toolFailCloseReason ?? null,
		toolHistoricalDowngradeReason: observability?.toolHistoricalDowngradeReason ?? null,
		updatedAt: input.completedAt,
		workflowTraceSummary: input.response.workflowTraceSummary ?? null,
	};
}

export function summarizeRequestedScope(scope: RequestedScope | null | undefined): string | null {
	return toScopeSummary(scope);
}
