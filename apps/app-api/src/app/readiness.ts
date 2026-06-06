import { type Env, isDeployedEnvironment, readAppApiConfig, resolveEnvironment } from "../config";
import { probeRuntimeDatabase } from "../db/runtime";
import { buildBetterAuthConfig, probeAppAuthRuntime } from "../modules/auth";
import type { ExecutionControlRuntimePreflight } from "../modules/integration";
import { probeExecutionControlReady } from "../modules/integration";
import type { AppRuntimeReadinessResult } from "./types";

function formatRuntimeDependencyFailure(error: unknown): string {
	return error instanceof Error ? error.message : "Unknown dependency probe failure.";
}

export async function defaultRuntimeReadinessProbe(env: Env): Promise<AppRuntimeReadinessResult> {
	const requireDurableRuntime = isDeployedEnvironment(resolveEnvironment(env));
	const dependencies: AppRuntimeReadinessResult["dependencies"] = {
		auth: "not_ready",
		authShellOrigin: "configured",
		database: "not_ready",
		durableRuntime: requireDurableRuntime ? "not_ready" : "not_required",
		officialWebHandoff:
			env.APP_API_OFFICIAL_WEB_HANDOFF_URL?.trim() && env.APP_API_OFFICIAL_WEB_HANDOFF_TOKEN?.trim()
				? "configured"
				: "not_configured",
		operatorBridge: "configured",
		publicChatCompatibilityOrigin: "configured",
		executionControl: "not_ready",
	};
	const failed: AppRuntimeReadinessResult["failed"] = {};
	const preflight: AppRuntimeReadinessResult["preflight"] = {};

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
			authShellOrigin: config.authShellOrigin,
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
				executionControl: formatRuntimeDependencyFailure(error),
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
		const supervisorReadiness = await probeExecutionControlReady(env);
		dependencies.executionControl = "ready";
		preflight.durableRuntime = supervisorReadiness.durableRuntime;
		if (requireDurableRuntime) {
			if (supervisorReadiness.durableRuntime.status === "ready") {
				dependencies.durableRuntime = "ready";
			} else {
				failed.durableRuntime = formatDurableRuntimePreflightFailure(
					supervisorReadiness.durableRuntime,
				);
			}
		}
		preflight.campusServicesProductPath = supervisorReadiness.campusServicesProductPath;
	} catch (error) {
		failed.executionControl = formatRuntimeDependencyFailure(error);
		if (requireDurableRuntime) {
			failed.durableRuntime = formatRuntimeDependencyFailure(error);
		}
	}

	return {
		dependencies,
		failed,
		preflight,
	};
}

function formatDurableRuntimePreflightFailure(
	preflight: ExecutionControlRuntimePreflight,
): string {
	if (!preflight) {
		return "Execution control runtime readiness was not reported.";
	}
	const messages = Object.values(preflight.blockers);
	if (messages.length === 0) {
		return "Execution control runtime readiness was not reported.";
	}
	return messages.join("; ");
}
