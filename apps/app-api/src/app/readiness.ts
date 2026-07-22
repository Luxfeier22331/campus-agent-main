import type { Env } from "../config";
import { probeRuntimeDatabase } from "../db/runtime";
import { probeAppAuthRuntime } from "../modules/auth";
import type { AppRuntimeReadinessResult } from "./types";

function formatRuntimeDependencyFailure(error: unknown): string {
	return error instanceof Error ? error.message : "Unknown dependency probe failure.";
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
		failed.database = formatRuntimeDependencyFailure(error);
	}

	try {
		await probeAppAuthRuntime(env);
		dependencies.auth = "ready";
	} catch (error) {
		failed.auth = formatRuntimeDependencyFailure(error);
	}

	return {
		dependencies,
		failed,
	};
}
