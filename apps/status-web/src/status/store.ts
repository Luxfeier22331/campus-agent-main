import { ProductAvailabilitySnapshotSchema } from "campus-contracts/product-availability";

import type { ProductAvailabilitySnapshot, StatusStore } from "./types";

export interface SnapshotNamespace {
	get(key: string, type: "json"): Promise<unknown | null>;
	put(key: string, value: string): Promise<void>;
}

export const SNAPSHOT_KEY = "product-availability:snapshot:v1";

export function createKvSnapshotStore(
	namespace: SnapshotNamespace,
	key = SNAPSHOT_KEY,
): StatusStore {
	return {
		async read() {
			const value = await namespace.get(key, "json");
			if (value === null) {
				return null;
			}
			const parsed = ProductAvailabilitySnapshotSchema.safeParse(value);
			if (!parsed.success) {
				throw new Error("Stored product availability snapshot is invalid.");
			}
			return parsed.data;
		},
		async write(snapshot) {
			const checked = ProductAvailabilitySnapshotSchema.parse(snapshot);
			await namespace.put(key, JSON.stringify(checked));
		},
	};
}

export function createMemorySnapshotStore(
	initial: ProductAvailabilitySnapshot | null = null,
): StatusStore {
	let snapshot = initial;
	return {
		async read() {
			return snapshot;
		},
		async write(next) {
			snapshot = ProductAvailabilitySnapshotSchema.parse(next);
		},
	};
}
