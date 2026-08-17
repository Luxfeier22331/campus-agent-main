import type { Pool } from "pg";
import type {
	InternalPortalCredential,
	InternalPortalCredentialOutcome,
} from "../shared/ops-contract.ts";

export interface InternalPortalCredentialRecord extends InternalPortalCredential {
	ssoTgc: string;
}

export interface InternalPortalCredentialStore {
	create(input: {
		credentialId: string;
		name: string;
		now: Date;
		ssoTgc: string;
	}): Promise<InternalPortalCredentialRecord>;
	delete(credentialId: string, expectedVersion: number): Promise<void>;
	get(credentialId: string): Promise<InternalPortalCredentialRecord | null>;
	list(): Promise<InternalPortalCredentialRecord[]>;
	recordCheck(input: {
		attemptedAt: Date;
		credentialId: string;
		expectedVersion: number;
		outcome: InternalPortalCredentialOutcome;
		ssoTgc: string;
	}): Promise<InternalPortalCredentialRecord>;
	rename(input: {
		credentialId: string;
		expectedVersion: number;
		name: string;
		now: Date;
	}): Promise<InternalPortalCredentialRecord>;
	rotate(input: {
		attemptedAt: Date;
		credentialId: string;
		expectedVersion: number;
		ssoTgc: string;
	}): Promise<InternalPortalCredentialRecord>;
}

export class InternalPortalCredentialStoreUnavailableError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "InternalPortalCredentialStoreUnavailableError";
	}
}

export class InternalPortalCredentialNotFoundError extends Error {
	constructor() {
		super("未找到内部门户凭据。");
		this.name = "InternalPortalCredentialNotFoundError";
	}
}

export class InternalPortalCredentialConflictError extends Error {
	constructor() {
		super("内部门户凭据已被其他操作更新，请刷新后重试。");
		this.name = "InternalPortalCredentialConflictError";
	}
}

export class InternalPortalCredentialNameConflictError extends Error {
	constructor() {
		super("已存在同名内部门户凭据，请使用其他名称。");
		this.name = "InternalPortalCredentialNameConflictError";
	}
}

export function createUnavailableInternalPortalCredentialStore(
	error: unknown,
): InternalPortalCredentialStore {
	const fail = async (): Promise<never> => {
		throw error instanceof InternalPortalCredentialStoreUnavailableError
			? error
			: new InternalPortalCredentialStoreUnavailableError("内部门户凭据数据库不可用。", {
					cause: error,
				});
	};
	return {
		create: fail,
		delete: fail,
		get: fail,
		list: fail,
		recordCheck: fail,
		rename: fail,
		rotate: fail,
	};
}

export function createPgInternalPortalCredentialStore(pool: Pick<Pool, "query">) {
	const store: InternalPortalCredentialStore = {
		async create(input) {
			return await withStoreErrors(async () => {
				const result = await pool.query<CredentialRow>(
					`with credentials as (
						insert into internal_portal.credentials (
							credential_id, name, sso_tgc, version, created_at, updated_at,
							last_attempt_at, last_successful_at, last_outcome
						) values ($1, $2, $3, 1, $4, $4, $4, $4, 'valid')
						returning *
					 )
					 ${CREDENTIAL_SELECT} from credentials`,
					[input.credentialId, input.name, input.ssoTgc, input.now],
				);
				return requireRow(result.rows[0]);
			});
		},

		async delete(credentialId, expectedVersion) {
			await withStoreErrors(async () => {
				const result = await pool.query(
					`delete from internal_portal.credentials
					 where credential_id = $1 and version = $2`,
					[credentialId, expectedVersion],
				);
				if (result.rowCount !== 1) {
					await throwWriteMiss(pool, credentialId);
				}
			});
		},

		async get(credentialId) {
			return await withStoreErrors(async () => {
				const result = await pool.query<CredentialRow>(
					`${CREDENTIAL_SELECT}
					 from internal_portal.credentials credentials
					 where credential_id = $1`,
					[credentialId],
				);
				return result.rows[0] ? rowToCredential(result.rows[0]) : null;
			});
		},

		async list() {
			return await withStoreErrors(async () => {
				const result = await pool.query<CredentialRow>(`${CREDENTIAL_SELECT}
					from internal_portal.credentials credentials
					order by created_at, credential_id`);
				return result.rows.map(rowToCredential);
			});
		},

		async recordCheck(input) {
			return await withStoreErrors(async () => {
				const result = await pool.query<CredentialRow>(
					`with credentials as (
						update internal_portal.credentials
						set sso_tgc = $3,
							version = case when sso_tgc = $3 then version else version + 1 end,
							updated_at = case when sso_tgc = $3 then updated_at else $4 end,
							last_attempt_at = $4,
							last_successful_at = case when $5 = 'valid' then $4 else last_successful_at end,
							last_outcome = $5
						where credential_id = $1 and version = $2
						returning *
					 )
					 ${CREDENTIAL_SELECT} from credentials`,
					[
						input.credentialId,
						input.expectedVersion,
						input.ssoTgc,
						input.attemptedAt,
						input.outcome,
					],
				);
				if (!result.rows[0]) {
					await throwWriteMiss(pool, input.credentialId);
				}
				return requireRow(result.rows[0]);
			});
		},

		async rename(input) {
			return await withStoreErrors(async () => {
				const result = await pool.query<CredentialRow>(
					`with credentials as (
						update internal_portal.credentials
						set name = $3, version = version + 1, updated_at = $4
						where credential_id = $1 and version = $2
						returning *
					 )
					 ${CREDENTIAL_SELECT} from credentials`,
					[input.credentialId, input.expectedVersion, input.name, input.now],
				);
				if (!result.rows[0]) {
					await throwWriteMiss(pool, input.credentialId);
				}
				return requireRow(result.rows[0]);
			});
		},

		async rotate(input) {
			return await withStoreErrors(async () => {
				const result = await pool.query<CredentialRow>(
					`with credentials as (
						update internal_portal.credentials
						set sso_tgc = $3, version = version + 1, updated_at = $4,
							last_attempt_at = $4, last_successful_at = $4, last_outcome = 'valid'
						where credential_id = $1 and version = $2
						returning *
					 )
					 ${CREDENTIAL_SELECT} from credentials`,
					[input.credentialId, input.expectedVersion, input.ssoTgc, input.attemptedAt],
				);
				if (!result.rows[0]) {
					await throwWriteMiss(pool, input.credentialId);
				}
				return requireRow(result.rows[0]);
			});
		},
	};
	return store;
}

const CREDENTIAL_SELECT = `select
	credentials.credential_id as "credentialId",
	credentials.name,
	credentials.sso_tgc as "ssoTgc",
	credentials.version,
	credentials.created_at as "createdAt",
	credentials.updated_at as "updatedAt",
	credentials.last_attempt_at as "lastAttemptAt",
	credentials.last_successful_at as "lastSuccessfulAt",
	credentials.last_outcome as "lastOutcome"`;

interface CredentialRow {
	credentialId: string;
	name: string;
	ssoTgc: string;
	version: number;
	createdAt: Date;
	updatedAt: Date;
	lastAttemptAt: Date | null;
	lastSuccessfulAt: Date | null;
	lastOutcome: InternalPortalCredentialOutcome | null;
}

function rowToCredential(row: CredentialRow): InternalPortalCredentialRecord {
	return {
		credentialId: row.credentialId,
		name: row.name,
		ssoTgc: row.ssoTgc,
		version: row.version,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
		lastSuccessfulAt: row.lastSuccessfulAt?.toISOString() ?? null,
		lastOutcome: row.lastOutcome,
	};
}

function requireRow(row: CredentialRow | undefined): InternalPortalCredentialRecord {
	if (!row) {
		throw new InternalPortalCredentialStoreUnavailableError("内部门户凭据数据库未返回写入结果。");
	}
	return rowToCredential(row);
}

async function throwWriteMiss(pool: Pick<Pool, "query">, credentialId: string): Promise<never> {
	const existing = await pool.query(
		"select 1 from internal_portal.credentials where credential_id = $1",
		[credentialId],
	);
	if (existing.rowCount === 0) {
		throw new InternalPortalCredentialNotFoundError();
	}
	throw new InternalPortalCredentialConflictError();
}

async function withStoreErrors<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (isCredentialNameConflict(error)) {
			throw new InternalPortalCredentialNameConflictError();
		}
		if (
			error instanceof InternalPortalCredentialStoreUnavailableError ||
			error instanceof InternalPortalCredentialNotFoundError ||
			error instanceof InternalPortalCredentialConflictError ||
			error instanceof InternalPortalCredentialNameConflictError
		) {
			throw error;
		}
		throw new InternalPortalCredentialStoreUnavailableError("内部门户凭据数据库不可用。", {
			cause: error,
		});
	}
}

function isCredentialNameConflict(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "23505" &&
		"constraint" in error &&
		error.constraint === "internal_portal_credentials_name_uidx"
	);
}
