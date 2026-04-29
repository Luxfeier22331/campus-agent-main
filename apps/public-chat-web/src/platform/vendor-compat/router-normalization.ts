import type { AppHref } from "@platform/router";

function isExternalHref(href: string) {
	return /^(?:[a-z]+:)?\/\//i.test(href) || href.startsWith("mailto:");
}

function normalizeDonorPathname(pathname: string) {
	return pathname === "/" ? "/chat" : pathname;
}

export function normalizeDonorHref(href: string): string {
	if (!href || isExternalHref(href) || !href.startsWith("/")) {
		return href;
	}

	const normalized = new URL(href, "https://campus-agent.local");
	return `${normalizeDonorPathname(normalized.pathname)}${normalized.search}${normalized.hash}`;
}

export function normalizeDonorAppHref(href: AppHref): AppHref {
	if (typeof href === "string") {
		return normalizeDonorHref(href);
	}

	return {
		...href,
		pathname: normalizeDonorPathname(href.pathname),
	};
}
