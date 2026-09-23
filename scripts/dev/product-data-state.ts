import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface ProductSnapshot {
	id: string;
	collection: string;
	sourceKey: string;
	sourceDigest: string;
}

export interface PendingProductSync {
	snapshot: ProductSnapshot;
	createdKeys: string[];
	createdCollection: boolean;
}

export function readPendingProductSync(repoRoot: string): PendingProductSync | undefined {
	const path = productSyncPendingPath(repoRoot);
	if (!existsSync(path)) {
		return undefined;
	}
	const pending = JSON.parse(readFileSync(path, "utf8")) as PendingProductSync;
	parseSnapshot(pending.snapshot);
	if (
		!(
			Array.isArray(pending.createdKeys) &&
			pending.createdKeys.every((key) => typeof key === "string")
		) ||
		typeof pending.createdCollection !== "boolean"
	) {
		throw new Error("Invalid pending product sync");
	}
	return pending;
}

export function savePendingProductSync(repoRoot: string, pending: PendingProductSync): void {
	const path = productSyncPendingPath(repoRoot);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(`${path}.tmp`, `${JSON.stringify(pending)}\n`, { mode: 0o600 });
	renameSync(`${path}.tmp`, path);
}

export function readProductSnapshot(repoRoot: string): ProductSnapshot | undefined {
	const path = resolve(repoRoot, "var/dev/product-snapshot.json");
	if (!existsSync(path)) {
		return undefined;
	}
	return parseSnapshot(JSON.parse(readFileSync(path, "utf8")));
}

export function parseSnapshot(value: unknown): ProductSnapshot {
	const snapshot = value as ProductSnapshot;
	if (
		!(
			snapshot &&
			/^[a-f0-9]{64}$/.test(snapshot.id) &&
			/^campus_docs_[a-f0-9]{64}$/.test(snapshot.collection) &&
			/^sha256:[a-f0-9]{64}$/.test(snapshot.sourceDigest)
		) ||
		snapshot.sourceKey !== `campus-docs/snapshots/${snapshot.id}/source.json`
	) {
		throw new Error("Invalid local product snapshot");
	}
	return snapshot;
}

export function saveProductSnapshot(repoRoot: string, snapshot: ProductSnapshot): void {
	const path = resolve(repoRoot, "var/dev/product-snapshot.json");
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(`${path}.tmp`, `${JSON.stringify(parseSnapshot(snapshot))}\n`, { mode: 0o600 });
	renameSync(`${path}.tmp`, path);
}

export function productSyncPendingPath(repoRoot: string): string {
	return resolve(repoRoot, "var/dev/product-sync-pending.json");
}

export function clearProductSyncPending(repoRoot: string): void {
	rmSync(productSyncPendingPath(repoRoot), { force: true });
}

export function removeProductSnapshot(repoRoot: string): void {
	clearProductSyncPending(repoRoot);
	rmSync(resolve(repoRoot, "var/dev/product-snapshot.json"), { force: true });
}
