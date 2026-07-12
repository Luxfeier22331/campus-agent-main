import type { OpsRequestDetailResponse } from "../shared/ops-contract";

export interface OpsObservabilityLinkAllowlist {
	axiom?: string;
	langfuse?: string;
	openobserve?: string;
	sentry?: string;
	temporal?: string;
}

export function toTemporalExternalLink(
	workflowId: string | null,
	allowlist: OpsObservabilityLinkAllowlist | undefined,
): OpsRequestDetailResponse["externalLinks"][number] | null {
	if (!workflowId) {
		return null;
	}
	const base = allowlist?.temporal?.trim();
	if (!base) {
		return null;
	}
	let url: URL;
	try {
		url = new URL(base);
	} catch {
		return null;
	}
	if (url.protocol !== "https:") {
		return null;
	}
	const normalizedBasePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
	const namespacePath = normalizedBasePath.includes("/namespaces/")
		? normalizedBasePath
		: `${normalizedBasePath}/namespaces/default`;
	url.pathname = `${namespacePath}/workflows/${encodeURIComponent(workflowId)}`;
	return {
		href: url.toString(),
		isAvailable: true,
		label: "Temporal 工作流",
		source: "TEMPORAL",
	};
}
