import { lookup as dnsLookup } from "node:dns";
import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import { Parser } from "htmlparser2";
import ipaddr from "ipaddr.js";
import { EnvHttpProxyAgent, fetch as fetchPage } from "undici";
import type { AgentRunnerInput, AgentRunnerResult } from "./agent-run-contract.ts";
import { operationDeadlineMs } from "./execution-budget.ts";

const maxPageBytes = 512 * 1024;
const sourceTimeoutMs = 5_000;
const batchTimeoutMs = 10_000;
const maxRedirects = 5;
const concurrency = 4;

interface PageResponse {
	status: number;
	headers: Pick<Headers, "get">;
	body: {
		cancel(): Promise<void>;
		getReader(): {
			read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>;
			cancel(): Promise<void>;
		};
	} | null;
}
export interface SourceResolverDependencies {
	fetch: (url: string, signal: AbortSignal) => Promise<PageResponse>;
	lookup: (hostname: string) => Promise<string[]>;
}
export type GeminiSourceResolver = (
	input: AgentRunnerInput,
	result: AgentRunnerResult,
) => Promise<void>;

export function isPublicSourceAddress(address: string): boolean {
	try {
		return ipaddr.process(address).range() === "unicast";
	} catch {
		return false;
	}
}

// Recheck the actual direct connection's DNS results, not only a prior lookup.
// With an environment proxy, that explicitly configured egress owns the connection.
const publicLookup: LookupFunction = (hostname, options, callback) => {
	dnsLookup(hostname, options, (error, address, family) => {
		if (error) {
			return callback(error, address, family);
		}
		const addresses = Array.isArray(address) ? address.map((item) => item.address) : [address];
		if (!addresses.every(isPublicSourceAddress)) {
			return callback(new Error("Source address is not public"), address, family);
		}
		callback(null, address, family);
	});
};

export function createGeminiSourceResolver(dependencies?: SourceResolverDependencies) {
	const dispatcher = dependencies
		? undefined
		: new EnvHttpProxyAgent({ connect: { lookup: publicLookup } });
	const io: SourceResolverDependencies = dependencies ?? {
		fetch: (url, signal) =>
			fetchPage(url, { ...(dispatcher ? { dispatcher } : {}), redirect: "manual", signal }),
		lookup: async (hostname) =>
			(await lookup(hostname, { all: true })).map((entry) => entry.address),
	};
	const resolve: GeminiSourceResolver = async (input, result) => {
		const sources = [
			...new Set(
				(result.webEvidence ?? [])
					.filter((item) => !item.sourceLink && isGoogleRedirect(item.url))
					.map((item) => item.url),
			),
		];
		if (sources.length === 0) {
			return;
		}
		const budget = Math.min(
			batchTimeoutMs,
			input.deadlineAt ? operationDeadlineMs(input.deadlineAt, input.operation) : batchTimeoutMs,
		);
		const batchSignal = AbortSignal.any([
			AbortSignal.timeout(Math.max(0, budget)),
			...(input.signal ? [input.signal] : []),
		]);
		const resolved = new Map<string, { href: string | null; title?: string }>();
		let next = 0;
		const worker = async () => {
			while (next < sources.length) {
				const url = sources[next++];
				if (!url) {
					return;
				}
				if (batchSignal.aborted || budget <= 0) {
					resolved.set(url, { href: null });
					continue;
				}
				const signal = AbortSignal.any([batchSignal, AbortSignal.timeout(sourceTimeoutMs)]);
				resolved.set(url, await resolvePage(url, io, signal));
			}
		};
		await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker));
		result.webEvidence = (result.webEvidence ?? []).map((item) => {
			const page = resolved.get(item.url);
			if (!page) {
				return item;
			}
			return {
				...item,
				title: page.title ?? existingPageTitle(item.title) ?? "网页标题暂不可用",
				sourceLink: { href: page.href },
			};
		});
	};
	return {
		resolve,
		close: async () => {
			await dispatcher?.close();
		},
	};
}

function isGoogleRedirect(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			url.hostname === "vertexaisearch.cloud.google.com" &&
			url.pathname.startsWith("/grounding-api-redirect/")
		);
	} catch {
		return false;
	}
}

function existingPageTitle(value: string): string | undefined {
	const title = cleanTitle(value);
	return title && !/^(?:https?:\/\/)?[\w.-]+\.[a-z]{2,}\/?$/iu.test(title) ? title : undefined;
}

async function validateTarget(url: URL, io: SourceResolverDependencies, signal: AbortSignal) {
	if (
		!["https:", "http:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		(url.port && !["80", "443"].includes(url.port))
	) {
		throw new Error("Invalid source URL");
	}
	const hostname = url.hostname.replace(/^\[|\]$/gu, "");
	const addresses = ipaddr.isValid(hostname)
		? [hostname]
		: await abortable(io.lookup(hostname), signal);
	if (addresses.length === 0 || !addresses.every(isPublicSourceAddress)) {
		throw new Error("Source address is not public");
	}
}

async function resolvePage(
	initial: string,
	io: SourceResolverDependencies,
	signal: AbortSignal,
): Promise<{ href: string | null; title?: string }> {
	let url = new URL(initial);
	let href: string | null = null;
	const visited = new Set<string>();
	try {
		for (let redirects = 0; redirects <= maxRedirects; redirects++) {
			signal.throwIfAborted();
			if (visited.has(url.href)) {
				return { href: null };
			}
			visited.add(url.href);
			try {
				await validateTarget(url, io, signal);
			} catch (error) {
				if (signal.aborted) {
					throw error;
				}
				return { href: null };
			}
			if (!isGoogleRedirect(url.href)) {
				href = url.href;
			}
			const response = await abortable(io.fetch(url.href, signal), signal);
			if ([301, 302, 303, 307, 308].includes(response.status)) {
				await response.body?.cancel();
				const location = response.headers.get("location");
				if (!location || redirects === maxRedirects) {
					return { href: null };
				}
				const next = new URL(location, url);
				if (!(next.hash || location.includes("#"))) {
					next.hash = url.hash;
				}
				url = next;
				continue;
			}
			if (
				!href ||
				response.status < 200 ||
				response.status >= 300 ||
				!/^(?:text\/html|application\/xhtml\+xml)\b/iu.test(
					response.headers.get("content-type") ?? "",
				)
			) {
				await response.body?.cancel();
				return { href };
			}
			const metadata = await readPageMetadata(response, signal);
			if (metadata.redirect) {
				if (redirects === maxRedirects) {
					return { href: null };
				}
				try {
					url = new URL(metadata.redirect, url);
				} catch {
					return { href: null };
				}
				continue;
			}
			return { href, ...(metadata.title ? { title: metadata.title } : {}) };
		}
	} catch {
		// A known original URL remains useful when only loading its title failed.
		return { href };
	}
	return { href: null };
}

function cleanTitle(value: string): string | undefined {
	const cleaned = value
		.replace(/\p{Cc}/gu, " ")
		.replace(/\s+/gu, " ")
		.trim();
	return cleaned ? [...cleaned].slice(0, 512).join("") : undefined;
}

async function readPageMetadata(
	response: PageResponse,
	signal: AbortSignal,
): Promise<{ title?: string; redirect?: string }> {
	if (!response.body) {
		return {};
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		while (length < maxPageBytes) {
			const { value, done } = await abortable(reader.read(), signal);
			if (done || !value) {
				break;
			}
			const bounded = value.subarray(0, maxPageBytes - length);
			chunks.push(bounded);
			length += bounded.length;
			if (Buffer.concat(chunks).includes(Buffer.from("</head>"))) {
				break;
			}
		}
	} finally {
		await reader.cancel().catch(() => undefined);
	}
	const bytes = Buffer.concat(chunks);
	const declared = response.headers
		.get("content-type")
		?.match(/charset\s*=\s*["']?([^\s;"']+)/iu)?.[1];
	const meta = bytes
		.subarray(0, 4096)
		.toString("latin1")
		.match(/<meta\b[^>]*charset\s*=\s*["']?([^\s;"'/>]+)/iu)?.[1];
	let html: string;
	try {
		html = new TextDecoder(declared ?? meta ?? "utf-8").decode(bytes);
	} catch {
		html = new TextDecoder().decode(bytes);
	}
	let title = "";
	let ogTitle: string | undefined;
	let inTitle = false;
	const parser = new Parser(
		{
			onopentag(name, attributes) {
				if (name === "title") {
					inTitle = true;
				}
				if (name === "meta" && attributes.property?.toLowerCase() === "og:title" && !ogTitle) {
					ogTitle = cleanTitle(attributes.content ?? "");
				}
			},
			ontext(text) {
				if (inTitle) {
					title += text;
				}
			},
			onclosetag(name) {
				if (name === "title") {
					inTitle = false;
				}
			},
		},
		{ decodeEntities: true },
	);
	parser.end(html);
	const pageTitle = ogTitle ?? cleanTitle(title);
	// Recognize only the complete standalone redirect stub observed on source pages.
	// Never execute JavaScript or infer targets from scripts in ordinary documents.
	const redirect = html.match(
		/^\s*<script>\s*window\.location\.href\s*=\s*(["'])([^"'\\\r\n]+)\1\s*;?\s*<\/script>\s*$/u,
	)?.[2];
	return { ...(pageTitle ? { title: pageTitle } : {}), ...(redirect ? { redirect } : {}) };
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	signal.throwIfAborted();
	let abort: (() => void) | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				abort = () => reject(signal.reason);
				signal.addEventListener("abort", abort, { once: true });
			}),
		]);
	} finally {
		if (abort) {
			signal.removeEventListener("abort", abort);
		}
	}
}
