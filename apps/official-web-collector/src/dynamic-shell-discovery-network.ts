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
	policy: OfficialWebDynamicShellDiscoveryPolicy;
	url: string;
}): Promise<{
	captures: DynamicShellNetworkCapture[];
	wait: OfficialWebDynamicShellDiscoveryAudit["wait"];
}> {
	const moduleName = "playwright";
	const playwright = await import(moduleName);
	const browser = await playwright.chromium.launch({ headless: true });
	const page = await browser.newPage();
	const captures: DynamicShellNetworkCapture[] = [];
	const pendingCaptures: Promise<void>[] = [];
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
	let matchedResponseUrl: string | null = null;
	let matchedSelector: string | null = null;
	let usedNetworkIdleFallback = false;
	let usedFixedDelayFallback = false;

	page.on(
		"response",
		(response: {
			url(): string;
			status(): number;
			headers(): Record<string, string>;
			text(): Promise<string>;
		}) => {
			pendingCaptures.push(
				(async () => {
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
				})(),
			);
		},
	);

	try {
		await page.goto(input.url, { waitUntil: "load" });
		[matchedResponseUrl, matchedSelector] = await Promise.all([
			responseWaitPromise,
			selectorWaitPromise,
		]);
		if (matchedResponseUrl == null && matchedSelector == null) {
			usedNetworkIdleFallback = true;
			try {
				await page.waitForLoadState("networkidle", {
					timeout: Math.max(250, Math.min(5_000, input.policy.waitAfterLoadMs)),
				});
			} catch {
				// Some shell pages never reach a quiet network state. Fall back to fixed wait.
			}
			usedFixedDelayFallback = true;
			await page.waitForTimeout(input.policy.waitAfterLoadMs);
		} else {
			try {
				await page.waitForLoadState("networkidle", {
					timeout: input.policy.networkObservationTimeoutMs,
				});
			} catch {
				usedFixedDelayFallback = true;
				await page.waitForTimeout(input.policy.waitAfterLoadMs);
			}
		}
		await drainPendingCaptures(pendingCaptures);
	} finally {
		await page.close();
		await browser.close();
	}

	return {
		captures,
		wait: {
			waitAfterLoadMs: input.policy.waitAfterLoadMs,
			networkObservationTimeoutMs: input.policy.networkObservationTimeoutMs,
			matchedResponseUrl,
			matchedSelector,
			usedNetworkIdleFallback,
			usedFixedDelayFallback,
		},
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
