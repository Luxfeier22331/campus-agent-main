import {
	createPostgresAttachmentFetchStatusStore,
	type DisposableAttachmentFetchStatusStore,
} from "./attachment-fetch-status";
import {
	createPostgresCollectorRunLeaseStore,
	type DisposableCollectorRunLeaseStore,
} from "./collector-run-lease";
import {
	createPostgresCollectorRunLedgerStore,
	type DisposableCollectorRunLedgerStore,
} from "./collector-run-ledger";
import type { CollectorConfig } from "./config";

export function buildAttachmentFetchStatusStoreForMain(
	config: CollectorConfig,
): DisposableAttachmentFetchStatusStore | undefined {
	if (config.attachmentFetchStatusDisabled || config.attachmentFetchStatusDatabaseUrl === null) {
		return;
	}
	return createPostgresAttachmentFetchStatusStore({
		databaseUrl: config.attachmentFetchStatusDatabaseUrl,
	});
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
