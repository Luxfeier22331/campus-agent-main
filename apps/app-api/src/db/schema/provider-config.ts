import { boolean, index, integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

import type {
	ProviderConfigActor,
	ProviderConfigCapability,
	ProviderConfigCapabilityConfig,
	ProviderConfigSecretRef,
	ProviderConfigValidationResult,
} from "../../modules/provider-config/types";

const providerConfig = pgSchema("provider_config");

export const providerConfigConnections = providerConfig.table(
	"connections",
	{
		connectionId: text("connection_id").primaryKey(),
		provider: text("provider").notNull(),
		baseUrl: text("base_url").notNull(),
		capabilitiesJson: jsonb("capabilities_json").$type<ProviderConfigCapability[]>().notNull(),
		capabilityConfigJson: jsonb("capability_config_json")
			.$type<ProviderConfigCapabilityConfig>()
			.notNull(),
		apiKeySecretJson: jsonb("api_key_secret_json").$type<ProviderConfigSecretRef>().notNull(),
		revision: integer("revision").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		createdByJson: jsonb("created_by_json").$type<ProviderConfigActor>().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
		updatedByJson: jsonb("updated_by_json").$type<ProviderConfigActor>().notNull(),
	},
	(table) => ({
		providerUpdatedAtIndex: index("provider_config_connections_provider_updated_idx").on(
			table.provider,
			table.updatedAt,
		),
	}),
);

export const providerConfigProfiles = providerConfig.table(
	"profiles",
	{
		profileId: text("profile_id").primaryKey(),
		kind: text("kind").notNull(),
		role: text("role").notNull(),
		connectionId: text("connection_id")
			.notNull()
			.references(() => providerConfigConnections.connectionId),
		provider: text("provider"),
		transport: text("transport").notNull(),
		baseUrl: text("base_url"),
		model: text("model").notNull(),
		dimensions: integer("dimensions"),
		timeoutMs: integer("timeout_ms").notNull(),
		apiKeySecretJson: jsonb("api_key_secret_json").$type<ProviderConfigSecretRef | null>(),
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
