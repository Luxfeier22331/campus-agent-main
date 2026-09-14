import type { Env } from "../config";
import { probeRuntimeDatabase } from "../db/runtime";
import { probeAppAuthRuntime } from "../modules/auth";
import { reportRuntimeFailure } from "../runtime-diagnostics";
import type { AppRuntimeReadinessResult } from "./types";

function formatRuntimeDependencyFailure(_error: unknown): string {
	return "Runtime dependency probe failed.";
}

export async function defaultRuntimeReadinessProbe(env: Env): Promise<AppRuntimeReadinessResult> {
	const dependencies: AppRuntimeReadinessResult["dependencies"] = {
		auth: "not_ready",
		database: "not_ready",
	};
	const failed: AppRuntimeReadinessResult["failed"] = {};

	try {
		await probeRuntimeDatabase(env);
		dependencies.database = "ready";
	} catch (error) {
		reportRuntimeFailure(error, {
			source: "app-api.readiness",
			error_code: "dependency_probe_failed",
			operation: "database",
		});
		failed.database = formatRuntimeDependencyFailure(error);
	}

	try {
		await probeAppAuthRuntime(env);
		dependencies.auth = "ready";
	} catch (error) {
		reportRuntimeFailure(error, {
			source: "app-api.readiness",
			error_code: "dependency_probe_failed",
			operation: "auth",
		});
		failed.auth = formatRuntimeDependencyFailure(error);
	}

	return {
		dependencies,
		failed,
	};
}
