import { BasicCrawler, type BasicCrawlingContext, type RequestOptions } from "crawlee";
import { sha256Hex } from "ingest-core";

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
	apiContext: ApiRequestContextLike;
	externalVisualFetcher?: ExternalVisualFetcher;
	requestMaxRetries: number;
	requests: AttachmentDownloadRequestSpec[];
}

export type ExternalVisualFetcher = (input: {
	attachmentUrl: string;
	sendRequest: NonNullable<AttachmentDownloadRequestHandlerContext["sendRequest"]>;
}) => Promise<FetchAttachmentBinaryResult>;

interface AttachmentDownloadRequestHandlerContext {
	request: {
		userData: unknown;
	};
	sendRequest?(input: { responseType: "buffer"; url: string }): Promise<{
		body: Buffer | Uint8Array | string;
		headers?: Record<string, string | string[] | undefined>;
		statusCode?: number;
	}>;
}

const INTERNAL_REQUEST_BASE_URL = "https://collector.local/authenticated-notice/download";
const EXTERNAL_VISUAL_MAX_BYTES = 10 * 1024 * 1024;

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
	const requestHandler = async (context: AttachmentDownloadRequestHandlerContext) => {
		const userData = normalizeRequestUserData(context.request.userData);
		const result =
			userData.fetchMode === "trusted_external_visual"
				? await (input.externalVisualFetcher ?? fetchExternalVisualBinary)({
						attachmentUrl: userData.attachmentUrl,
						sendRequest: requireSendRequest(context),
					})
				: await fetchAttachmentBinary({
						apiContext: input.apiContext,
						attachmentUrl: userData.attachmentUrl,
					});
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
	await crawler.run(input.requests.map(buildAttachmentDownloadRequest));
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

async function fetchExternalVisualBinary(input: {
	attachmentUrl: string;
	sendRequest: NonNullable<AttachmentDownloadRequestHandlerContext["sendRequest"]>;
}): Promise<FetchAttachmentBinaryResult> {
	const response = await input.sendRequest({
		responseType: "buffer",
		url: input.attachmentUrl,
	});
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
		statusCode: response.statusCode ?? 0,
	};
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
