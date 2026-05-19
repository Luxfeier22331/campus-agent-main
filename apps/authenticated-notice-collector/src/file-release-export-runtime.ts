import {
	createPostgresCollectorRunLeaseStore,
	type DisposableCollectorRunLeaseStore,
	withCollectorRunLease,
} from "./collector-run-lease.js";
import {
	createPostgresCollectorRunLedgerStore,
	type DisposableCollectorRunLedgerStore,
} from "./collector-run-ledger.js";
import type { CollectorConfig } from "./config.js";

export function sanitizeObjectKeySegment(value: string): string {
	const normalized = value.trim().replace(/[^0-9A-Za-z_.=-]+/g, "_");
	return normalized || "unknown";
}

export function buildCollectorRunLedgerStoreForMain(
	config: CollectorConfig,
): DisposableCollectorRunLedgerStore | undefined {
	if (config.collectorRunLedgerDisabled || config.collectorRunLedgerDatabaseUrl === null) {
		return;
	}
	return createPostgresCollectorRunLedgerStore({
		databaseUrl: config.collectorRunLedgerDatabaseUrl,
	});
}

export function buildCollectorRunLeaseStoreForMain(
	config: CollectorConfig,
): DisposableCollectorRunLeaseStore | undefined {
	if (config.collectorRunLeaseDisabled || config.collectorRunLeaseDatabaseUrl === null) {
		return;
	}
	return createPostgresCollectorRunLeaseStore({
		databaseUrl: config.collectorRunLeaseDatabaseUrl,
	});
}

export async function runWithOptionalCollectorLease<T>(
	store: DisposableCollectorRunLeaseStore | undefined,
	input: Parameters<typeof withCollectorRunLease>[1],
	operation: () => Promise<T>,
): Promise<T> {
	if (!store) {
		return await operation();
	}
	return await withCollectorRunLease(store, input, operation);
}
