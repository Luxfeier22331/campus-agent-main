export interface ProductDataOptions {
	data: "seed" | "cluster" | "cluster-content";
	noticeLimit?: number;
	replace: boolean;
	context?: string;
	namespace?: string;
}

// Staging is the only deployed namespace this repository operates; it is a
// deployment-topology fact, not a per-machine detail. --context stays explicit:
// when omitted, kubectl falls back to the developer's own current-context.
export const DEFAULT_CLUSTER_NAMESPACE = "campus-agent-staging";

export function parseProductDataOptions(args: readonly string[]): ProductDataOptions {
	const read = (flag: string) => {
		const index = args.indexOf(flag);
		if (index < 0) {
			return;
		}
		const value = args[index + 1]?.trim();
		if (!value || value.startsWith("--")) {
			throw new Error(`${flag} requires a value`);
		}
		return value;
	};
	const data = read("--data") ?? "seed";
	if (data !== "seed" && data !== "cluster" && data !== "cluster-content") {
		throw new Error("--data must be seed, cluster or cluster-content");
	}
	const limit = read("--notice-limit");
	if (limit !== undefined && data !== "cluster-content") {
		throw new Error("--notice-limit requires --data cluster-content");
	}
	if (
		limit !== undefined &&
		!(/^[1-9][0-9]*$/u.test(limit) && Number.isSafeInteger(Number(limit)))
	) {
		throw new Error("--notice-limit must be a positive integer");
	}
	const context = read("--context");
	const namespace = read("--namespace");
	if (data === "seed" && (context || namespace)) {
		throw new Error("--context and --namespace require --data cluster");
	}
	return {
		data,
		replace: args.includes("--replace"),
		context,
		namespace: data === "seed" ? namespace : (namespace ?? DEFAULT_CLUSTER_NAMESPACE),
		...(data === "cluster-content" ? { noticeLimit: Number(limit ?? 100) } : {}),
	};
}
