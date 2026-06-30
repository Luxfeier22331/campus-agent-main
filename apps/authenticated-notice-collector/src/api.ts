import type {
	ApiRequestContextLike,
	ApiResponseLike,
	FileReleaseCodeTypeListResponse,
	FileReleaseDetailResponse,
	FileReleaseDownloadUrlResponse,
	FileReleaseExplainDepartmentListResponse,
	FileReleasePageResponse,
	FileReleaseTypeListResponse,
	NoticeDetailResponse,
	NoticeListResponse,
	NoticeSelectsResponse,
} from "./types.js";

export interface FetchNoticePageInput {
	apiContext: ApiRequestContextLike;
	noticeType: string;
	currentPage: number;
	pageSize: number;
}

export interface FetchNoticeSelectsInput {
	apiContext: ApiRequestContextLike;
	currentPage: number;
	pageSize: number;
}

export interface FetchNoticeDetailInput {
	apiContext: ApiRequestContextLike;
	noticeId: number;
	noticeType: string;
	showType?: string;
	searchValue?: string;
	searchDepartment?: string;
}

export interface FetchAttachmentBinaryInput {
	apiContext: ApiRequestContextLike;
	attachmentUrl: string;
}

export interface FetchAttachmentBinaryResult {
	body: Buffer;
	contentType: string | null;
	contentDisposition: string | null;
	etag: string | null;
	statusCode: number;
}

export type AttachmentTerminalReason = "http_404" | "http_410" | "portal_file_missing";

export class AttachmentDownloadTerminalUnavailableError extends Error {
	readonly lastHttpStatus: number;
	readonly terminalReason: AttachmentTerminalReason;

	constructor(input: {
		lastHttpStatus: number;
		message: string;
		terminalReason: AttachmentTerminalReason;
	}) {
		super(input.message);
		this.name = "AttachmentDownloadTerminalUnavailableError";
		this.lastHttpStatus = input.lastHttpStatus;
		this.terminalReason = input.terminalReason;
	}
}

export function isAttachmentDownloadTerminalUnavailableError(
	error: unknown,
): error is AttachmentDownloadTerminalUnavailableError {
	return error instanceof AttachmentDownloadTerminalUnavailableError;
}

export interface FetchFileReleasePageInput {
	apiContext: ApiRequestContextLike;
	currentPage: number;
	pageSize: number;
}

export interface FetchFileReleaseDetailInput {
	apiContext: ApiRequestContextLike;
	fileReleaseId: number;
}

export interface FetchFileReleaseDownloadUrlInput {
	apiContext: ApiRequestContextLike;
	fileReleaseId: number;
}

export interface FetchFileReleaseTypesInput {
	apiContext: ApiRequestContextLike;
}

export interface FetchFileReleaseExplainDepartmentsInput {
	apiContext: ApiRequestContextLike;
}

export interface FetchFileReleaseCodeTypesInput {
	apiContext: ApiRequestContextLike;
}

export async function fetchNoticePage(input: FetchNoticePageInput): Promise<NoticeListResponse> {
	const response = await input.apiContext.post("/comsys-portal-notice-web/getNoticeByPage", {
		form: {
			currentPage: String(input.currentPage),
			pageSize: String(input.pageSize),
			searchValue: "",
			state: "",
			is_add: "0",
			totalCounts: "0",
			total: "-1",
			select_all: "false",
			select_notice: "",
			type: input.noticeType,
			searchDepartment: "",
			start_date: "",
			end_date: "",
			new_total: "",
			comsys_random_t: String(Math.random()),
		},
	});
	if (!response.ok()) {
		throw buildRequestError(response.status(), response.statusText(), "getNoticeByPage");
	}
	const json = await parseJsonResponse<NoticeListResponse>(response, "getNoticeByPage");
	assertNoticeListResponse(json);
	return json;
}

export async function fetchNoticeSelects(
	input: FetchNoticeSelectsInput,
): Promise<NoticeSelectsResponse> {
	const response = await input.apiContext.post("/comsys-portal-notice-web/getNoticeSlects", {
		form: {
			currentPage: String(input.currentPage),
			pageSize: String(input.pageSize),
			searchValue: "",
			state: "",
			is_add: "0",
			totalCounts: "0",
			total: "-1",
			select_all: "false",
			select_notice: "",
			type: "",
			searchDepartment: "",
			start_date: "",
			end_date: "",
			system_show: "1",
			comsys_random_t: String(Math.random()),
		},
	});
	if (!response.ok()) {
		throw buildRequestError(response.status(), response.statusText(), "getNoticeSlects");
	}
	const json = await parseJsonResponse<NoticeSelectsResponse>(response, "getNoticeSlects");
	assertNoticeSelectsResponse(json);
	return json;
}

export async function fetchNoticeDetail(
	input: FetchNoticeDetailInput,
): Promise<NoticeDetailResponse> {
	const response = await input.apiContext.post("/comsys-portal-notice-web/getNotice", {
		form: {
			notice_id: String(input.noticeId),
			type: input.noticeType,
			show_type: input.showType ?? "1",
			searchValue: input.searchValue ?? "",
			searchDepartment: input.searchDepartment ?? "",
		},
	});
	if (!response.ok()) {
		throw buildRequestError(response.status(), response.statusText(), "getNotice");
	}
	const json = await parseJsonResponse<NoticeDetailResponse>(response, "getNotice");
	if (!json.state) {
		throw new Error(`getNotice rejected: ${json.msg ?? "unknown error"}`);
	}
	return json;
}

export async function fetchAttachmentBinary(
	input: FetchAttachmentBinaryInput,
): Promise<FetchAttachmentBinaryResult> {
	const response = await input.apiContext.get(input.attachmentUrl);
	if (!response.ok()) {
		throw buildRequestError(response.status(), response.statusText(), "downloadAttachment");
	}
	const body = await readBinaryResponse(response, "downloadAttachment");
	const maybeSessionInvalid = body.toString("utf-8").trim();
	if (maybeSessionInvalid === "error_comsys_session_invalid") {
		throw new Error("auth-expired: downloadAttachment failed: session invalid");
	}
	return {
		body,
		contentType: normalizeHeaderValue(response.headers?.()["content-type"] ?? null),
		contentDisposition: normalizeHeaderValue(response.headers?.()["content-disposition"] ?? null),
		etag: normalizeHeaderValue(response.headers?.().etag ?? null),
		statusCode: response.status(),
	};
}

export async function fetchFileReleasePage(
	input: FetchFileReleasePageInput,
): Promise<FileReleasePageResponse> {
	const response = await input.apiContext.post("/comsys-prompt-portlet-web/pageFile", {
		form: {
			currentPage: String(input.currentPage),
			pageSize: String(input.pageSize),
			mng: "1",
			order: "name,time",
		},
	});
	if (!response.ok()) {
		throw buildRequestError(response.status(), response.statusText(), "pageFile");
	}
	const json = await parseJsonResponse<FileReleasePageResponse>(response, "pageFile");
	assertFileReleasePageResponse(json);
	return json;
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
		throw buildRequestError(response.status(), response.statusText(), "getFile");
	}
	const json = await parseJsonResponse<FileReleaseDetailResponse>(response, "getFile");
	if (!(json.state === 1 || json.state === true)) {
		throw new Error(`getFile rejected: ${JSON.stringify(json).slice(0, 200)}`);
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
		throw buildRequestError(response.status(), response.statusText(), "getFileUrl");
	}
	const json = await parseJsonResponse<FileReleaseDownloadUrlResponse>(response, "getFileUrl");
	if (!json.state) {
		throw new Error(`getFileUrl rejected: ${JSON.stringify(json).slice(0, 200)}`);
	}
	return json;
}

export async function fetchFileReleaseTypes(
	input: FetchFileReleaseTypesInput,
): Promise<FileReleaseTypeListResponse> {
	const response = await input.apiContext.post("/comsys-prompt-portlet-web/getFileType", {
		form: {},
	});
	if (!response.ok()) {
		throw buildRequestError(response.status(), response.statusText(), "getFileType");
	}
	const json = await parseJsonResponse<FileReleaseTypeListResponse>(response, "getFileType");
	assertFileReleaseTypeResponse(json);
	return json;
}

export async function fetchFileReleaseExplainDepartments(
	input: FetchFileReleaseExplainDepartmentsInput,
): Promise<FileReleaseExplainDepartmentListResponse> {
	const response = await input.apiContext.post("/comsys-prompt-portlet-web/getExplainDepts", {
		form: {
			comsys_random_t: String(Math.random()),
		},
	});
	if (!response.ok()) {
		throw buildRequestError(response.status(), response.statusText(), "getExplainDepts");
	}
	const json = await parseJsonResponse<FileReleaseExplainDepartmentListResponse>(
		response,
		"getExplainDepts",
	);
	assertFileReleaseExplainDepartmentResponse(json);
	return json;
}

export async function fetchFileReleaseCodeTypes(
	input: FetchFileReleaseCodeTypesInput,
): Promise<FileReleaseCodeTypeListResponse> {
	const response = await input.apiContext.post("/comsys-prompt-portlet-web/getFileFileType", {
		form: {
			name: "",
			comsys_random_t: String(Math.random()),
		},
	});
	if (!response.ok()) {
		throw buildRequestError(response.status(), response.statusText(), "getFileFileType");
	}
	const json = await parseJsonResponse<FileReleaseCodeTypeListResponse>(
		response,
		"getFileFileType",
	);
	assertFileReleaseCodeTypeResponse(json);
	return json;
}

function buildRequestError(status: number, statusText: string, operation: string): Error {
	if (status === 401 || status === 403) {
		return new Error(`auth-expired: ${operation} failed: ${status} ${statusText}`);
	}
	if (operation === "downloadAttachment") {
		const terminalReason = terminalReasonForHttpStatus(status);
		if (terminalReason) {
			return new AttachmentDownloadTerminalUnavailableError({
				lastHttpStatus: status,
				message: `${operation} failed: ${status} ${statusText}`,
				terminalReason,
			});
		}
	}
	if (status === 429 || status >= 500) {
		return new Error(`retryable: ${operation} failed: ${status} ${statusText}`);
	}
	return new Error(`${operation} failed: ${status} ${statusText}`);
}

function terminalReasonForHttpStatus(status: number): AttachmentTerminalReason | null {
	if (status === 404) {
		return "http_404";
	}
	if (status === 410) {
		return "http_410";
	}
	return null;
}

async function parseJsonResponse<T extends object>(
	response: ApiResponseLike,
	operation: string,
): Promise<T> {
	if (typeof response.text === "function") {
		const payload = (await response.text()).trim();
		if (payload === "error_comsys_session_invalid") {
			throw new Error(`auth-expired: ${operation} failed: session invalid`);
		}
		try {
			return JSON.parse(payload) as T;
		} catch {
			throw new Error(`${operation} returned non-JSON payload: ${payload.slice(0, 200)}`);
		}
	}
	return (await response.json()) as T;
}

async function readBinaryResponse(response: ApiResponseLike, _operation: string): Promise<Buffer> {
	if (typeof response.body === "function") {
		return Buffer.from(await response.body());
	}
	if (typeof response.text === "function") {
		return Buffer.from(await response.text(), "utf-8");
	}
	const payload = await response.json();
	return Buffer.from(JSON.stringify(payload), "utf-8");
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
		throw new Error(`unexpected notice response: ${JSON.stringify(payload).slice(0, 400)}`);
	}
}

function assertNoticeSelectsResponse(
	payload: NoticeSelectsResponse,
): asserts payload is NoticeSelectsResponse & {
	datas: {
		org: Record<string, unknown>[];
		type: Record<string, unknown>[];
	};
} {
	if (
		!(
			payload.state &&
			payload.datas &&
			Array.isArray(payload.datas.org) &&
			Array.isArray(payload.datas.type)
		)
	) {
		throw new Error(`unexpected notice selects response: ${JSON.stringify(payload).slice(0, 400)}`);
	}
}

function assertFileReleasePageResponse(
	payload: FileReleasePageResponse,
): asserts payload is FileReleasePageResponse & { data: Record<string, unknown>[] } {
	if (!(payload.state && Array.isArray(payload.data))) {
		throw new Error(
			`unexpected file release page response: ${JSON.stringify(payload).slice(0, 400)}`,
		);
	}
}

function assertFileReleaseTypeResponse(
	payload: FileReleaseTypeListResponse,
): asserts payload is FileReleaseTypeListResponse & { data: Record<string, unknown>[] } {
	if (!(payload.state && Array.isArray(payload.data))) {
		throw new Error(
			`unexpected file release type response: ${JSON.stringify(payload).slice(0, 400)}`,
		);
	}
}

function assertFileReleaseExplainDepartmentResponse(
	payload: FileReleaseExplainDepartmentListResponse,
): asserts payload is FileReleaseExplainDepartmentListResponse & {
	data: Record<string, unknown>[];
} {
	if (!(payload.state && Array.isArray(payload.data))) {
		throw new Error(
			`unexpected file release explain department response: ${JSON.stringify(payload).slice(0, 400)}`,
		);
	}
}

function assertFileReleaseCodeTypeResponse(
	payload: FileReleaseCodeTypeListResponse,
): asserts payload is FileReleaseCodeTypeListResponse & { data: Record<string, unknown>[] } {
	if (!(payload.state && Array.isArray(payload.data))) {
		throw new Error(
			`unexpected file release code type response: ${JSON.stringify(payload).slice(0, 400)}`,
		);
	}
}
