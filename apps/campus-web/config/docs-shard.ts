export interface CampusWebDocsShard {
	index: number;
	total: number;
}

/**
 * Documentation pages are built in shards to bound bundler memory. The docs
 * build registers every documentation page as its own Rollup input, so a
 * single pass holds the whole page set at once. Sharding keeps peak memory
 * proportional to the shard size instead of the total page count.
 */
export const DEFAULT_DOCS_SHARD_TOTAL = 6;

export function parseDocsShardTotal(raw: string | undefined): number {
	const total = Number(raw);
	if (!Number.isInteger(total) || total < 1) {
		throw new Error("CAMPUS_WEB_DOCS_SHARD_TOTAL must be a positive integer.");
	}
	return total;
}

/** Resolve the shard a single docs build pass is responsible for. */
export function resolveCampusWebDocsShard(
	env: NodeJS.ProcessEnv = process.env,
): CampusWebDocsShard {
	const rawTotal = env.CAMPUS_WEB_DOCS_SHARD_TOTAL?.trim();
	const rawIndex = env.CAMPUS_WEB_DOCS_SHARD_INDEX?.trim();
	if (!(rawTotal || rawIndex)) {
		return { index: 0, total: 1 };
	}
	const total = parseDocsShardTotal(rawTotal);
	const index = Number(rawIndex);
	if (!Number.isInteger(index) || index < 0 || index >= total) {
		throw new Error("CAMPUS_WEB_DOCS_SHARD_INDEX must be within the configured shard total.");
	}
	return { index, total };
}

/**
 * Partition docs HTML inputs across shards. `docs/index` and `docs/404` stay in
 * every shard because the merged output must always contain them, and the
 * ordering is stable so a given route always lands in the same shard.
 */
export function selectDocsShard(
	inputs: Record<string, string>,
	shard: CampusWebDocsShard,
): Record<string, string> {
	if (shard.total === 1) {
		return inputs;
	}
	const always = new Set(["docs/index", "docs/404"]);
	const selected = Object.entries(inputs).filter(
		([route], position) => always.has(route) || position % shard.total === shard.index,
	);
	if (selected.length === 0) {
		throw new Error("Campus Web docs shard selected no HTML inputs.");
	}
	return Object.fromEntries(selected);
}
