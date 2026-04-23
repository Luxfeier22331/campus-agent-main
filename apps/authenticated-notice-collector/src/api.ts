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
} from "./types";

export interface FetchNoticePageInput {
	apiContext: ApiRequestContextLike;
	noticeType: string;
	currentPage: number;
	pageSize: number;
	requestMaxRetries: number;
	requestBackoffBaseMs: number;
	sleep?: (ms: number) => Promise<void>;
}

export interface FetchNoticeSelectsInput {
	apiContext: ApiRequestContextLike;
	currentPage: number;
	pageSize: number;
	requestMaxRetries: number;
	requestBackoffBaseMs: number;
	sleep?: (ms: number) => Promise<void>;
}

export interface FetchNoticeDetailInput {
	apiContext: ApiRequestContextLike;
	noticeId: number;
	noticeType: string;
	requestMaxRetries: number;
	requestBackoffBaseMs: number;
	showType?: string;
	searchValue?: string;
	searchDepartment?: string;
	sleep?: (ms: number) => Promise<void>;
}

export interface FetchAttachmentBinaryInput {
	apiContext: ApiRequestContextLike;
	attachmentUrl: string;
	requestMaxRetries: number;
	requestBackoffBaseMs: number;
	sleep?: (ms: number) => Promise<void>;
}

export interface FetchAttachmentBinaryResult {
	body: Buffer;
	contentType: string | null;
	contentDisposition: string | null;
	etag: string | null;
	statusCode: number;
}

export interface FetchFileReleasePageInput {
	apiContext: ApiRequestContextLike;
	currentPage: number;
	pageSize: number;
	requestMaxRetries: number;
	requestBackoffBaseMs: number;
	sleep?: (ms: number) => Promise<void>;
}

export interface FetchFileReleaseDetailInput {
	apiContext: ApiRequestContextLike;
	fileReleaseId: number;
	requestMaxRetries: number;
	requestBackoffBaseMs: number;
	sleep?: (ms: number) => Promise<void>;
}

export interface FetchFileReleaseDownloadUrlInput {
	apiContext: ApiRequestContextLike;
	fileReleaseId: number;
	requestMaxRetries: number;
	requestBackoffBaseMs: number;
	sleep?: (ms: number) => Promise<void>;
}

export interface FetchFileReleaseTypesInput {
	apiContext: ApiRequestContextLike;
	requestMaxRetries: number;
	requestBackoffBaseMs: number;
	sleep?: (ms: number) => Promise<void>;
}

export interface FetchFileReleaseExplainDepartmentsInput {
	apiContext: ApiRequestContextLike;
	requestMaxRetries: number;
	requestBackoffBaseMs: number;
	sleep?: (ms: number) => Promise<void>;
}

export interface FetchFileReleaseCodeTypesInput {
	apiContext: ApiRequestContextLike;
	requestMaxRetries: number;
	requestBackoffBaseMs: number;
	sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = async (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

export async function fetchNoticePage(input: FetchNoticePageInput): Promise<NoticeListResponse> {
	let lastError: Error | null = null;
	for (let attempt = 1; attempt <= input.requestMaxRetries; attempt += 1) {
		try {
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
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			if (lastError.message.startsWith("auth-expired:")) {
				throw lastError;
			}
			if (attempt >= input.requestMaxRetries) {
				throw lastError;
			}
			await (input.sleep ?? defaultSleep)(backoffDelayMs(input.requestBackoffBaseMs, attempt));
		}
	}
	throw lastError ?? new Error("fetchNoticePage failed with unknown error");
}

export async function fetchNoticeSelects(
	input: FetchNoticeSelectsInput,
): Promise<NoticeSelectsResponse> {
	let lastError: Error | null = null;
	for (let attempt = 1; attempt <= input.requestMaxRetries; attempt += 1) {
		try {
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
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			if (lastError.message.startsWith("auth-expired:")) {
				throw lastError;
			}
			if (attempt >= input.requestMaxRetries) {
				throw lastError;
			}
			await (input.sleep ?? defaultSleep)(backoffDelayMs(input.requestBackoffBaseMs, attempt));
		}
	}
	throw lastError ?? new Error("fetchNoticeSelects failed with unknown error");
}

export async function fetchNoticeDetail(
	input: FetchNoticeDetailInput,
): Promise<NoticeDetailResponse> {
	let lastError: Error | null = null;
	for (let attempt = 1; attempt <= input.requestMaxRetries; attempt += 1) {
		try {
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
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			if (lastError.message.startsWith("auth-expired:")) {
				throw lastError;
			}
			if (attempt >= input.requestMaxRetries) {
				throw lastError;
			}
			await (input.sleep ?? defaultSleep)(backoffDelayMs(input.requestBackoffBaseMs, attempt));
		}
	}
	throw lastError ?? new Error("fetchNoticeDetail failed with unknown error");
}

export async function fetchAttachmentBinary(
	input: FetchAttachmentBinaryInput,
): Promise<FetchAttachmentBinaryResult> {
	let lastError: Error | null = null;
	for (let attempt = 1; attempt <= input.requestMaxRetries; attempt += 1) {
		try {
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
				contentDisposition: normalizeHeaderValue(
					response.headers?.()["content-disposition"] ?? null,
				),
				etag: normalizeHeaderValue(response.headers?.().etag ?? null),
				statusCode: response.status(),
			};
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			if (lastError.message.startsWith("auth-expired:")) {
				throw lastError;
			}
			if (attempt >= input.requestMaxRetries) {
				throw lastError;
			}
			await (input.sleep ?? defaultSleep)(backoffDelayMs(input.requestBackoffBaseMs, attempt));
		}
	}
	throw lastError ?? new Error("fetchAttachmentBinary failed with unknown error");
}

export async function fetchFileReleasePage(
	input: FetchFileReleasePageInput,
): Promise<FileReleasePageResponse> {
	return await retryPortalRequest({
		requestBackoffBaseMs: input.requestBackoffBaseMs,
		requestMaxRetries: input.requestMaxRetries,
		sleep: input.sleep,
		task: async () => {
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
		},
	});
}

export async function fetchFileReleaseDetail(
	input: FetchFileReleaseDetailInput,
): Promise<FileReleaseDetailResponse> {
	return await retryPortalRequest({
		requestBackoffBaseMs: input.requestBackoffBaseMs,
		requestMaxRetries: input.requestMaxRetries,
		sleep: input.sleep,
		task: async () => {
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
		},
	});
}

export async function fetchFileReleaseDownloadUrl(
	input: FetchFileReleaseDownloadUrlInput,
): Promise<FileReleaseDownloadUrlResponse> {
	return await retryPortalRequest({
		requestBackoffBaseMs: input.requestBackoffBaseMs,
		requestMaxRetries: input.requestMaxRetries,
		sleep: input.sleep,
		task: async () => {
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
		},
	});
}

export async function fetchFileReleaseTypes(
	input: FetchFileReleaseTypesInput,
): Promise<FileReleaseTypeListResponse> {
	return await retryPortalRequest({
		requestBackoffBaseMs: input.requestBackoffBaseMs,
		requestMaxRetries: input.requestMaxRetries,
		sleep: input.sleep,
		task: async () => {
			const response = await input.apiContext.post("/comsys-prompt-portlet-web/getFileType", {
				form: {},
			});
			if (!response.ok()) {
				throw buildRequestError(response.status(), response.statusText(), "getFileType");
			}
			const json = await parseJsonResponse<FileReleaseTypeListResponse>(response, "getFileType");
			assertFileReleaseTypeResponse(json);
			return json;
		},
	});
}

export async function fetchFileReleaseExplainDepartments(
	input: FetchFileReleaseExplainDepartmentsInput,
): Promise<FileReleaseExplainDepartmentListResponse> {
	return await retryPortalRequest({
		requestBackoffBaseMs: input.requestBackoffBaseMs,
		requestMaxRetries: input.requestMaxRetries,
		sleep: input.sleep,
		task: async () => {
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
		},
	});
}

export async function fetchFileReleaseCodeTypes(
	input: FetchFileReleaseCodeTypesInput,
): Promise<FileReleaseCodeTypeListResponse> {
	return await retryPortalRequest({
		requestBackoffBaseMs: input.requestBackoffBaseMs,
		requestMaxRetries: input.requestMaxRetries,
		sleep: input.sleep,
		task: async () => {
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
		},
	});
}

async function retryPortalRequest<T>(input: {
	task: () => Promise<T>;
	requestMaxRetries: number;
	requestBackoffBaseMs: number;
	sleep?: (ms: number) => Promise<void>;
}): Promise<T> {
	let lastError: Error | null = null;
	for (let attempt = 1; attempt <= input.requestMaxRetries; attempt += 1) {
		try {
			return await input.task();
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			if (lastError.message.startsWith("auth-expired:")) {
				throw lastError;
			}
			if (attempt >= input.requestMaxRetries) {
				throw lastError;
			}
			await (input.sleep ?? defaultSleep)(backoffDelayMs(input.requestBackoffBaseMs, attempt));
		}
	}
	throw lastError ?? new Error("portal request failed with unknown error");
}

function buildRequestError(status: number, statusText: string, operation: string): Error {
	if (status === 401 || status === 403) {
		return new Error(`auth-expired: ${operation} failed: ${status} ${statusText}`);
	}
	if (status === 429 || status >= 500) {
		return new Error(`retryable: ${operation} failed: ${status} ${statusText}`);
	}
	return new Error(`${operation} failed: ${status} ${statusText}`);
}

function backoffDelayMs(baseMs: number, attempt: number): number {
	return baseMs * attempt;
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
): asserts payload is NoticeListResponse & { datas: { tables: Array<Record<string, unknown>> } } {
	if (!(payload.state && payload.datas && Array.isArray(payload.datas.tables))) {
		throw new Error(`unexpected notice response: ${JSON.stringify(payload).slice(0, 400)}`);
	}
}

function assertNoticeSelectsResponse(
	payload: NoticeSelectsResponse,
): asserts payload is NoticeSelectsResponse & {
	datas: {
		org: Array<Record<string, unknown>>;
		type: Array<Record<string, unknown>>;
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
): asserts payload is FileReleasePageResponse & { data: Array<Record<string, unknown>> } {
	if (!(payload.state && Array.isArray(payload.data))) {
		throw new Error(
			`unexpected file release page response: ${JSON.stringify(payload).slice(0, 400)}`,
		);
	}
}

function assertFileReleaseTypeResponse(
	payload: FileReleaseTypeListResponse,
): asserts payload is FileReleaseTypeListResponse & { data: Array<Record<string, unknown>> } {
	if (!(payload.state && Array.isArray(payload.data))) {
		throw new Error(
			`unexpected file release type response: ${JSON.stringify(payload).slice(0, 400)}`,
		);
	}
}

function assertFileReleaseExplainDepartmentResponse(
	payload: FileReleaseExplainDepartmentListResponse,
): asserts payload is FileReleaseExplainDepartmentListResponse & {
	data: Array<Record<string, unknown>>;
} {
	if (!(payload.state && Array.isArray(payload.data))) {
		throw new Error(
			`unexpected file release explain department response: ${JSON.stringify(payload).slice(0, 400)}`,
		);
	}
}

function assertFileReleaseCodeTypeResponse(
	payload: FileReleaseCodeTypeListResponse,
): asserts payload is FileReleaseCodeTypeListResponse & { data: Array<Record<string, unknown>> } {
	if (!(payload.state && Array.isArray(payload.data))) {
		throw new Error(
			`unexpected file release code type response: ${JSON.stringify(payload).slice(0, 400)}`,
		);
	}
}
