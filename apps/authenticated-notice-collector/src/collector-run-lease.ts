import { Pool } from "pg";

export interface CollectorRunLeaseAcquireInput {
	leaseKey: string;
	now: string;
	ownerId: string;
	ttlSeconds: number;
}

export interface CollectorRunLeaseReleaseInput {
	leaseKey: string;
	ownerId: string;
}

export interface CollectorRunLeaseStore {
	acquire(input: CollectorRunLeaseAcquireInput): Promise<boolean>;
	release(input: CollectorRunLeaseReleaseInput): Promise<void>;
}

export interface DisposableCollectorRunLeaseStore extends CollectorRunLeaseStore {
	dispose(): Promise<void>;
}

export interface CollectorRunLeaseTableReference {
	schemaSql?: string;
	tableSql: string;
}

const DEFAULT_RUN_LEASE_TABLE_NAME = "ingestion_projection.authenticated_notice_collector_lease";

export function createInMemoryCollectorRunLeaseStore(): CollectorRunLeaseStore {
	const leases = new Map<
		string,
		{
			expiresAtMs: number;
			ownerId: string;
		}
	>();
	return {
		async acquire(input) {
			const nowMs = Date.parse(input.now);
			const current = leases.get(input.leaseKey);
			if (current && current.ownerId !== input.ownerId && current.expiresAtMs > nowMs) {
				return false;
			}
			leases.set(input.leaseKey, {
				expiresAtMs: nowMs + input.ttlSeconds * 1000,
				ownerId: input.ownerId,
			});
			return true;
		},
		async release(input) {
			const current = leases.get(input.leaseKey);
			if (current?.ownerId === input.ownerId) {
				leases.delete(input.leaseKey);
			}
		},
	};
}

export function createPostgresCollectorRunLeaseStore(input: {
	databaseUrl: string;
	tableName?: string;
}): DisposableCollectorRunLeaseStore {
	const tableReference = resolveCollectorRunLeaseTableReference(
		input.tableName ?? DEFAULT_RUN_LEASE_TABLE_NAME,
	);
	const pool = new Pool({ connectionString: input.databaseUrl });
	return {
		async acquire(leaseInput) {
			await ensureCollectorRunLeaseSchema(pool, tableReference);
			const result = await pool.query(
				`
				insert into ${tableReference.tableSql} (
					lease_key,
					owner_id,
					acquired_at,
					expires_at,
					updated_at
				) values (
					$1,
					$2,
					$3::timestamptz,
					$3::timestamptz + ($4::text || ' seconds')::interval,
					$3::timestamptz
				)
				on conflict (lease_key) do update set
					owner_id = excluded.owner_id,
					acquired_at = excluded.acquired_at,
					expires_at = excluded.expires_at,
					updated_at = excluded.updated_at
				where ${tableReference.tableSql}.expires_at <= $3::timestamptz
					or ${tableReference.tableSql}.owner_id = $2
				returning lease_key
				`,
				[leaseInput.leaseKey, leaseInput.ownerId, leaseInput.now, leaseInput.ttlSeconds],
			);
			return result.rowCount === 1;
		},
		async release(leaseInput) {
			await pool.query(
				`
				delete from ${tableReference.tableSql}
				where lease_key = $1 and owner_id = $2
				`,
				[leaseInput.leaseKey, leaseInput.ownerId],
			);
		},
		async dispose() {
			await pool.end();
		},
	};
}

export async function withCollectorRunLease<T>(
	store: CollectorRunLeaseStore,
	input: CollectorRunLeaseAcquireInput,
	operation: () => Promise<T>,
): Promise<T> {
	const acquired = await store.acquire(input);
	if (!acquired) {
		throw new Error(`collector run lease unavailable: ${input.leaseKey}`);
	}
	try {
		return await operation();
	} finally {
		await store.release({
			leaseKey: input.leaseKey,
			ownerId: input.ownerId,
		});
	}
}

export function buildCollectorRunLeaseKey(input: {
	siteId: string;
	sourceSurface: "notice" | "file_release";
}): string {
	return `authenticated_notice_portal:${input.sourceSurface}:${input.siteId}`;
}

export function resolveCollectorRunLeaseTableReference(
	tableName: string,
): CollectorRunLeaseTableReference {
	const parts = tableName.split(".");
	if (parts.length === 0 || parts.length > 2) {
		throw new Error(`invalid collector run lease table name: ${tableName}`);
	}
	const quotedParts = parts.map(quoteIdentifier);
	if (quotedParts.length === 1) {
		return { tableSql: quotedParts[0] };
	}
	return {
		schemaSql: quotedParts[0],
		tableSql: quotedParts.join("."),
	};
}

async function ensureCollectorRunLeaseSchema(
	pool: Pool,
	tableReference: CollectorRunLeaseTableReference,
): Promise<void> {
	if (tableReference.schemaSql) {
		await pool.query(`create schema if not exists ${tableReference.schemaSql}`);
	}
	await pool.query(`
		create table if not exists ${tableReference.tableSql} (
			lease_key text primary key,
			owner_id text not null,
			acquired_at timestamptz not null,
			expires_at timestamptz not null,
			updated_at timestamptz not null
		)
	`);
}

function quoteIdentifier(identifier: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
		throw new Error(`invalid collector run lease table identifier: ${identifier}`);
	}
	return `"${identifier}"`;
}
