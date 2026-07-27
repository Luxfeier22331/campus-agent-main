import { encodeObjectKeySegment } from "ingest-core";
import {
	type InternalPortalNoticeSyncState as StoredNoticeSyncState,
	validateInternalPortalNoticeSyncState,
} from "ingestion-contracts";

import type { SourceCollectorObjectStore } from "../../../src/object-store.js";

export interface InternalPortalNoticeSyncState {
	historyCoveredFrom: string | null;
	incrementalHeadId: number | null;
	maxCapturedId: number | null;
	minCapturedId: number | null;
	siteId: string;
	updatedAt: string;
}

export interface InternalPortalNoticeSyncStateStore {
	load(siteId: string): Promise<InternalPortalNoticeSyncState | null>;
	save(state: InternalPortalNoticeSyncState): Promise<void>;
}

export function createObjectStoreInternalPortalNoticeSyncStateStore(input: {
	objectStore: SourceCollectorObjectStore;
}): InternalPortalNoticeSyncStateStore {
	return {
		async load(siteId) {
			const bytes = await input.objectStore.getObjectIfExists({
				bucket: input.objectStore.sourceBucket,
				key: internalPortalNoticeSyncStateObjectKey(siteId),
			});
			if (!bytes) {
				return null;
			}
			let value: unknown;
			try {
				value = JSON.parse(Buffer.from(bytes).toString("utf-8"));
			} catch (error) {
				throw new Error("internal portal notice sync state is not valid JSON", { cause: error });
			}
			const validation = validateInternalPortalNoticeSyncState(value);
			if (!validation.ok) {
				throw new Error(
					`internal portal notice sync state is invalid: ${validation.errors.join("; ")}`,
				);
			}
			const stored = value as StoredNoticeSyncState;
			if (stored.site_id !== siteId) {
				throw new Error("internal portal notice sync state site_id does not match its object key");
			}
			return fromStoredState(stored);
		},
		async save(state) {
			const stored = toStoredState(state);
			const validation = validateInternalPortalNoticeSyncState(stored);
			if (!validation.ok) {
				throw new Error(
					`internal portal notice sync state is invalid: ${validation.errors.join("; ")}`,
				);
			}
			await input.objectStore.putObject({
				body: Buffer.from(`${JSON.stringify(stored, null, 2)}\n`, "utf-8"),
				bucket: input.objectStore.sourceBucket,
				contentType: "application/json",
				key: internalPortalNoticeSyncStateObjectKey(state.siteId),
			});
		},
	};
}

export function internalPortalNoticeSyncStateObjectKey(siteId: string): string {
	return `internal_portal/${encodeObjectKeySegment(siteId)}/notices/_state.json`;
}

function toStoredState(state: InternalPortalNoticeSyncState): StoredNoticeSyncState {
	return {
		history_covered_from: state.historyCoveredFrom,
		incremental_head_id: state.incrementalHeadId,
		max_captured_id: state.maxCapturedId,
		min_captured_id: state.minCapturedId,
		schema_version: "internal_portal_notice_sync_state.v1",
		site_id: state.siteId,
		updated_at: state.updatedAt,
	};
}

function fromStoredState(state: StoredNoticeSyncState): InternalPortalNoticeSyncState {
	return {
		historyCoveredFrom: state.history_covered_from,
		incrementalHeadId: state.incremental_head_id,
		maxCapturedId: state.max_captured_id,
		minCapturedId: state.min_captured_id,
		siteId: state.site_id,
		updatedAt: state.updated_at,
	};
}
