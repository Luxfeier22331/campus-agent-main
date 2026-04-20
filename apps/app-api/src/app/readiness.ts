import { readAppApiConfig, type Env } from "../config";
import { probeRuntimeDatabase } from "../db/runtime";
import { buildBetterAuthConfig, probeAppAuthRuntime } from "../modules/auth";
import { probeSupervisorApiReady } from "../modules/integration";
import type { AppRuntimeReadinessResult } from "./types";

function formatRuntimeDependencyFailure(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown dependency probe failure.";
}

export async function defaultRuntimeReadinessProbe(
  env: Env,
): Promise<AppRuntimeReadinessResult> {
  const dependencies: AppRuntimeReadinessResult["dependencies"] = {
    auth: "not_ready",
    database: "not_ready",
    officialWebHandoff:
      env.APP_API_OFFICIAL_WEB_HANDOFF_URL?.trim() &&
      env.APP_API_OFFICIAL_WEB_HANDOFF_TOKEN?.trim()
        ? "configured"
        : "not_configured",
    operatorBridge: "configured",
    publicChatOrigin: "configured",
    supervisorApi: "not_ready",
  };
  const failed: AppRuntimeReadinessResult["failed"] = {};

  try {
    const config = readAppApiConfig(env);
    buildBetterAuthConfig({
      appName: config.appName,
      authResetEmailFrom: config.authResetEmailFrom,
      authResetEmailReplyTo: config.authResetEmailReplyTo,
      authTurnstileSecretKey: config.authTurnstileSecretKey,
      betterAuthSecret: config.betterAuthSecret,
      database: {},
      endUserEmailAllowlist: config.endUserEmailAllowlist,
      endUserEmailDomainAllowlist: config.endUserEmailDomainAllowlist,
      environment: config.environment,
      publicChatOrigin: config.publicChatOrigin,
      resendApiKey: config.resendApiKey,
      resendFetch: fetch,
    });
  } catch (error) {
    return {
      dependencies,
      failed: {
        auth: formatRuntimeDependencyFailure(error),
        database: formatRuntimeDependencyFailure(error),
        supervisorApi: formatRuntimeDependencyFailure(error),
      },
    };
  }

  try {
    await probeRuntimeDatabase(env);
    dependencies.database = "ready";
  } catch (error) {
    failed.database = formatRuntimeDependencyFailure(error);
  }

  try {
    await probeAppAuthRuntime(env);
    dependencies.auth = "ready";
  } catch (error) {
    failed.auth = formatRuntimeDependencyFailure(error);
  }

  try {
    await probeSupervisorApiReady(env);
    dependencies.supervisorApi = "ready";
  } catch (error) {
    failed.supervisorApi = formatRuntimeDependencyFailure(error);
  }

  return {
    dependencies,
    failed,
  };
}
