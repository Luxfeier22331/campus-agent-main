import {
	type InternalPortalNoticeSyncState as StoredNoticeSyncState,
	validateInternalPortalNoticeSyncState,
} from "ingestion-contracts";

import type { InternalPortalCollectionObjectStore } from "../../../src/object-store.js";

export interface InternalPortalNoticeSyncState {
	historyCoveredFrom: string | null;
	headNoticeId: number | null;
	updatedAt: string;
}

export interface InternalPortalNoticeSyncStateStore {
	load(): Promise<InternalPortalNoticeSyncState | null>;
	save(state: InternalPortalNoticeSyncState): Promise<void>;
}

export function createObjectStoreInternalPortalNoticeSyncStateStore(input: {
	objectStore: InternalPortalCollectionObjectStore;
}): InternalPortalNoticeSyncStateStore {
	return {
		async load() {
			const bytes = await input.objectStore.getObjectIfExists({
				bucket: input.objectStore.sourceBucket,
				key: internalPortalNoticeSyncStateObjectKey(),
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
			return fromStoredState(value as StoredNoticeSyncState);
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
				key: internalPortalNoticeSyncStateObjectKey(),
			});
		},
	};
}

export function internalPortalNoticeSyncStateObjectKey(): string {
	return "internal_portal/notices/_state.json";
}

function toStoredState(state: InternalPortalNoticeSyncState): StoredNoticeSyncState {
	return {
		history_covered_from: state.historyCoveredFrom,
		head_notice_id: state.headNoticeId,
		schema_version: "internal_portal_notice_sync_state.v2",
		updated_at: state.updatedAt,
	};
}

function fromStoredState(state: StoredNoticeSyncState): InternalPortalNoticeSyncState {
	return {
		historyCoveredFrom: state.history_covered_from,
		headNoticeId: state.head_notice_id,
		updatedAt: state.updated_at,
	};
}
