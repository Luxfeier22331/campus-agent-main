import { eq } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import { llmDebugTraceConfig } from "../../db/schema";
import type { LlmDebugTraceConfig } from "./types";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

const ACTIVE_CONFIG_ID = "active";

export interface ObservabilityConfigStore {
	getActive(): Promise<LlmDebugTraceConfig | null>;
	save(config: LlmDebugTraceConfig): Promise<void>;
}

function clone<T>(value: T): T {
	return structuredClone(value);
}

function toDate(value: string): Date {
	return new Date(value);
}

export function createInMemoryObservabilityConfigStore(): ObservabilityConfigStore {
	let current: LlmDebugTraceConfig | null = null;
	return {
		async getActive() {
			return current ? clone(current) : null;
		},
		async save(config) {
			current = clone({ ...config, configId: ACTIVE_CONFIG_ID });
		},
	};
}

export function createPgObservabilityConfigStore(
	env: Env,
	input: { getDb?: RuntimeDbGetter } = {},
): ObservabilityConfigStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env, { consistency: "fresh" });
	return {
		async getActive() {
			const db = await getDb();
			const rows = await db
				.select()
				.from(llmDebugTraceConfig)
				.where(eq(llmDebugTraceConfig.configId, ACTIVE_CONFIG_ID))
				.limit(1);
			return rows[0] ? toConfig(rows[0]) : null;
		},
		async save(config) {
			const db = await getDb();
			await db
				.insert(llmDebugTraceConfig)
				.values(writeConfigRow({ ...config, configId: ACTIVE_CONFIG_ID }))
				.onConflictDoUpdate({
					set: writeConfigRow({ ...config, configId: ACTIVE_CONFIG_ID }),
					target: llmDebugTraceConfig.configId,
				});
		},
	};
}

function toConfig(row: typeof llmDebugTraceConfig.$inferSelect): LlmDebugTraceConfig {
	return {
		authHeaderSecret: row.authHeaderSecretJson ?? undefined,
		configId: "active",
		includeModelIo: row.includeModelIo,
		mode: row.mode as LlmDebugTraceConfig["mode"],
		otlpEndpoint: row.otlpEndpoint ?? undefined,
		publicTraceBaseUrl: row.publicTraceBaseUrl ?? undefined,
		revision: row.revision,
		sampleRatio: Number(row.sampleRatio),
		updatedAt: row.updatedAt.toISOString(),
		updatedBy: row.updatedByJson,
	};
}

function writeConfigRow(config: LlmDebugTraceConfig): typeof llmDebugTraceConfig.$inferInsert {
	return {
		authHeaderSecretJson: config.authHeaderSecret ?? null,
		configId: ACTIVE_CONFIG_ID,
		includeModelIo: config.includeModelIo,
		mode: config.mode,
		otlpEndpoint: config.otlpEndpoint ?? null,
		publicTraceBaseUrl: config.publicTraceBaseUrl ?? null,
		revision: config.revision,
		sampleRatio: String(config.sampleRatio),
		updatedAt: toDate(config.updatedAt),
		updatedByJson: config.updatedBy,
	};
}
