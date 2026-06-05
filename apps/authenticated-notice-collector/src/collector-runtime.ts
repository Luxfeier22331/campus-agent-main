import {
	type DisposableCollectorRunLeaseStore,
	withCollectorRunLease,
} from "./collector-run-lease.js";

export function sanitizeObjectKeySegment(value: string): string {
	const normalized = value.trim().replace(/[^0-9A-Za-z_.=-]+/g, "_");
	return normalized || "unknown";
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
