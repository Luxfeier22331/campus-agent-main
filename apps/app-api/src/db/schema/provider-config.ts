import { boolean, index, integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

import type {
	ProviderConfigActor,
	ProviderConfigSecretRef,
	ProviderConfigValidationResult,
} from "../../modules/provider-config/types";

const providerConfig = pgSchema("provider_config");

export const providerConfigProfiles = providerConfig.table(
	"profiles",
	{
		profileId: text("profile_id").primaryKey(),
		kind: text("kind").notNull(),
		role: text("role").notNull(),
		provider: text("provider").notNull(),
		transport: text("transport").notNull(),
		baseUrl: text("base_url").notNull(),
		model: text("model").notNull(),
		dimensions: integer("dimensions"),
		timeoutMs: integer("timeout_ms").notNull(),
		apiKeySecretJson: jsonb("api_key_secret_json").$type<ProviderConfigSecretRef>().notNull(),
		status: text("status").notNull(),
		active: boolean("active").notNull().default(false),
		revision: integer("revision").notNull(),
		validationJson: jsonb("validation_json").$type<ProviderConfigValidationResult | null>(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		createdByJson: jsonb("created_by_json").$type<ProviderConfigActor>().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		updatedByJson: jsonb("updated_by_json").$type<ProviderConfigActor>().notNull(),
	},
	(table) => ({
		activeRoleIndex: index("provider_config_profiles_active_role_idx").on(
			table.role,
			table.active,
			table.updatedAt,
		),
		kindRoleUpdatedAtIndex: index("provider_config_profiles_kind_role_updated_idx").on(
			table.kind,
			table.role,
			table.updatedAt,
		),
	}),
);
