import { count, eq } from "drizzle-orm";

import { type Env, readAppAuthConfig } from "../config";
import { probeRuntimeDatabase, withRuntimeDatabase } from "../db/runtime";
import { docsCollections } from "../db/schema";
import { probeAppAuthRuntime } from "../modules/auth";

export interface AppDocsReadinessResult {
	dependencies: {
		auth: "ready" | "not_ready";
		database: "ready" | "not_ready";
		docsReadModel: "ready" | "not_ready";
	};
	failed: Partial<Record<"auth" | "database" | "docsReadModel", string>>;
}

function formatRuntimeDependencyFailure(error: unknown): string {
	return error instanceof Error ? error.message : "Unknown dependency probe failure.";
}

async function probeDocsReadModel(env: Env, releaseId: string): Promise<void> {
	await withRuntimeDatabase(env, async (db) => {
		const rows = await db
			.select({ collectionCount: count() })
			.from(docsCollections)
			.where(eq(docsCollections.releaseId, releaseId));
		const collectionCount = rows[0]?.collectionCount ?? 0;
		if (collectionCount < 1) {
			throw new Error("docs read-model probe returned no collections");
		}
	});
}

export async function defaultDocsReadinessProbe(
	env: Env,
	releaseId: string,
): Promise<AppDocsReadinessResult> {
	const dependencies: AppDocsReadinessResult["dependencies"] = {
		auth: "not_ready",
		database: "not_ready",
		docsReadModel: "not_ready",
	};
	const failed: AppDocsReadinessResult["failed"] = {};

	try {
		readAppAuthConfig(env);
	} catch (error) {
		return {
			dependencies,
			failed: {
				auth: formatRuntimeDependencyFailure(error),
				database: formatRuntimeDependencyFailure(error),
				docsReadModel: formatRuntimeDependencyFailure(error),
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
		await probeDocsReadModel(env, releaseId);
		dependencies.docsReadModel = "ready";
	} catch (error) {
		failed.docsReadModel = formatRuntimeDependencyFailure(error);
	}

	return {
		dependencies,
		failed,
	};
}
