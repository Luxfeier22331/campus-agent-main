import { AppApiRouteError } from "../../http";
import type { OfficialWebIngestionExecutionStatus } from "../official-web-command";
import {
  toOfficialWebRunProjectionMaterialization,
  toOfficialWebSiteProjectionMaterialization,
  type OfficialWebProjectionProjectorStore,
} from "../official-web-projection";

export interface OfficialWebExecutionStatusPayload {
  errorCode?: unknown;
  errorMessage?: unknown;
  executionRef?: unknown;
  status?: unknown;
  updatedAt?: unknown;
}

export interface OfficialWebExecutionStatusService {
  updateRunExecutionStatus(input: {
    payload: OfficialWebExecutionStatusPayload;
    runId: string;
  }): Promise<{
    run: {
      ingestionExecutionErrorCode: string | null;
      ingestionExecutionErrorMessage: string | null;
      ingestionExecutionRef: string | null;
      ingestionExecutionStatus: OfficialWebIngestionExecutionStatus;
      ingestionExecutionUpdatedAt: string;
      runId: string;
    };
  }>;
}

export interface OfficialWebExecutionStatusServiceDependencies {
  now?: () => Date;
  store: OfficialWebProjectionProjectorStore;
}

const ALLOWED_EXECUTION_STATUSES = new Set<OfficialWebIngestionExecutionStatus>([
  "pending",
  "running",
  "staged",
  "promoted",
  "succeeded",
  "failed",
]);

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeRequiredStatus(value: unknown): OfficialWebIngestionExecutionStatus {
  const normalized = normalizeOptionalString(value);
  if (!normalized || !ALLOWED_EXECUTION_STATUSES.has(normalized as OfficialWebIngestionExecutionStatus)) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field: "status" },
      message: "status must be one of: pending, running, staged, promoted, succeeded, failed.",
      retryable: false,
      status: 422,
    });
  }
  return normalized as OfficialWebIngestionExecutionStatus;
}

function normalizeUpdatedAt(value: unknown, fallbackNow: Date): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return fallbackNow.toISOString();
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.valueOf())) {
    throw new AppApiRouteError({
      code: "validation_failed",
      details: { field: "updatedAt" },
      message: "updatedAt must be a valid ISO timestamp.",
      retryable: false,
      status: 422,
    });
  }
  return parsed.toISOString();
}

export function buildOfficialWebExecutionStatusService(
  dependencies: OfficialWebExecutionStatusServiceDependencies,
): OfficialWebExecutionStatusService {
  const now = dependencies.now ?? (() => new Date());

  return {
    async updateRunExecutionStatus(input) {
      const status = normalizeRequiredStatus(input.payload.status);
      const updatedAt = normalizeUpdatedAt(input.payload.updatedAt, now());
      const executionRef = normalizeOptionalString(input.payload.executionRef);
      const shouldPersistExecutionError = status === "failed" || status === "staged";
      const errorCode = shouldPersistExecutionError ? normalizeOptionalString(input.payload.errorCode) : null;
      const errorMessage = shouldPersistExecutionError
        ? normalizeOptionalString(input.payload.errorMessage)
        : null;

      const updated = await dependencies.store.updateRunExecutionStatus({
        errorCode,
        errorMessage,
        executionRef,
        runId: input.runId,
        status,
        updatedAt,
      });
      if (!updated) {
        throw new AppApiRouteError({
          code: "run_not_found",
          details: { runId: input.runId },
          message: "Official web run not found.",
          retryable: false,
          status: 404,
        });
      }

      const run = await dependencies.store.getRunProjectionSource(input.runId);
      if (!run) {
        throw new AppApiRouteError({
          code: "run_not_found",
          details: { runId: input.runId },
          message: "Official web run not found.",
          retryable: false,
          status: 404,
        });
      }

      await dependencies.store.upsertRunProjection(
        toOfficialWebRunProjectionMaterialization({
          execution: run,
          projectedAt: updatedAt,
        }),
      );

      const site = await dependencies.store.getSiteProjectionSource(run.siteId);
      if (site) {
        await dependencies.store.upsertSiteProjection(
          toOfficialWebSiteProjectionMaterialization({
            execution: site,
            projectedAt: updatedAt,
          }),
        );
      }

      return {
        run: {
          ingestionExecutionErrorCode: run.ingestionExecutionErrorCode,
          ingestionExecutionErrorMessage: run.ingestionExecutionErrorMessage,
          ingestionExecutionRef: run.ingestionExecutionRef,
          ingestionExecutionStatus: run.ingestionExecutionStatus,
          ingestionExecutionUpdatedAt: run.ingestionExecutionUpdatedAt ?? updatedAt,
          runId: run.runId,
        },
      };
    },
  };
}
