export interface RequestDiagnosticsSummary {
  resolvedPolicyDocumentId: string | null;
  resolvedPolicyTitle: string | null;
  rewrittenQuery: string | null;
  clarificationReason: string | null;
  noAnswerReason: string | null;
  retrievedTitleSummary: string[];
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
    summary.retrievedTitleSummary.length === 0
  ) {
    return null;
  }

  return summary;
}
