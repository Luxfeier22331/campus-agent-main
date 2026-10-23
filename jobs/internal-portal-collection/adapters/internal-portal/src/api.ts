import { readFile } from "node:fs/promises";

import {
	spoolAttachmentToTemporaryFile,
	type TemporaryAttachmentFile,
} from "./attachment-temp-file.js";
import { PortalSessionExpiredError } from "./auth-errors.js";
import { PortalNoticeUnavailableError } from "./notice-ingestion-errors.js";
import type {
	ApiRequestContextLike,
	ApiResponseLike,
	FileReleaseDetailResponse,
	FileReleaseDownloadUrlResponse,
	FileReleaseListResponse,
	NoticeDetailResponse,
	NoticeListResponse,
	NoticeMetadataResponse,
} from "./types.js";

export interface FetchNoticePageInput {
	apiContext: ApiRequestContextLike;
	currentPage: number;
	startDate: string;
	endDate?: string;
}

export interface FetchNoticeDetailInput {
	apiContext: ApiRequestContextLike;
	noticeId: number;
}

const NOTICE_PAGE_SIZE = 20;
export const FILE_RELEASE_PAGE_SIZE = 50;

export interface FetchAttachmentBinaryInput {
	abortSignal?: AbortSignal;
	apiContext: ApiRequestContextLike;
	attachmentUrl: string;
	maxBytes?: number;
}

export interface FetchAttachmentBinaryResult extends TemporaryAttachmentFile {
	contentType: string | null;
	contentDisposition: string | null;
}

export class PortalHttpError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = "PortalHttpError";
		this.status = status;
	}
}

export interface FetchFileReleaseDetailInput {
	apiContext: ApiRequestContextLike;
	fileReleaseId: number;
}

export interface FetchFileReleaseDownloadUrlInput {
	apiContext: ApiRequestContextLike;
	fileReleaseId: number;
}

export interface FetchFileReleasePageInput {
	apiContext: ApiRequestContextLike;
	currentPage: number;
}

export async function fetchNoticePage(input: FetchNoticePageInput): Promise<NoticeListResponse> {
	const response = await input.apiContext.post("/comsys-portal-notice-web/getNoticeByPage", {
		form: {
			currentPage: String(input.currentPage),
			pageSize: String(NOTICE_PAGE_SIZE),
			searchValue: "",
			state: "",
			is_add: "0",
			totalCounts: "0",
			total: "-1",
			select_all: "false",
			select_notice: "",
			type: "",
			searchDepartment: "",
			start_date: input.startDate,
			end_date: input.endDate ?? "",
			new_total: "",
			comsys_random_t: String(Math.random()),
		},
	});
	if (!response.ok()) {
		await throwRequestError(response, "getNoticeByPage");
	}
	const json = await parseJsonResponse<NoticeListResponse>(response, "getNoticeByPage");
	assertNoticeListResponse(json);
	return json;
}

export async function fetchNoticeMetadata(input: {
	apiContext: ApiRequestContextLike;
}): Promise<NoticeMetadataResponse> {
	const response = await input.apiContext.post("/comsys-portal-notice-web/getNoticeSlects", {
		form: {},
	});
	if (!response.ok()) {
		await throwRequestError(response, "getNoticeSlects");
	}
	const json = await parseJsonResponse<NoticeMetadataResponse>(response, "getNoticeSlects");
	if (!(json.state && Array.isArray(json.datas?.type) && Array.isArray(json.datas.org))) {
		throw new Error("Internal portal notice metadata response is invalid.");
	}
	return json;
}

export async function fetchNoticeDetail(
	input: FetchNoticeDetailInput,
): Promise<NoticeDetailResponse> {
	const response = await input.apiContext.post("/comsys-portal-notice-web/getNotice", {
		form: {
			notice_id: String(input.noticeId),
			type: "",
			show_type: "1",
			searchValue: "",
			searchDepartment: "",
		},
	});
	if (!response.ok()) {
		await throwRequestError(response, "getNotice");
	}
	const json = await parseJsonResponse<NoticeDetailResponse>(response, "getNotice");
	if (!json.state) {
		// The portal confirms deletion/expiry/permission loss with a fixed message;
		// anything else keeps the generic rejection so transient causes stay retryable.
		const msg = json.msg ?? "";
		if (msg.includes("通知公告已删除") || msg.includes("通知公告已经失效")) {
			throw new PortalNoticeUnavailableError({
				message: `notice ${input.noticeId} is unavailable on the portal: ${msg}`,
				noticeId: input.noticeId,
			});
		}
		throw new Error("Internal portal notice detail request was rejected.");
	}
	return json;
}

export async function fetchAttachmentBinary(
	input: FetchAttachmentBinaryInput,
): Promise<FetchAttachmentBinaryResult> {
	const response = await input.apiContext.get(input.attachmentUrl);
	return await materializeAttachmentResponse({
		...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
		maxBytes: input.maxBytes ?? Number.MAX_SAFE_INTEGER,
		response,
	});
}

async function materializeAttachmentResponse(input: {
	abortSignal?: AbortSignal;
	maxBytes: number;
	response: ApiResponseLike;
}): Promise<FetchAttachmentBinaryResult> {
	const response = input.response;
	if (!response.ok()) {
		await throwRequestError(response, "downloadAttachment");
	}
	const contentLength = Number.parseInt(response.headers?.()["content-length"] ?? "", 10);
	if (Number.isSafeInteger(contentLength) && contentLength > input.maxBytes) {
		await cancelResponseBody(response, "attachment size limit exceeded");
		throw new Error("Attachment size exceeds the configured limit.");
	}
	const bodyStream = response.bodyStream?.();
	if (!bodyStream) {
		await cancelResponseBody(response, "attachment body stream unavailable");
		throw new Error("downloadAttachment response body stream is unavailable");
	}
	let temporaryFile: TemporaryAttachmentFile;
	try {
		temporaryFile = await spoolAttachmentToTemporaryFile({
			...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
			body: bodyStream,
			maxBytes: input.maxBytes,
			sizeLimitError: () => new Error("Attachment size exceeds the configured limit."),
		});
	} catch (error) {
		await cancelResponseBody(response, "attachment download failed");
		throw error;
	}
	let sessionInvalid: boolean;
	try {
		sessionInvalid = await containsSessionInvalidMarker(temporaryFile);
	} catch (error) {
		await temporaryFile.remove();
		throw error;
	}
	if (sessionInvalid) {
		await temporaryFile.remove();
		throw new PortalSessionExpiredError("downloadAttachment failed: session invalid");
	}
	return {
		...temporaryFile,
		contentType: normalizeHeaderValue(response.headers?.()["content-type"] ?? null),
		contentDisposition: normalizeHeaderValue(response.headers?.()["content-disposition"] ?? null),
	};
}

async function containsSessionInvalidMarker(file: TemporaryAttachmentFile): Promise<boolean> {
	if (file.byteSize > 4_096) {
		return false;
	}
	return (await readFile(file.filePath, "utf-8")).trim() === "error_comsys_session_invalid";
}

async function cancelResponseBody(response: ApiResponseLike, reason: string): Promise<void> {
	try {
		await response.cancelBody?.(reason);
	} catch {
		// The primary request error remains the actionable failure.
	}
}

export async function fetchFileReleaseDetail(
	input: FetchFileReleaseDetailInput,
): Promise<FileReleaseDetailResponse> {
	const response = await input.apiContext.post("/comsys-prompt-portlet-web/getFile", {
		form: {
			id: String(input.fileReleaseId),
		},
	});
	if (!response.ok()) {
		await throwRequestError(response, "getFile");
	}
	const json = await parseJsonResponse<FileReleaseDetailResponse>(response, "getFile");
	if (!(json.state === 1 || json.state === true)) {
		throw new Error("Internal portal file detail request was rejected.");
	}
	return json;
}

export async function fetchFileReleasePage(
	input: FetchFileReleasePageInput,
): Promise<FileReleaseListResponse> {
	const response = await input.apiContext.post("/comsys-prompt-portlet-web/pageFile", {
		form: {
			currentPage: String(input.currentPage),
			pageSize: String(FILE_RELEASE_PAGE_SIZE),
			searchValue: "",
			fileType: "",
			fileFileType: "",
			explainDept: "",
		},
	});
	if (!response.ok()) {
		await throwRequestError(response, "pageFile");
	}
	const json = await parseJsonResponse<FileReleaseListResponse>(response, "pageFile");
	if (
		!(
			(json.state === 1 || json.state === true) &&
			Array.isArray(json.datas?.tables) &&
			json.datas?.page
		)
	) {
		throw new Error("Internal portal file list response is invalid.");
	}
	return json;
}

export async function fetchFileReleaseDownloadUrl(
	input: FetchFileReleaseDownloadUrlInput,
): Promise<FileReleaseDownloadUrlResponse> {
	const response = await input.apiContext.post("/comsys-prompt-portlet-web/getFileUrl", {
		form: {
			id: String(input.fileReleaseId),
		},
	});
	if (!response.ok()) {
		await throwRequestError(response, "getFileUrl");
	}
	const json = await parseJsonResponse<FileReleaseDownloadUrlResponse>(response, "getFileUrl");
	if (!json.state) {
		throw new Error("Internal portal file download request was rejected.");
	}
	return json;
}

async function throwRequestError(response: ApiResponseLike, operation: string): Promise<never> {
	const status = response.status();
	const statusText = response.statusText();
	let body = "";
	try {
		body = (await response.text()).trim();
	} catch {
		// Keep the HTTP status as the primary error when the body cannot be read.
	}
	await cancelResponseBody(response, `${operation} request failed`);
	throw buildRequestError(status, statusText, body, operation);
}

function buildRequestError(
	status: number,
	statusText: string,
	body: string,
	operation: string,
): Error {
	if (status === 401 || status === 403) {
		return new PortalSessionExpiredError(
			`Internal portal ${portalOperationLabel(operation)} request failed: HTTP ${status} ${statusText}${body ? `: ${body}` : ""}`,
		);
	}
	return new PortalHttpError(
		`Internal portal ${portalOperationLabel(operation)} request failed: HTTP ${status} ${statusText}${body ? `: ${body}` : ""}`,
		status,
	);
}

async function parseJsonResponse<T extends object>(
	response: ApiResponseLike,
	operation: string,
): Promise<T> {
	const payload = (await response.text()).trim();
	if (payload === "error_comsys_session_invalid") {
		throw new PortalSessionExpiredError(`${operation} failed: session invalid`);
	}
	try {
		return JSON.parse(payload) as T;
	} catch {
		throw new Error(`Internal portal ${portalOperationLabel(operation)} returned invalid data.`);
	}
}

function portalOperationLabel(operation: string): string {
	switch (operation) {
		case "getNoticeByPage":
			return "notice list";
		case "getNotice":
			return "notice detail";
		case "getNoticeSlects":
			return "notice metadata";
		case "downloadAttachment":
			return "attachment download";
		case "getFile":
			return "file detail";
		case "getFileUrl":
			return "file download";
		default:
			return "portal";
	}
}

function normalizeHeaderValue(value: string | null): string | null {
	if (!value) {
		return null;
	}
	const trimmed = value.trim();
	return trimmed || null;
}

function assertNoticeListResponse(
	payload: NoticeListResponse,
): asserts payload is NoticeListResponse & { datas: { tables: Record<string, unknown>[] } } {
	if (!(payload.state && payload.datas && Array.isArray(payload.datas.tables))) {
		throw new Error("Internal portal notice list response is invalid.");
	}
}
