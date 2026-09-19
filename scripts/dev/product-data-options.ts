export interface ProductDataOptions {
	data: "seed" | "cluster";
	replace: boolean;
	context?: string;
	namespace?: string;
}

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
	if (data === "cluster" && !(context && namespace)) {
		throw new Error("Cluster initialization requires explicit --context and --namespace");
	}
	if (data === "seed" && (context || namespace)) {
		throw new Error("--context and --namespace require --data cluster");
	}
	return { data, replace: args.includes("--replace"), context, namespace };
}
