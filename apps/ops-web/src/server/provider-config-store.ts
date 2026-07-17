import type {
	ProviderConfigActor,
	ProviderConfigConnection,
	ProviderConfigProfile,
	ProviderConfigStore,
} from "@campus-agent/provider-config";
import { Pool } from "pg";
import { resolvePostgresTlsConfig } from "./postgres-tls.ts";

export interface ProviderConfigStoreEnv {
	OPS_WEB_PROVIDER_CONFIG_DATABASE_CA_CERT_PATH?: string;
	OPS_WEB_PROVIDER_CONFIG_DATABASE_SSLMODE?: string;
	OPS_WEB_PROVIDER_CONFIG_DATABASE_URL?: string;
	OPS_WEB_PROVIDER_CONFIG_DB_POOL_MAX?: string;
}

export function createProviderConfigStoreFromEnv(env: ProviderConfigStoreEnv): ProviderConfigStore {
	const databaseUrl = env.OPS_WEB_PROVIDER_CONFIG_DATABASE_URL?.trim();
	if (!databaseUrl) {
		throw new Error("OPS_WEB_PROVIDER_CONFIG_DATABASE_URL is required.");
	}
	const tls = resolvePostgresTlsConfig({
		caCertPath: env.OPS_WEB_PROVIDER_CONFIG_DATABASE_CA_CERT_PATH,
		databaseUrl,
		deploymentEnvironment: process.env.DEPLOYMENT_ENVIRONMENT,
		nodeEnvironment: process.env.NODE_ENV,
		sslMode: env.OPS_WEB_PROVIDER_CONFIG_DATABASE_SSLMODE,
	});
	const pool = new Pool({
		connectionString: tls.connectionString,
		max: boundedInt(env.OPS_WEB_PROVIDER_CONFIG_DB_POOL_MAX, 3),
		ssl: tls.ssl,
	});
	pool.on("error", (error) => console.error("[ops-web] provider config postgres error", error));
	return createProviderConfigStore(pool);
}

export function createProviderConfigStore(db: Pick<Pool, "query">): ProviderConfigStore {
	return {
		async getConnection(id) {
			const result = await db.query(
				"SELECT * FROM provider_config.connections WHERE connection_id = $1",
				[id],
			);
			return result.rows[0] ? connectionFromRow(result.rows[0]) : null;
		},
		async getProfile(id) {
			const result = await db.query(
				"SELECT * FROM provider_config.profiles WHERE profile_id = $1",
				[id],
			);
			return result.rows[0] ? profileFromRow(result.rows[0]) : null;
		},
		async listConnections() {
			const result = await db.query(
				"SELECT * FROM provider_config.connections ORDER BY updated_at DESC",
			);
			return result.rows.map(connectionFromRow);
		},
		async listProfiles() {
			const result = await db.query(
				"SELECT * FROM provider_config.profiles ORDER BY updated_at DESC",
			);
			return result.rows.map(profileFromRow);
		},
		async saveConnection(value) {
			await db.query(
				`INSERT INTO provider_config.connections
				 (connection_id, provider, base_url, features_json, feature_config_json, api_key_secret_json,
				  revision, created_at, created_by_json, updated_at, updated_by_json)
				 VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9::jsonb,$10,$11::jsonb)
				 ON CONFLICT (connection_id) DO UPDATE SET provider=$2, base_url=$3, features_json=$4::jsonb,
				 feature_config_json=$5::jsonb, api_key_secret_json=$6::jsonb, revision=$7,
				 updated_at=$10, updated_by_json=$11::jsonb`,
				[
					value.connectionId,
					value.provider,
					value.baseUrl,
					JSON.stringify(value.features),
					JSON.stringify(value.featureConfig),
					JSON.stringify(value.apiKeySecret),
					value.revision,
					value.createdAt,
					JSON.stringify(value.createdBy),
					value.updatedAt,
					JSON.stringify(value.updatedBy),
				],
			);
		},
		async saveProfile(value) {
			await db.query(
				`INSERT INTO provider_config.profiles
				 (profile_id, kind, role, connection_id, transport, model, dimensions, timeout_ms, status,
				  revision, validation_json, created_at, created_by_json, updated_at, updated_by_json)
				 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb,$14,$15::jsonb)
				 ON CONFLICT (profile_id) DO UPDATE SET connection_id=$4, transport=$5, model=$6,
				 dimensions=$7, timeout_ms=$8, status=$9, revision=$10, validation_json=$11::jsonb,
				 updated_at=$14, updated_by_json=$15::jsonb`,
				[
					value.profileId,
					value.kind,
					value.role,
					value.connectionId,
					value.transport,
					value.model,
					value.dimensions,
					value.timeoutMs,
					value.status,
					value.revision,
					JSON.stringify(value.validation),
					value.createdAt,
					JSON.stringify(value.createdBy),
					value.updatedAt,
					JSON.stringify(value.updatedBy),
				],
			);
		},
		async verifyReadiness() {
			await db.query("SELECT 1 FROM provider_config.connections LIMIT 0");
			await db.query("SELECT 1 FROM provider_config.profiles LIMIT 0");
		},
	};
}

function actor(value: unknown): ProviderConfigActor {
	const item = value as Record<string, unknown>;
	return {
		displayName: String(item.displayName ?? ""),
		principalId: String(item.principalId ?? ""),
	};
}
function connectionFromRow(row: Record<string, unknown>): ProviderConfigConnection {
	return {
		apiKeySecret: row.api_key_secret_json as ProviderConfigConnection["apiKeySecret"],
		baseUrl: String(row.base_url),
		connectionId: String(row.connection_id),
		createdAt: dateIso(row.created_at),
		createdBy: actor(row.created_by_json),
		featureConfig: row.feature_config_json as Record<string, unknown>,
		features: row.features_json as ProviderConfigConnection["features"],
		provider: String(row.provider),
		revision: Number(row.revision),
		updatedAt: dateIso(row.updated_at),
		updatedBy: actor(row.updated_by_json),
	};
}
function profileFromRow(row: Record<string, unknown>): ProviderConfigProfile {
	return {
		connectionId: String(row.connection_id),
		createdAt: dateIso(row.created_at),
		createdBy: actor(row.created_by_json),
		dimensions: row.dimensions === null ? null : Number(row.dimensions),
		kind: row.kind as ProviderConfigProfile["kind"],
		model: String(row.model),
		profileId: String(row.profile_id),
		revision: Number(row.revision),
		role: row.role as ProviderConfigProfile["role"],
		status: row.status as ProviderConfigProfile["status"],
		timeoutMs: Number(row.timeout_ms),
		transport: String(row.transport),
		updatedAt: dateIso(row.updated_at),
		updatedBy: actor(row.updated_by_json),
		validation: row.validation_json as ProviderConfigProfile["validation"],
	};
}
function dateIso(value: unknown): string {
	return new Date(value as string | number | Date).toISOString();
}
function boundedInt(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isInteger(parsed) && parsed > 0 && parsed <= 8 ? parsed : fallback;
}
