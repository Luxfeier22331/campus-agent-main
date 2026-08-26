import {
	type LegacyInternalPortalNoticeSyncState,
	type InternalPortalNoticeSyncState as StoredNoticeSyncState,
	validateLegacyInternalPortalNoticeSyncState,
	validateInternalPortalNoticeSyncState,
} from "ingestion-contracts";

import type { InternalPortalCollectionObjectStore } from "../../../src/object-store.js";

export interface InternalPortalNoticeSyncState {
	coveredFrom: string | null;
	coveredUntil: string | null;
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
			if (validation.ok) {
				return fromStoredState(value as StoredNoticeSyncState);
			}
			const legacyValidation = validateLegacyInternalPortalNoticeSyncState(value);
			if (legacyValidation.ok) {
				return fromLegacyStoredState(value as LegacyInternalPortalNoticeSyncState);
			}
			throw new Error(
				`internal portal notice sync state is invalid: ${[
					...validation.errors,
					...legacyValidation.errors,
				].join("; ")}`,
			);
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
	const base = {
		schema_version: "internal_portal_notice_sync_state.v3" as const,
		updated_at: state.updatedAt,
	};
	if (state.coveredFrom === null && state.coveredUntil === null) {
		return { ...base, covered_from: null, covered_until: null };
	}
	if (state.coveredFrom !== null && state.coveredUntil !== null) {
		return {
			...base,
			covered_from: state.coveredFrom,
			covered_until: state.coveredUntil,
		};
	}
	throw new Error("internal portal notice sync state requires both maintenance boundaries");
}

function fromStoredState(state: StoredNoticeSyncState): InternalPortalNoticeSyncState {
	return {
		coveredFrom: state.covered_from,
		coveredUntil: state.covered_until,
		updatedAt: state.updated_at,
	};
}

function fromLegacyStoredState(
	state: LegacyInternalPortalNoticeSyncState,
): InternalPortalNoticeSyncState {
	return {
		coveredFrom: state.history_covered_from,
		// v2 did not record a trustworthy exclusive upper bound. A later backfill
		// must establish a complete v3 range before sync is allowed.
		coveredUntil: null,
		updatedAt: state.updated_at,
	};
}
