import { PlaywrightCrawler, type RequestOptions } from "crawlee";

import { createOfficialWebCrawlerConfiguration } from "./crawlee-runtime.ts";
import type {
	DynamicShellNetworkCapture,
	OfficialWebDynamicShellDiscoveryAudit,
	OfficialWebDynamicShellDiscoveryPolicy,
} from "./dynamic-shell-discovery-types.ts";
import {
	compilePatterns,
	isTextLikeContentType,
	normalizeHeaderValue,
} from "./dynamic-shell-discovery-url-extraction.ts";

export async function captureDynamicShellNetwork(input: {
	crawlerFactory?: DynamicShellCrawlerFactory;
	policy: OfficialWebDynamicShellDiscoveryPolicy;
	url: string;
}): Promise<{
	captures: DynamicShellNetworkCapture[];
	wait: OfficialWebDynamicShellDiscoveryAudit["wait"];
}> {
	const captures: DynamicShellNetworkCapture[] = [];
	const pendingCaptures: Promise<void>[] = [];
	let matchedResponseUrl: string | null = null;
	let matchedSelector: string | null = null;
	let usedNetworkIdleWait = false;
	let usedFixedDelayWait = false;
	const requestHandler = async (context: DynamicShellCrawlerRequestHandlerContext) => {
		const page = context.page;
		const responseWaitPromise = waitForAnyResponse({
			page,
			patterns: compilePatterns(input.policy.waitForResponseUrlPatterns),
			timeoutMs: input.policy.networkObservationTimeoutMs,
		});
		const selectorWaitPromise = waitForAnySelector({
			page,
			selectors: input.policy.waitForSelectorPatterns,
			timeoutMs: input.policy.networkObservationTimeoutMs,
		});
		page.on("response", (response) => {
			pendingCaptures.push(captureTextResponse(response, captures));
		});
		await page.goto(input.url, { waitUntil: "load" });
		[matchedResponseUrl, matchedSelector] = await Promise.all([
			responseWaitPromise,
			selectorWaitPromise,
		]);
		if (matchedResponseUrl == null && matchedSelector == null) {
			usedNetworkIdleWait = true;
			try {
				await page.waitForLoadState("networkidle", {
					timeout: Math.max(250, Math.min(5_000, input.policy.waitAfterLoadMs)),
				});
			} catch {
				// Some shell pages never reach a quiet network state. Continue with fixed wait.
			}
			usedFixedDelayWait = true;
			await page.waitForTimeout(input.policy.waitAfterLoadMs);
		} else {
			try {
				await page.waitForLoadState("networkidle", {
					timeout: input.policy.networkObservationTimeoutMs,
				});
			} catch {
				usedFixedDelayWait = true;
				await page.waitForTimeout(input.policy.waitAfterLoadMs);
			}
		}
		await drainPendingCaptures(pendingCaptures);
	};
	const crawler = (input.crawlerFactory ?? createDefaultDynamicShellCrawler)({
		requestHandler,
	});
	await crawler.run([
		{
			uniqueKey: `dynamic_shell:${input.url}`,
			url: input.url,
		},
	]);

	return {
		captures,
		wait: {
			waitAfterLoadMs: input.policy.waitAfterLoadMs,
			networkObservationTimeoutMs: input.policy.networkObservationTimeoutMs,
			matchedResponseUrl,
			matchedSelector,
			usedNetworkIdleWait,
			usedFixedDelayWait,
		},
	};
}

interface DynamicShellPageResponse {
	url(): string;
	status(): number;
	headers(): Record<string, string>;
	text(): Promise<string>;
}

interface DynamicShellPageLike {
	goto(url: string, options?: { waitUntil?: "load" }): Promise<unknown>;
	on(event: "response", listener: (response: DynamicShellPageResponse) => void): void;
	waitForLoadState(state: "networkidle", options?: { timeout?: number }): Promise<void>;
	waitForResponse(
		urlOrPredicate: string | RegExp | ((response: { url(): string }) => boolean | Promise<boolean>),
		options?: { timeout?: number },
	): Promise<{ url(): string }>;
	waitForSelector(
		selector: string,
		options?: { timeout?: number; state?: "attached" | "detached" | "visible" | "hidden" },
	): Promise<unknown>;
	waitForTimeout(timeout: number): Promise<void>;
}

interface DynamicShellCrawlerRequestHandlerContext {
	page: DynamicShellPageLike;
}

interface DynamicShellCrawlerFactoryInput {
	requestHandler: (context: DynamicShellCrawlerRequestHandlerContext) => Promise<void>;
}

export type DynamicShellCrawlerFactory = (input: DynamicShellCrawlerFactoryInput) => {
	run(requests: RequestOptions[]): Promise<unknown>;
};

async function captureTextResponse(
	response: DynamicShellPageResponse,
	captures: DynamicShellNetworkCapture[],
): Promise<void> {
	const url = response.url();
	const contentType = normalizeHeaderValue(response.headers()["content-type"]);
	const status = response.status();
	if (status >= 400 || !isTextLikeContentType(contentType)) {
		return;
	}

	try {
		captures.push({
			url,
			status,
			contentType,
			bodyText: await response.text(),
		});
	} catch {
		captures.push({
			url,
			status,
			contentType,
			bodyText: null,
		});
	}
}

function createDefaultDynamicShellCrawler(input: DynamicShellCrawlerFactoryInput) {
	const crawler = new PlaywrightCrawler(
		{
			headless: true,
			maxRequestRetries: 0,
			requestHandler: async (context) => {
				await input.requestHandler({
					page: context.page,
				});
			},
		},
		createOfficialWebCrawlerConfiguration("dynamic-shell"),
	);
	return {
		run: async (requests: RequestOptions[]) => await crawler.run(requests),
	};
}

async function drainPendingCaptures(pendingCaptures: Promise<void>[]): Promise<void> {
	let snapshotSize = -1;
	while (snapshotSize !== pendingCaptures.length) {
		snapshotSize = pendingCaptures.length;
		await Promise.allSettled([...pendingCaptures]);
	}
}

async function waitForAnyResponse(input: {
	page: {
		waitForResponse(
			urlOrPredicate:
				| string
				| RegExp
				| ((response: { url(): string }) => boolean | Promise<boolean>),
			options?: { timeout?: number },
		): Promise<{ url(): string }>;
	};
	patterns: RegExp[];
	timeoutMs: number;
}): Promise<string | null> {
	if (input.patterns.length === 0) {
		return null;
	}

	try {
		const matched = await Promise.any(
			input.patterns.map((pattern) =>
				input.page
					.waitForResponse((response) => pattern.test(response.url()), {
						timeout: input.timeoutMs,
					})
					.then((response) => response.url()),
			),
		);
		return matched;
	} catch {
		return null;
	}
}

async function waitForAnySelector(input: {
	page: {
		waitForSelector(
			selector: string,
			options?: { timeout?: number; state?: "attached" | "detached" | "visible" | "hidden" },
		): Promise<unknown>;
	};
	selectors: string[];
	timeoutMs: number;
}): Promise<string | null> {
	if (input.selectors.length === 0) {
		return null;
	}

	try {
		const matched = await Promise.any(
			input.selectors.map((selector) =>
				input.page
					.waitForSelector(selector, {
						timeout: input.timeoutMs,
						state: "attached",
					})
					.then(() => selector),
			),
		);
		return matched;
	} catch {
		return null;
	}
}
