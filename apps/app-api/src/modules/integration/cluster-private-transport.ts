import { type Env, isDeployedEnvironment, resolveEnvironment } from "../../config";

export type ClusterPrivateEnv = Pick<
	Env,
	| "DEPLOYMENT_ENVIRONMENT"
	| "CLUSTER_PRIVATE_API"
	| "CLUSTER_PRIVATE_ORIGIN"
	| "CLUSTER_PRIVATE_BASE_URL"
	| "EDGE_INGRESS_SHARED_SECRET"
>;

export function resolveClusterPrivateUpstream(
	env: ClusterPrivateEnv,
	service: "control" | "memory",
) {
	const deployed = isDeployedEnvironment(resolveEnvironment(env));
	const origin = (deployed ? env.CLUSTER_PRIVATE_ORIGIN : env.CLUSTER_PRIVATE_BASE_URL)?.trim();
	if (
		!(origin && env.EDGE_INGRESS_SHARED_SECRET?.trim()) ||
		(deployed && typeof env.CLUSTER_PRIVATE_API?.fetch !== "function")
	) {
		throw new Error("Cluster private ingress is not configured.");
	}
	const baseUrl = `${origin.replace(/\/+$/u, "")}/v1/${service}`;
	if (deployed) {
		const binding = env.CLUSTER_PRIVATE_API;
		if (!binding || typeof binding.fetch !== "function") {
			throw new Error("Cluster private ingress is not configured.");
		}
		return {
			baseUrl,
			fetch: binding.fetch.bind(binding) as typeof fetch,
		};
	}
	return {
		baseUrl,
		fetch,
	};
}

export function createClusterPrivateHeaders(
	env: ClusterPrivateEnv,
	accept?: string,
): Record<string, string> {
	const secret = env.EDGE_INGRESS_SHARED_SECRET?.trim();
	if (!secret) {
		throw new Error("Cluster private ingress is not configured.");
	}
	return {
		"content-type": "application/json",
		"x-edge-ingress-auth": secret,
		...(accept ? { accept } : {}),
	};
}
