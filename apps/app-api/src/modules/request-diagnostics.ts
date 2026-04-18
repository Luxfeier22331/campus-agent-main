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

export interface RequestDiagnosticsSummary {
  claimSupportSummary: RequestClaimSupportSummary | null;
  sourceTrustSummary?: RequestSourceTrustSummary | null;
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
        readField(
          rawSourceTrustSummary,
          "freshness_claim_blocked",
          "freshnessClaimBlocked",
        ),
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
      readField(
        diagnosticsRecord,
        "retrieval_adequacy_verdict",
        "retrievalAdequacyVerdict",
      ),
    ),
    retrievalAdequacyReason: normalizeOptionalString(
      readField(
        diagnosticsRecord,
        "retrieval_adequacy_reason",
        "retrievalAdequacyReason",
      ),
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
    scopeClass: normalizeOptionalString(
      readField(diagnosticsRecord, "scope_class", "scopeClass"),
    ),
    policyReason: normalizeOptionalString(
      readField(diagnosticsRecord, "policy_reason", "policyReason"),
    ),
    resolvedPolicyDocumentId: normalizeOptionalString(
      readField(
        diagnosticsRecord,
        "resolved_policy_document_id",
        "resolvedPolicyDocumentId",
      ),
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
      readField(
        diagnosticsRecord,
        "resolved_program_family_title",
        "resolvedProgramFamilyTitle",
      ),
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
