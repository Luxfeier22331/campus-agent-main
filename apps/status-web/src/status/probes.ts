import { ChatAvailabilityResponseSchema } from "campus-contracts/product-availability";

import type { ProbeDefinition, ProbeObservation } from "./types";

export type ProbeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface CampusHtmlStructure {
	moduleScriptSources: string[];
	rootMountCount: number;
	title: string;
}

export type CampusHtmlParser = (html: string) => Promise<CampusHtmlStructure>;

const DEFAULT_TIMEOUT_MS = 8_000;
const ERROR_PAGE_PATTERN =
	/(?:登录|错误|出错|无法访问|页面不存在|not found|sign in|log in|error)/iu;
const CAMPUS_TITLE_PATTERN = /(?:MUC Campus|中央民族大学校园问答)/u;
const CAMPUS_MODULE_PATTERN = /^\/?(?:src\/(?:docs-)?main\.tsx|assets\/[^/?#]+\.js)(?:[?#].*)?$/u;
const ERROR_FINAL_PATH_PATTERN =
	/^\/(?:account(?:\/|$)|auth(?:\/|$)|(?:login|signin|sign-in|error|errors|not-found)(?:[/-]|$)|(?:4\d{2}|5\d{2})(?:[/-]|$))/iu;

export async function runProbe(
	definition: ProbeDefinition,
	origin: string,
	input: {
		fetchFn?: ProbeFetch;
		htmlParser?: CampusHtmlParser;
		now?: Date;
		timeoutMs?: number;
	} = {},
): Promise<ProbeObservation> {
	const checkedAt = input.now ?? new Date();
	const startedAt = Date.now();
	const method = definition.method ?? "GET";
	const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	let target: URL;
	try {
		target = new URL(definition.path, ensureOrigin(origin));
	} catch {
		return observation(definition, checkedAt, startedAt, null, "invalid", "content");
	}

	const controller = new AbortController();
	let timedOut = false;
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => {
			timedOut = true;
			controller.abort();
			reject(new Error("probe timed out"));
		}, timeoutMs);
	});
	try {
		const fetchFn = input.fetchFn ?? globalThis.fetch;
		const response = await Promise.race([
			fetchFn(target, {
				headers: {
					accept: definition.bodyKind === "json" ? "application/json" : "text/html",
				},
				method,
				redirect: "follow",
				signal: controller.signal,
			}),
			timeoutPromise,
		]);
		if (!response.ok) {
			return observation(definition, checkedAt, startedAt, response.status, "failed", "http");
		}
		if (!hasAllowedFinalUrl(response, target)) {
			return observation(definition, checkedAt, startedAt, response.status, "invalid", "content");
		}
		if (!matchesContentType(response, definition.bodyKind)) {
			return observation(definition, checkedAt, startedAt, response.status, "invalid", "content");
		}
		if (method !== "HEAD") {
			const body = await Promise.race([response.text(), timeoutPromise]);
			const bodyResult = await Promise.race([
				hasExpectedBody(definition, body, input.htmlParser),
				timeoutPromise,
			]);
			if (bodyResult === null) {
				return observation(definition, checkedAt, startedAt, response.status, "invalid", "content");
			}
			if (bodyResult !== "passed") {
				return observation(definition, checkedAt, startedAt, response.status, bodyResult, null);
			}
		}
		return observation(definition, checkedAt, startedAt, response.status, "passed", null);
	} catch {
		return observation(
			definition,
			checkedAt,
			startedAt,
			null,
			timedOut ? "timed_out" : "failed",
			timedOut ? "timeout" : "network",
		);
	} finally {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
		}
	}
}

export async function parseCampusHtmlWithHtmlRewriter(html: string): Promise<CampusHtmlStructure> {
	let title = "";
	let rootMountCount = 0;
	const moduleScriptSources: string[] = [];
	const transformed = new HTMLRewriter()
		.on("title", {
			text(chunk) {
				title += chunk.text;
			},
		})
		.on("#root", {
			element() {
				rootMountCount += 1;
			},
		})
		.on('script[type="module"]', {
			element(element) {
				const source = element.getAttribute("src")?.trim();
				if (source) {
					moduleScriptSources.push(source);
				}
			},
		})
		.transform(
			new Response(html, {
				headers: { "content-type": "text/html; charset=utf-8" },
			}),
		);
	await transformed.arrayBuffer();
	return { moduleScriptSources, rootMountCount, title: title.trim() };
}

function ensureOrigin(origin: string): string {
	const parsed = new URL(origin);
	if (
		parsed.pathname !== "/" ||
		parsed.search ||
		parsed.hash ||
		parsed.username ||
		parsed.password
	) {
		throw new Error("probe origin must be a credential-free origin");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("probe origin must use HTTP or HTTPS");
	}
	return parsed.toString();
}

function hasAllowedFinalUrl(response: Response, target: URL): boolean {
	if (!response.url) {
		return true;
	}
	try {
		const finalUrl = new URL(response.url, target);
		const pathname = decodeURIComponent(finalUrl.pathname);
		return (
			(finalUrl.protocol === "http:" || finalUrl.protocol === "https:") &&
			!finalUrl.username &&
			!finalUrl.password &&
			!finalUrl.search &&
			!finalUrl.hash &&
			!ERROR_FINAL_PATH_PATTERN.test(pathname)
		);
	} catch {
		return false;
	}
}

function matchesContentType(response: Response, bodyKind: ProbeDefinition["bodyKind"]): boolean {
	const mediaType =
		response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
	if (bodyKind === "html") {
		return mediaType === "text/html";
	}
	return (
		/^application\/[a-z0-9!#$&^_.+~-]+\+json$/u.test(mediaType) || mediaType === "application/json"
	);
}

async function hasExpectedBody(
	definition: ProbeDefinition,
	body: string,
	htmlParser: CampusHtmlParser | undefined,
): Promise<"passed" | "failed" | "unknown" | null> {
	try {
		if (definition.bodyKind === "html") {
			const parsed = await (htmlParser ?? parseCampusHtmlWithHtmlRewriter)(body);
			return parsed.rootMountCount === 1 &&
				CAMPUS_TITLE_PATTERN.test(parsed.title) &&
				!ERROR_PAGE_PATTERN.test(parsed.title) &&
				parsed.moduleScriptSources.some((source) => CAMPUS_MODULE_PATTERN.test(source))
				? "passed"
				: null;
		}
		const parsed: unknown = JSON.parse(body);
		if (!isRecord(parsed) || Object.keys(parsed).length === 0 || "error" in parsed) {
			return null;
		}
		return validateJson(definition.validator, parsed);
	} catch {
		return null;
	}
}

function validateJson(
	definition: ProbeDefinition["validator"],
	value: Record<string, unknown>,
): "passed" | "failed" | "unknown" | null {
	if (definition !== "chat_availability") {
		return null;
	}
	const parsed = ChatAvailabilityResponseSchema.safeParse(value);
	if (!parsed.success) {
		return null;
	}
	return parsed.data.status === "operational"
		? "passed"
		: parsed.data.status === "outage"
			? "failed"
			: "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function observation(
	definition: ProbeDefinition,
	checkedAt: Date,
	startedAt: number,
	httpStatus: number | null,
	status: ProbeObservation["status"],
	errorKind: ProbeObservation["errorKind"],
): ProbeObservation {
	return {
		checkedAt: checkedAt.toISOString(),
		errorKind,
		httpStatus,
		latencyMs: Math.max(0, Date.now() - startedAt),
		probeId: definition.id,
		serviceId: definition.serviceId,
		status,
	};
}
