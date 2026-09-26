export interface SparseVector {
	indices: number[];
	values: number[];
}

export function buildSparseVector(text: string): SparseVector {
	const counts = new Map<number, number>();
	for (const token of tokenize(text)) {
		const normalized = token.toLowerCase();
		if (!/[\p{L}\p{N}\p{Script=Han}]/u.test(normalized)) continue;
		const index = fnv1a(normalized);
		counts.set(index, (counts.get(index) ?? 0) + 1);
	}
	const indices = [...counts.keys()].sort((left, right) => left - right);
	return { indices, values: indices.map((index) => Math.log1p(counts.get(index) ?? 0)) };
}

function tokenize(value: string): string[] {
	return [...value.matchAll(/[\p{Script=Han}]|[\p{L}\p{N}_]+|[^\s]/gu)].map(
		(match) => match[0] ?? "",
	);
}

function fnv1a(value: string): number {
	let hash = 2166136261;
	for (const byte of new TextEncoder().encode(value)) {
		hash ^= byte;
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash & 0x7fffffff;
}
