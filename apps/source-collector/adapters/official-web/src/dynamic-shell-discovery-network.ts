import { PlaywrightCrawler, type RequestOptions } from "crawlee";
import { runCrawleeWithCancellation } from "../../../src/crawlee-cancellation.ts";

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
	abortSignal?: AbortSignal;
	crawlerFactory?: DynamicShellCrawlerFactory;
	policy: OfficialWebDynamicShellDiscoveryPolicy;
	url: string;
}): Promise<DynamicShellPageObservation> {
	const observations: DynamicShellPageObservation[] = [];
	const requestHandler = async (context: DynamicShellCrawlerRequestHandlerContext) => {
		input.abortSignal?.throwIfAborted();
		observations.push(
			await observeDynamicShellPage({
				abortSignal: input.abortSignal,
				page: context.page,
				policy: input.policy,
				url: input.url,
			}),
		);
	};
	const crawler = (input.crawlerFactory ?? createDefaultDynamicShellCrawler)({
		requestHandler,
	});
	await runCrawleeWithCancellation({
		abortSignal: input.abortSignal,
		crawler,
		requests: [
			{
				uniqueKey: `dynamic_shell:${input.url}`,
				url: input.url,
			},
		],
	});

	const [observed] = observations;
	if (!observed) {
		throw new Error("dynamic shell crawler did not observe the page");
	}
	return observed;
}

interface DynamicShellPageObservation {
	captures: DynamicShellNetworkCapture[];
	wait: OfficialWebDynamicShellDiscoveryAudit["wait"];
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
	stop?(reason?: string): Promise<void>;
};

export async function observeDynamicShellPage(input: {
	abortSignal?: AbortSignal;
	page: DynamicShellPageLike;
	policy: OfficialWebDynamicShellDiscoveryPolicy;
	url: string;
}): Promise<DynamicShellPageObservation> {
	input.abortSignal?.throwIfAborted();
	const captures: DynamicShellNetworkCapture[] = [];
	const pendingCaptures: Promise<void>[] = [];
	const responseWaitPromise = waitForAnyResponse({
		page: input.page,
		patterns: compilePatterns(input.policy.waitForResponseUrlPatterns),
		timeoutMs: input.policy.networkObservationTimeoutMs,
	});
	const selectorWaitPromise = waitForAnySelector({
		page: input.page,
		selectors: input.policy.waitForSelectorPatterns,
		timeoutMs: input.policy.networkObservationTimeoutMs,
	});
	input.page.on("response", (response) => {
		pendingCaptures.push(captureTextResponse(response, captures));
	});
	await input.page.goto(input.url, { waitUntil: "load" });
	input.abortSignal?.throwIfAborted();
	const [matchedResponseUrl, matchedSelector] = await Promise.all([
		responseWaitPromise,
		selectorWaitPromise,
	]);
	input.abortSignal?.throwIfAborted();
	const waitOutcome = await waitAfterDynamicShellLoad({
		matchedResponseUrl,
		matchedSelector,
		page: input.page,
		policy: input.policy,
	});
	await drainPendingCaptures(pendingCaptures);
	input.abortSignal?.throwIfAborted();
	return {
		captures,
		wait: {
			waitAfterLoadMs: input.policy.waitAfterLoadMs,
			networkObservationTimeoutMs: input.policy.networkObservationTimeoutMs,
			matchedResponseUrl,
			matchedSelector,
			usedNetworkIdleWait: waitOutcome.usedNetworkIdleWait,
			usedFixedDelayWait: waitOutcome.usedFixedDelayWait,
		},
	};
}

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
		stop: async (reason?: string) => await crawler.stop(reason),
	};
}

async function drainPendingCaptures(pendingCaptures: Promise<void>[]): Promise<void> {
	let snapshotSize = -1;
	while (snapshotSize !== pendingCaptures.length) {
		snapshotSize = pendingCaptures.length;
		await Promise.allSettled([...pendingCaptures]);
	}
}

async function waitAfterDynamicShellLoad(input: {
	matchedResponseUrl: string | null;
	matchedSelector: string | null;
	page: Pick<DynamicShellPageLike, "waitForLoadState" | "waitForTimeout">;
	policy: OfficialWebDynamicShellDiscoveryPolicy;
}): Promise<{
	usedFixedDelayWait: boolean;
	usedNetworkIdleWait: boolean;
}> {
	if (input.matchedResponseUrl == null && input.matchedSelector == null) {
		try {
			await input.page.waitForLoadState("networkidle", {
				timeout: Math.max(250, Math.min(5_000, input.policy.waitAfterLoadMs)),
			});
		} catch {
			// Some shell pages never reach a quiet network state. Continue with fixed wait.
		}
		await input.page.waitForTimeout(input.policy.waitAfterLoadMs);
		return {
			usedFixedDelayWait: true,
			usedNetworkIdleWait: true,
		};
	}

	try {
		await input.page.waitForLoadState("networkidle", {
			timeout: input.policy.networkObservationTimeoutMs,
		});
		return {
			usedFixedDelayWait: false,
			usedNetworkIdleWait: false,
		};
	} catch {
		await input.page.waitForTimeout(input.policy.waitAfterLoadMs);
		return {
			usedFixedDelayWait: true,
			usedNetworkIdleWait: false,
		};
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
