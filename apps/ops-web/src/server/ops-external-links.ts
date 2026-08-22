import { deriveLangfuseTraceId } from "@campus-agent/langfuse-identity";
import type { OpsRequestDetailResponse } from "../shared/ops-contract";

export interface OpsObservabilityLinkAllowlist {
	langfuse?: string;
	sentry?: string;
	temporal?: string;
}

export function toTemporalExternalLink(
	workflowId: string | null,
	allowlist: OpsObservabilityLinkAllowlist | undefined,
): OpsRequestDetailResponse["technical"]["externalLinks"][number] | null {
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
): OpsRequestDetailResponse["technical"]["externalLinks"][number] | null {
	return toConfiguredExternalLink(allowlist?.sentry, "Sentry Trace Explorer", "SENTRY");
}

export async function toLangfuseExternalLink(
	productTraceId: string,
	allowlist: OpsObservabilityLinkAllowlist | undefined,
): Promise<OpsRequestDetailResponse["technical"]["externalLinks"][number] | null> {
	const href = allowlist?.langfuse?.trim();
	if (!href) {
		return null;
	}
	try {
		const url = new URL(href);
		if (url.protocol !== "https:") {
			return null;
		}
		const normalizedPath = url.pathname.replace(/\/+$/u, "");
		if (!/(?:^|\/)project\/[^/]+$/u.test(normalizedPath)) {
			return null;
		}
		url.pathname = `${normalizedPath}/traces/${await deriveLangfuseTraceId(productTraceId)}`;
		url.search = "";
		url.hash = "";
		return {
			href: url.toString(),
			isAvailable: true,
			label: "Langfuse Trace",
			source: "LANGFUSE",
		};
	} catch {
		return null;
	}
}

function toConfiguredExternalLink(
	href: string | undefined,
	label: string,
	source: "SENTRY",
): OpsRequestDetailResponse["technical"]["externalLinks"][number] | null {
	const normalized = href?.trim();
	if (!normalized) {
		return null;
	}
	try {
		const url = new URL(normalized);
		if (url.protocol !== "https:") {
			return null;
		}
		return { href: url.toString(), isAvailable: true, label, source };
	} catch {
		return null;
	}
}
