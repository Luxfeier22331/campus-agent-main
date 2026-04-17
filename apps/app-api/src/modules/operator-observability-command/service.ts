import { AppApiRouteError } from "../../http";
import type { OperatorObservabilityCommandStore } from "./store";

const ALLOWED_GRADE_DOMAINS = new Set(["grounding", "citation", "policy"]);
const ALLOWED_GRADE_VERDICTS = new Set(["pass", "fail", "needs_review"]);

export interface OperatorQualityGradePayloadItem {
  requestId?: unknown;
  traceId?: unknown;
  gradeSource?: unknown;
  gradeDomain?: unknown;
  verdict?: unknown;
  score?: unknown;
  graderVersion?: unknown;
  sampledAt?: unknown;
  rationaleSummary?: unknown;
}

export interface OperatorTraceBacklinkPayloadItem {
  requestId?: unknown;
  traceId?: unknown;
  traceLink?: unknown;
  issueLink?: unknown;
  issueFingerprint?: unknown;
}

export interface OperatorQualityGradesPayload {
  grades?: unknown;
}

export interface OperatorTraceBacklinksPayload {
  backlinks?: unknown;
}

export interface OperatorObservabilityCommandService {
  ingestGrades(input: { payload: OperatorQualityGradesPayload }): Promise<{ accepted: number }>;
  ingestTraceBacklinks(input: {
    payload: OperatorTraceBacklinksPayload;
  }): Promise<{ accepted: number }>;
}

export interface OperatorObservabilityCommandServiceDependencies {
  now?: () => Date;
  store: OperatorObservabilityCommandStore;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableString(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized || null;
}

function normalizeIsoTimestamp(value: unknown, field: string): string {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field },
      message: `${field} is required.`,
      retryable: false,
      status: 422,
    });
  }

  const timestamp = new Date(normalized);
  if (Number.isNaN(timestamp.valueOf())) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field },
      message: `${field} must be a valid ISO timestamp.`,
      retryable: false,
      status: 422,
    });
  }

  return timestamp.toISOString();
}

function normalizeRequiredString(value: unknown, field: string): string {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field },
      message: `${field} is required.`,
      retryable: false,
      status: 422,
    });
  }

  return normalized;
}

function normalizeScore(value: unknown, field: string): {
  score: number | null;
  scoreMilli: number | null;
} {
  if (value === null || value === undefined || value === "") {
    return { score: null, scoreMilli: null };
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field },
      message: `${field} must be a number between 0 and 1.`,
      retryable: false,
      status: 422,
    });
  }

  return {
    score: value,
    scoreMilli: Math.round(value * 1000),
  };
}

function ensureArray<T>(value: unknown, field: string): T[] {
  if (!Array.isArray(value)) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field },
      message: `${field} must be an array.`,
      retryable: false,
      status: 422,
    });
  }

  return value as T[];
}

function normalizeGradeDomain(value: unknown, field: string): string {
  const normalized = normalizeRequiredString(value, field);
  if (!ALLOWED_GRADE_DOMAINS.has(normalized)) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field },
      message: `${field} must be one of grounding, citation, policy.`,
      retryable: false,
      status: 422,
    });
  }

  return normalized;
}

function normalizeGradeVerdict(value: unknown, field: string): string {
  const normalized = normalizeRequiredString(value, field);
  if (!ALLOWED_GRADE_VERDICTS.has(normalized)) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field },
      message: `${field} must be one of pass, fail, needs_review.`,
      retryable: false,
      status: 422,
    });
  }

  return normalized;
}

function buildGradeId(input: {
  requestId: string;
  gradeSource: string;
  gradeDomain: string;
}): string {
  return `${input.requestId}:${input.gradeSource}:${input.gradeDomain}`;
}

export function buildOperatorObservabilityCommandService(
  dependencies: OperatorObservabilityCommandServiceDependencies,
): OperatorObservabilityCommandService {
  const now = dependencies.now ?? (() => new Date());

  return {
    async ingestGrades(input) {
      const grades = ensureArray<OperatorQualityGradePayloadItem>(input.payload.grades, "grades");
      const writes = [];

      for (let index = 0; index < grades.length; index += 1) {
        const item = grades[index] ?? {};
        const prefix = `grades[${index}]`;
        const requestId = normalizeRequiredString(item.requestId, `${prefix}.requestId`);
        const traceId = normalizeRequiredString(item.traceId, `${prefix}.traceId`);
        const gradeSource = normalizeRequiredString(item.gradeSource, `${prefix}.gradeSource`);
        const gradeDomain = normalizeGradeDomain(item.gradeDomain, `${prefix}.gradeDomain`);
        const verdict = normalizeGradeVerdict(item.verdict, `${prefix}.verdict`);
        const graderVersion = normalizeRequiredString(item.graderVersion, `${prefix}.graderVersion`);
        const sampledAt = normalizeIsoTimestamp(item.sampledAt, `${prefix}.sampledAt`);
        const rationaleSummary = normalizeNullableString(item.rationaleSummary);
        const score = normalizeScore(item.score, `${prefix}.score`);

        const seed = await dependencies.store.getRequestObservabilitySeed(requestId);
        if (!seed) {
          throw new AppApiRouteError({
            code: "request_not_found",
            details: { requestId },
            message: "Request observability seed not found.",
            retryable: false,
            status: 404,
          });
        }
        if (seed.traceId !== traceId) {
          throw new AppApiRouteError({
            code: "validation_failed",
            details: { field: `${prefix}.traceId`, requestId },
            message: `${prefix}.traceId must match the request-scoped traceId.`,
            retryable: false,
            status: 422,
          });
        }

        writes.push({
          collection: seed.collection,
          gradeDomain,
          gradeId: buildGradeId({ gradeDomain, gradeSource, requestId }),
          gradeSource,
          graderVersion,
          modelName: seed.modelName,
          principalType: seed.principalType,
          projectedAt: now().toISOString(),
          rationaleSummary,
          requestId,
          requestStartedAt: seed.requestStartedAt,
          requestedCapability: seed.requestedCapability,
          sampledAt,
          scoreMilli: score.scoreMilli,
          selectedTarget: seed.selectedTarget,
          surface: seed.surface,
          traceId,
          verdict,
        });
      }

      await dependencies.store.upsertQualityGrades({ grades: writes });
      return { accepted: writes.length };
    },

    async ingestTraceBacklinks(input) {
      const backlinks = ensureArray<OperatorTraceBacklinkPayloadItem>(
        input.payload.backlinks,
        "backlinks",
      );
      const writes = [];

      for (let index = 0; index < backlinks.length; index += 1) {
        const item = backlinks[index] ?? {};
        const prefix = `backlinks[${index}]`;
        const requestId = normalizeRequiredString(item.requestId, `${prefix}.requestId`);
        const traceId = normalizeRequiredString(item.traceId, `${prefix}.traceId`);
        const seed = await dependencies.store.getRequestObservabilitySeed(requestId);
        if (!seed) {
          throw new AppApiRouteError({
            code: "request_not_found",
            details: { requestId },
            message: "Request observability seed not found.",
            retryable: false,
            status: 404,
          });
        }
        if (seed.traceId !== traceId) {
          throw new AppApiRouteError({
            code: "validation_failed",
            details: { field: `${prefix}.traceId`, requestId },
            message: `${prefix}.traceId must match the request-scoped traceId.`,
            retryable: false,
            status: 422,
          });
        }

        writes.push({
          issueFingerprint: normalizeNullableString(item.issueFingerprint),
          issueLink: normalizeNullableString(item.issueLink),
          projectedAt: now().toISOString(),
          requestId,
          traceId,
          traceLink: normalizeNullableString(item.traceLink),
        });
      }

      await dependencies.store.upsertTraceBacklinks({ backlinks: writes });
      return { accepted: writes.length };
    },
  };
}
