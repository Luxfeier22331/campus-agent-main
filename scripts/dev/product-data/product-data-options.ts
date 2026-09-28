export interface ProductDataOptions {
	data: "seed" | "cluster";
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
	if (data !== "seed" && data !== "cluster") {
		throw new Error("--data must be seed or cluster");
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
		namespace: data === "cluster" ? (namespace ?? DEFAULT_CLUSTER_NAMESPACE) : namespace,
	};
}
