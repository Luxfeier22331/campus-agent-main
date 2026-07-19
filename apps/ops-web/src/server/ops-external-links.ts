import type { OpsRequestDetailResponse } from "../shared/ops-contract";

export interface OpsObservabilityLinkAllowlist {
	axiom?: string;
	langfuse?: string;
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

export function toSentryExternalLink(
	allowlist: OpsObservabilityLinkAllowlist | undefined,
): OpsRequestDetailResponse["externalLinks"][number] | null {
	const href = allowlist?.sentry?.trim();
	if (!href) {
		return null;
	}
	try {
		const url = new URL(href);
		if (url.protocol !== "https:") {
			return null;
		}
		return {
			href: url.toString(),
			isAvailable: true,
			label: "Sentry Trace Explorer",
			source: "SENTRY",
		};
	} catch {
		return null;
	}
}
