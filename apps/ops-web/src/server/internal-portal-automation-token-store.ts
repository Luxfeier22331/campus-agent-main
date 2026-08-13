import { Pool } from "pg";
import { resolvePostgresTlsConfig } from "./postgres-tls.ts";
import { logOpsError } from "./safe-logging.ts";

export interface InternalPortalAutomationTokenRecord {
	createdAt: string;
	name: string;
	revokedAt: string | null;
	tokenHash: string;
	tokenId: string;
	tokenValue: string;
}

export type InternalPortalAutomationTokenMetadata = Omit<
	InternalPortalAutomationTokenRecord,
	"tokenHash" | "tokenValue"
>;

export interface InternalPortalAutomationTokenStoreEnv {
	DEPLOYMENT_ENVIRONMENT?: string;
	NODE_ENV?: string;
	OPS_WEB_DATABASE_CA_CERT_PATH?: string;
	OPS_WEB_DATABASE_SSLMODE?: string;
	OPS_WEB_DATABASE_URL?: string;
}

export interface InternalPortalAutomationTokenStore {
	authenticate(tokenHash: string): Promise<InternalPortalAutomationTokenMetadata | null>;
	create(input: {
		createdAt: Date;
		name: string;
		tokenHash: string;
		tokenId: string;
		tokenValue: string;
	}): Promise<InternalPortalAutomationTokenRecord>;
	get(tokenId: string): Promise<InternalPortalAutomationTokenRecord | null>;
	list(): Promise<InternalPortalAutomationTokenMetadata[]>;
	revoke(tokenId: string, revokedAt: Date): Promise<InternalPortalAutomationTokenRecord>;
}

export class InternalPortalAutomationTokenStoreUnavailableError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "InternalPortalAutomationTokenStoreUnavailableError";
	}
}

export class InternalPortalAutomationTokenNotFoundError extends Error {
	constructor() {
		super("未找到自动化访问 token。");
		this.name = "InternalPortalAutomationTokenNotFoundError";
	}
}

export function createUnavailableInternalPortalAutomationTokenStore(
	error: unknown,
): InternalPortalAutomationTokenStore {
	const fail = async (): Promise<never> => {
		throw error instanceof InternalPortalAutomationTokenStoreUnavailableError
			? error
			: new InternalPortalAutomationTokenStoreUnavailableError("自动化访问 token 数据库不可用。", {
					cause: error,
				});
	};
	return {
		authenticate: fail,
		create: fail,
		get: fail,
		list: fail,
		revoke: fail,
	};
}

export function createInternalPortalAutomationTokenStoreFromEnv(
	env: InternalPortalAutomationTokenStoreEnv,
): InternalPortalAutomationTokenStore {
	const databaseUrl = env.OPS_WEB_DATABASE_URL?.trim();
	if (!databaseUrl) {
		throw new InternalPortalAutomationTokenStoreUnavailableError(
			"OPS_WEB_DATABASE_URL is required.",
		);
	}
	const database = resolvePostgresTlsConfig({
		...(env.OPS_WEB_DATABASE_CA_CERT_PATH ? { caCertPath: env.OPS_WEB_DATABASE_CA_CERT_PATH } : {}),
		databaseUrl,
		...(env.DEPLOYMENT_ENVIRONMENT ? { deploymentEnvironment: env.DEPLOYMENT_ENVIRONMENT } : {}),
		...(env.NODE_ENV ? { nodeEnvironment: env.NODE_ENV } : {}),
		...(env.OPS_WEB_DATABASE_SSLMODE ? { sslMode: env.OPS_WEB_DATABASE_SSLMODE } : {}),
	});
	const pool = new Pool({
		connectionString: database.connectionString,
		connectionTimeoutMillis: 5_000,
		idleTimeoutMillis: 30_000,
		max: env.NODE_ENV === "test" ? 1 : 2,
		ssl: database.ssl,
		statement_timeout: 10_000,
	});
	pool.on("error", (error) =>
		logOpsError("internal portal automation token postgres pool error", error, {
			source: "internal-portal-automation",
		}),
	);
	return createPgInternalPortalAutomationTokenStore(pool);
}

export function createPgInternalPortalAutomationTokenStore(pool: Pick<Pool, "query">) {
	const store: InternalPortalAutomationTokenStore = {
		async authenticate(tokenHash) {
			return await withStoreErrors(async () => {
				const result = await pool.query<TokenMetadataRow>(
					`${TOKEN_METADATA_SELECT}
					 from internal_portal.automation_tokens tokens
					 where token_hash = $1 and revoked_at is null`,
					[tokenHash],
				);
				return result.rows[0] ? rowToMetadata(result.rows[0]) : null;
			});
		},

		async create(input) {
			return await withStoreErrors(async () => {
				const result = await pool.query<AutomationTokenRow>(
					`insert into internal_portal.automation_tokens (
						token_id, name, token_value, token_hash, created_at, revoked_at
					) values ($1, $2, $3, $4, $5, null)
					returning ${TOKEN_COLUMNS}`,
					[input.tokenId, input.name, input.tokenValue, input.tokenHash, input.createdAt],
				);
				return requireRow(result.rows[0]);
			});
		},

		async get(tokenId) {
			return await withStoreErrors(async () => {
				const result = await pool.query<AutomationTokenRow>(
					`${TOKEN_SELECT}
					 from internal_portal.automation_tokens tokens
					 where token_id = $1`,
					[tokenId],
				);
				return result.rows[0] ? rowToRecord(result.rows[0]) : null;
			});
		},

		async list() {
			return await withStoreErrors(async () => {
				const result = await pool.query<TokenMetadataRow>(
					`${TOKEN_METADATA_SELECT}
						from internal_portal.automation_tokens tokens
						order by created_at, token_id`,
				);
				return result.rows.map(rowToMetadata);
			});
		},

		async revoke(tokenId, revokedAt) {
			return await withStoreErrors(async () => {
				const result = await pool.query<AutomationTokenRow>(
					`update internal_portal.automation_tokens
					 set revoked_at = coalesce(revoked_at, $2)
					 where token_id = $1
					 returning ${TOKEN_COLUMNS}`,
					[tokenId, revokedAt],
				);
				if (!result.rows[0]) {
					throw new InternalPortalAutomationTokenNotFoundError();
				}
				return rowToRecord(result.rows[0]);
			});
		},
	};
	return store;
}

const TOKEN_COLUMNS = `
	token_id as "tokenId",
	name,
	token_value as "tokenValue",
	token_hash as "tokenHash",
	created_at as "createdAt",
	revoked_at as "revokedAt"`;

const TOKEN_SELECT = `select
	tokens.token_id as "tokenId",
	tokens.name,
	tokens.token_value as "tokenValue",
	tokens.token_hash as "tokenHash",
	tokens.created_at as "createdAt",
	tokens.revoked_at as "revokedAt"`;

const TOKEN_METADATA_SELECT = `
	select
		tokens.token_id as "tokenId",
		tokens.name,
		tokens.created_at as "createdAt",
		tokens.revoked_at as "revokedAt"`;

interface AutomationTokenRow {
	createdAt: Date;
	name: string;
	revokedAt: Date | null;
	tokenHash: string;
	tokenId: string;
	tokenValue: string;
}

interface TokenMetadataRow {
	createdAt: Date;
	name: string;
	revokedAt: Date | null;
	tokenId: string;
}

function rowToRecord(row: AutomationTokenRow): InternalPortalAutomationTokenRecord {
	return {
		createdAt: row.createdAt.toISOString(),
		name: row.name,
		revokedAt: row.revokedAt?.toISOString() ?? null,
		tokenHash: row.tokenHash,
		tokenId: row.tokenId,
		tokenValue: row.tokenValue,
	};
}

function rowToMetadata(row: TokenMetadataRow): InternalPortalAutomationTokenMetadata {
	return {
		createdAt: row.createdAt.toISOString(),
		name: row.name,
		revokedAt: row.revokedAt?.toISOString() ?? null,
		tokenId: row.tokenId,
	};
}

function requireRow(row: AutomationTokenRow | undefined): InternalPortalAutomationTokenRecord {
	if (!row) {
		throw new InternalPortalAutomationTokenStoreUnavailableError(
			"自动化访问 token 数据库未返回写入结果。",
		);
	}
	return rowToRecord(row);
}

async function withStoreErrors<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (
			error instanceof InternalPortalAutomationTokenStoreUnavailableError ||
			error instanceof InternalPortalAutomationTokenNotFoundError
		) {
			throw error;
		}
		throw new InternalPortalAutomationTokenStoreUnavailableError(
			"自动化访问 token 数据库不可用。",
			{
				cause: error,
			},
		);
	}
}
