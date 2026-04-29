import { resolveCandidateUrl } from "./dynamic-shell-discovery-url-extraction.ts";

export async function resolvePromotedUrlsWithHtmlRedirects(input: {
	urls: string[];
	userAgent: string;
	fetchImpl?: typeof fetch;
}): Promise<string[]> {
	const fetchImpl = input.fetchImpl ?? fetch;
	const resolved = new Set<string>();

	for (const url of input.urls) {
		const redirectTarget = await maybeResolveHtmlRedirectTarget({
			url,
			userAgent: input.userAgent,
			fetchImpl,
		});
		resolved.add(redirectTarget ?? url);
	}

	return [...resolved];
}

async function maybeResolveHtmlRedirectTarget(input: {
	url: string;
	userAgent: string;
	fetchImpl: typeof fetch;
}): Promise<string | null> {
	if (
		!/\/engine2\/general-rest\/.+\/(?:proxy-detail-url|outer-proxy-detail-url)/i.test(input.url)
	) {
		return null;
	}

	const response = await input.fetchImpl(input.url, {
		headers: {
			"user-agent": input.userAgent,
			accept: "text/html,application/xhtml+xml",
		},
		redirect: "follow",
	});
	const bodyText = await response.text();
	return extractHtmlRedirectTarget(bodyText, input.url);
}

function extractHtmlRedirectTarget(bodyText: string, baseUrl: string): string | null {
	const locationMatch = bodyText.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i);
	const metaRefreshMatch = bodyText.match(
		/http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'>]+)["']/i,
	);
	const candidate = locationMatch?.[1] ?? metaRefreshMatch?.[1] ?? null;
	if (!candidate) {
		return null;
	}
	return resolveCandidateUrl(candidate, baseUrl);
}
