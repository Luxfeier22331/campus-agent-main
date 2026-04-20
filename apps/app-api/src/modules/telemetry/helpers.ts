import { createHash } from "node:crypto";

import type { RequestedScope } from "../integration";
import type { TraceDataLike } from "./trace";

export function hashIdentifier(value: string | null): string | null {
  if (!value?.trim()) {
    return null;
  }

  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function normalizeString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function toScopeSummary(scope: RequestedScope | null | undefined): string | null {
  if (!scope) {
    return null;
  }

  return `${scope.corpus}/${scope.collection}`;
}

export function toSourceDocIdsSummary(sourceDocIds: string[]): string | null {
  if (sourceDocIds.length === 0) {
    return null;
  }

  return sourceDocIds.slice(0, 3).join(",");
}

export function runSentrySafely(operation: () => void): void {
  try {
    operation();
  } catch {
    // Telemetry must never become a request-path failure source.
  }
}

export function readSentryTraceDataSafely(
  traceDataProvider: () => TraceDataLike | null | undefined,
): TraceDataLike {
  try {
    return traceDataProvider() ?? {};
  } catch {
    return {};
  }
}
