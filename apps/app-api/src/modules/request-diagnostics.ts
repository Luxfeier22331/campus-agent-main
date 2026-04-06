export interface RequestDiagnosticsSummary {
  resolvedPolicyDocumentId: string | null;
  resolvedPolicyTitle: string | null;
  rewrittenQuery: string | null;
  clarificationReason: string | null;
  noAnswerReason: string | null;
  semanticOutcome: string | null;
  scopeClass: string | null;
  policyReason: string | null;
  retrievedTitleSummary: string[];
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

export function extractRequestDiagnosticsSummary(
  result: unknown,
): RequestDiagnosticsSummary | null {
  const resultRecord = getRecord(result);
  const diagnosticsRecord = getRecord(resultRecord?.diagnostics);
  if (!diagnosticsRecord) {
    return null;
  }

  const summary: RequestDiagnosticsSummary = {
    clarificationReason: normalizeOptionalString(
      readField(diagnosticsRecord, "clarification_reason", "clarificationReason"),
    ),
    noAnswerReason: normalizeOptionalString(
      readField(diagnosticsRecord, "no_answer_reason", "noAnswerReason"),
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
    scopeClass: normalizeOptionalString(
      readField(diagnosticsRecord, "scope_class", "scopeClass"),
    ),
    semanticOutcome: normalizeOptionalString(
      readField(diagnosticsRecord, "semantic_outcome", "semanticOutcome"),
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
    !summary.resolvedPolicyDocumentId &&
    !summary.resolvedPolicyTitle &&
    !summary.rewrittenQuery &&
    !summary.clarificationReason &&
    !summary.noAnswerReason &&
    !summary.semanticOutcome &&
    !summary.scopeClass &&
    !summary.policyReason &&
    !summary.resolvedEntityType &&
    !summary.resolvedProgramFamilyTitle &&
    !summary.sessionProgramFamily &&
    !summary.sessionProgram &&
    !summary.sessionSemester &&
    summary.retrievedTitleSummary.length === 0
  ) {
    return null;
  }

  return summary;
}
