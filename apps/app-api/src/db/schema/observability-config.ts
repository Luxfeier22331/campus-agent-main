import { boolean, integer, jsonb, numeric, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

import type { ProviderConfigActor, ProviderConfigSecretRef } from "../../modules/provider-config";

const observabilityConfig = pgSchema("observability_config");

export const llmDebugTraceConfig = observabilityConfig.table("llm_debug_trace_config", {
	configId: text("config_id").primaryKey(),
	mode: text("mode").notNull(),
	includeModelIo: boolean("include_model_io").notNull().default(false),
	sampleRatio: numeric("sample_ratio").notNull().default("1"),
	otlpEndpoint: text("otlp_endpoint"),
	publicTraceBaseUrl: text("public_trace_base_url"),
	authHeaderSecretJson: jsonb("auth_header_secret_json").$type<ProviderConfigSecretRef | null>(),
	revision: integer("revision").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
	updatedByJson: jsonb("updated_by_json").$type<ProviderConfigActor>().notNull(),
});
