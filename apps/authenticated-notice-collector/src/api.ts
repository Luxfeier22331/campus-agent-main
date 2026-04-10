import type { ApiRequestContextLike, ApiResponseLike, NoticeDetailResponse, NoticeListResponse } from "./types";

export interface FetchNoticePageInput {
  apiContext: ApiRequestContextLike;
  noticeType: string;
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
        throw buildRequestError(
          response.status(),
          response.statusText(),
          "getNoticeByPage",
        );
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

export async function fetchNoticeDetail(input: FetchNoticeDetailInput): Promise<NoticeDetailResponse> {
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

function assertNoticeListResponse(
  payload: NoticeListResponse,
): asserts payload is NoticeListResponse & { datas: { tables: Array<Record<string, unknown>> } } {
  if (!payload.state || !payload.datas || !Array.isArray(payload.datas.tables)) {
    throw new Error(`unexpected notice response: ${JSON.stringify(payload).slice(0, 400)}`);
  }
}
