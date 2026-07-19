import { BasicCrawler, type BasicCrawlingContext, type RequestOptions } from "crawlee";
import { sha256Hex } from "ingest-core";
import { runCrawleeWithCancellation } from "../../../src/crawlee-cancellation.ts";

import { type FetchAttachmentBinaryResult, fetchAttachmentBinary } from "./api.js";
import { createAuthenticatedNoticeCrawlerConfiguration } from "./crawlee-runtime.js";
import type { ApiRequestContextLike } from "./types.js";

export type AttachmentDownloadFetchMode =
	| "file_release"
	| "portal_internal"
	| "trusted_external_visual";

type AttachmentDownloadRequestUserData =
	| {
			attachmentUrl: string;
			cacheKey: string;
			fetchMode: "file_release";
	  }
	| {
			attachmentUrl: string;
			cacheKey: string;
			fetchMode: "portal_internal";
	  }
	| {
			attachmentUrl: string;
			cacheKey: string;
			fetchMode: "trusted_external_visual";
	  };

type AttachmentDownloadContext = BasicCrawlingContext<AttachmentDownloadRequestUserData>;

export interface AttachmentDownloadRequestSpec {
	attachmentUrl: string;
	cacheKey: string;
	fetchMode: AttachmentDownloadFetchMode;
	siteId: string;
}

export interface AttachmentDownloadResult {
	cacheKey: string;
	result: FetchAttachmentBinaryResult;
}

export type AttachmentDownloadOutcome =
	| {
			status: "fulfilled";
			result: FetchAttachmentBinaryResult;
	  }
	| {
			status: "rejected";
			error: Error;
	  };

export interface AttachmentDownloadRunnerInput {
	abortSignal?: AbortSignal;
	apiContext: ApiRequestContextLike;
	externalVisualFetcher?: ExternalVisualFetcher;
	maxTotalBytes?: number;
	requestMaxRetries: number;
	requests: AttachmentDownloadRequestSpec[];
}

export type ExternalVisualFetcher = (input: {
	abortSignal?: AbortSignal;
	attachmentUrl: string;
	sendRequest: NonNullable<AttachmentDownloadRequestHandlerContext["sendRequest"]>;
}) => Promise<FetchAttachmentBinaryResult>;

interface AttachmentDownloadRequestHandlerContext {
	request: {
		userData: unknown;
	};
	sendRequest?(input: { maxRedirects?: number; responseType: "buffer"; url: string }): Promise<{
		body: Buffer | Uint8Array | string;
		headers?: Record<string, string | string[] | undefined>;
		statusCode?: number;
	}>;
}

const INTERNAL_REQUEST_BASE_URL = "https://collector.local/authenticated-notice/download";
const EXTERNAL_VISUAL_MAX_BYTES = 10 * 1024 * 1024;
const INTERNAL_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;
export const TRUSTED_EXTERNAL_VISUAL_HOSTS = new Set(["mmbiz.qpic.cn"]);

export function buildAttachmentDownloadRequest(
	input: AttachmentDownloadRequestSpec,
): RequestOptions<AttachmentDownloadRequestUserData> {
	const urlDigest = sha256Hex(input.attachmentUrl).slice(0, 16);
	return {
		label: input.fetchMode,
		method: "GET",
		uniqueKey: `attachment_download:${input.siteId}:${input.fetchMode}:${urlDigest}`,
		url: `${INTERNAL_REQUEST_BASE_URL}/${input.fetchMode}`,
		userData: {
			attachmentUrl: input.attachmentUrl,
			cacheKey: input.cacheKey,
			fetchMode: input.fetchMode,
		},
	};
}

export async function runAttachmentCrawleeDownloads(
	input: AttachmentDownloadRunnerInput,
): Promise<Map<string, FetchAttachmentBinaryResult>> {
	const outcomes = await runAttachmentCrawleeDownloadOutcomes(input);
	const results = new Map<string, FetchAttachmentBinaryResult>();
	for (const [cacheKey, outcome] of outcomes) {
		if (outcome.status === "rejected") {
			throw outcome.error;
		}
		results.set(cacheKey, outcome.result);
	}
	return results;
}

export async function runAttachmentCrawleeDownloadOutcomes(
	input: AttachmentDownloadRunnerInput,
): Promise<Map<string, AttachmentDownloadOutcome>> {
	const outcomes = new Map<string, AttachmentDownloadOutcome>();
	let fulfilledBytes = 0;
	const requestHandler = async (context: AttachmentDownloadRequestHandlerContext) => {
		input.abortSignal?.throwIfAborted();
		const userData = normalizeRequestUserData(context.request.userData);
		const result =
			userData.fetchMode === "trusted_external_visual"
				? await (input.externalVisualFetcher ?? fetchTrustedExternalVisualBinary)({
						abortSignal: input.abortSignal,
						attachmentUrl: userData.attachmentUrl,
						sendRequest: requireSendRequest(context),
					})
				: await fetchAttachmentBinary({
						apiContext: input.apiContext,
						attachmentUrl: userData.attachmentUrl,
						maxBytes:
							userData.fetchMode === "portal_internal" ? INTERNAL_ATTACHMENT_MAX_BYTES : undefined,
					});
		input.abortSignal?.throwIfAborted();
		const nextFulfilledBytes = fulfilledBytes + result.body.byteLength;
		if (input.maxTotalBytes !== undefined && nextFulfilledBytes > input.maxTotalBytes) {
			throw new Error(`attachment_run_size_limit_exceeded:${nextFulfilledBytes}`);
		}
		fulfilledBytes = nextFulfilledBytes;
		outcomes.set(userData.cacheKey, {
			status: "fulfilled",
			result,
		});
	};
	const crawler = createDefaultAttachmentDownloadCrawler({
		failedRequestHandler: async (context, error) => {
			const userData = normalizeRequestUserData(context.request.userData);
			outcomes.set(userData.cacheKey, {
				status: "rejected",
				error,
			});
		},
		maxRequestRetries: input.requestMaxRetries,
		requestHandler,
	});
	await runCrawleeWithCancellation({
		abortSignal: input.abortSignal,
		crawler,
		requests: input.requests.map(buildAttachmentDownloadRequest),
	});
	return outcomes;
}

function createDefaultAttachmentDownloadCrawler(input: {
	failedRequestHandler: (
		context: AttachmentDownloadRequestHandlerContext,
		error: Error,
	) => Promise<void>;
	maxRequestRetries: number;
	requestHandler: (context: AttachmentDownloadRequestHandlerContext) => Promise<void>;
}) {
	const crawler = new BasicCrawler<AttachmentDownloadContext>(
		{
			maxConcurrency: 2,
			maxRequestsPerMinute: 30,
			failedRequestHandler: async (context, error) => {
				await input.failedRequestHandler(
					{
						request: {
							userData: context.request.userData,
						},
						sendRequest: async (overrideOptions) => await context.sendRequest(overrideOptions),
					},
					error,
				);
			},
			maxRequestRetries: input.maxRequestRetries,
			requestHandler: async (context) => {
				await input.requestHandler({
					request: {
						userData: context.request.userData,
					},
					sendRequest: async (overrideOptions) => await context.sendRequest(overrideOptions),
				});
			},
		},
		createAuthenticatedNoticeCrawlerConfiguration("attachment"),
	);
	return {
		run: async (requests: RequestOptions<AttachmentDownloadRequestUserData>[]) =>
			await crawler.run(requests),
		stop: async (reason?: string) => await crawler.stop(reason),
	};
}

function normalizeRequestUserData(value: unknown): AttachmentDownloadRequestUserData {
	if (!(value && typeof value === "object" && "fetchMode" in value)) {
		throw new Error("invalid attachment download request userData");
	}
	const candidate = value as AttachmentDownloadRequestUserData;
	if (
		(candidate.fetchMode === "portal_internal" ||
			candidate.fetchMode === "file_release" ||
			candidate.fetchMode === "trusted_external_visual") &&
		typeof candidate.attachmentUrl === "string" &&
		typeof candidate.cacheKey === "string"
	) {
		return candidate;
	}
	throw new Error("invalid attachment download request type");
}

function requireSendRequest(
	context: AttachmentDownloadRequestHandlerContext,
): NonNullable<AttachmentDownloadRequestHandlerContext["sendRequest"]> {
	if (!context.sendRequest) {
		throw new Error("trusted external visual download requires Crawlee sendRequest context");
	}
	return context.sendRequest;
}

export async function fetchTrustedExternalVisualBinary(input: {
	abortSignal?: AbortSignal;
	attachmentUrl: string;
	sendRequest: NonNullable<AttachmentDownloadRequestHandlerContext["sendRequest"]>;
}): Promise<FetchAttachmentBinaryResult> {
	input.abortSignal?.throwIfAborted();
	let currentUrl = validateExternalVisualUrl(input.attachmentUrl);
	let response: Awaited<ReturnType<typeof input.sendRequest>>;
	for (let redirectCount = 0; ; redirectCount += 1) {
		response = await input.sendRequest({
			maxRedirects: 0,
			responseType: "buffer",
			url: currentUrl,
		});
		if (!isRedirectStatus(response.statusCode)) {
			break;
		}
		if (redirectCount >= 3) {
			throw new Error("downloadExternalVisual exceeded redirect limit");
		}
		const location = normalizeHeaderValue(response.headers?.location);
		if (!location) {
			throw new Error("downloadExternalVisual redirect omitted location");
		}
		currentUrl = validateExternalVisualUrl(new URL(location, currentUrl).toString());
	}
	input.abortSignal?.throwIfAborted();
	const contentType = normalizeHeaderValue(response.headers?.["content-type"]);
	const normalizedContentType = normalizeContentType(contentType);
	if (!normalizedContentType?.startsWith("image/")) {
		throw new Error(
			`downloadExternalVisual returned non-image content-type: ${contentType ?? "unknown"}`,
		);
	}
	const contentLength = parseContentLength(
		normalizeHeaderValue(response.headers?.["content-length"]),
	);
	if (contentLength !== null && contentLength > EXTERNAL_VISUAL_MAX_BYTES) {
		throw new Error(`downloadExternalVisual exceeded max size before download: ${contentLength}`);
	}
	const body = toBuffer(response.body);
	if (body.byteLength > EXTERNAL_VISUAL_MAX_BYTES) {
		throw new Error(`downloadExternalVisual exceeded max size: ${body.byteLength}`);
	}
	return {
		body,
		contentType,
		contentDisposition: normalizeHeaderValue(response.headers?.["content-disposition"]),
		etag: normalizeHeaderValue(response.headers?.etag),
		lastModified: normalizeHeaderValue(response.headers?.["last-modified"]),
		statusCode: response.statusCode ?? 0,
	};
}

function validateExternalVisualUrl(value: string): string {
	const url = new URL(value);
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		!TRUSTED_EXTERNAL_VISUAL_HOSTS.has(url.hostname.toLowerCase())
	) {
		throw new Error("downloadExternalVisual rejected untrusted URL");
	}
	return url.toString();
}

function isRedirectStatus(statusCode: number | undefined): boolean {
	return statusCode !== undefined && [301, 302, 303, 307, 308].includes(statusCode);
}

function normalizeContentType(value: string | null): string | null {
	if (!value) {
		return null;
	}
	const normalized = value.split(";")[0]?.trim().toLowerCase() ?? "";
	return normalized || null;
}

function normalizeHeaderValue(value: string | string[] | null | undefined): string | null {
	if (Array.isArray(value)) {
		return value.join(", ").trim() || null;
	}
	if (!value) {
		return null;
	}
	const trimmed = value.trim();
	return trimmed || null;
}

function parseContentLength(value: string | null): number | null {
	if (!value) {
		return null;
	}
	const parsed = Number(value.trim());
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function toBuffer(value: Buffer | Uint8Array | string): Buffer {
	return Buffer.isBuffer(value) ? value : Buffer.from(value);
}
