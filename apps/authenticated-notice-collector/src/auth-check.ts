import { createApiContextFromStorageState } from "./portal";
import { fetchFileReleasePage, fetchNoticePage } from "./api";
import { loadCollectorEnv, resolveCollectorConfig } from "./config";
import type {
  ApiRequestContextLike,
  DisposableApiContextLike,
  FileReleasePageResponse,
  NoticeListResponse,
} from "./types";

export interface AuthCheckNoticeSummary {
  sampleCount: number;
  firstNoticeId: number | null;
  firstTitle: string | null;
}

export interface AuthCheckFileReleaseSummary {
  sampleCount: number;
  firstFileReleaseId: number | null;
  firstFilename: string | null;
  firstFileTypeName: string | null;
}

export interface AuthCheckResult {
  ok: boolean;
  notice: AuthCheckNoticeSummary;
  fileRelease: AuthCheckFileReleaseSummary;
}

export interface AuthCheckDependencies {
  authCheckNoticeType: string;
  authCheckPageSize: number;
  createApiContext: () => Promise<ApiRequestContextLike & DisposableApiContextLike>;
  fetchNoticePage: (input: {
    apiContext: ApiRequestContextLike;
    noticeType: string;
    currentPage: number;
    pageSize: number;
  }) => Promise<NoticeListResponse>;
  fetchFileReleasePage: (input: {
    apiContext: ApiRequestContextLike;
    currentPage: number;
    pageSize: number;
  }) => Promise<FileReleasePageResponse>;
}

export async function checkAuth(dependencies?: AuthCheckDependencies): Promise<AuthCheckResult> {
  const config = resolveCollectorConfig(process.env);
  const createApiContext =
    dependencies?.createApiContext ??
    (() => createApiContextFromStorageState(config));
  const apiContext = await createApiContext();
  try {
    const checkNoticePage =
      dependencies?.fetchNoticePage ??
      ((input) =>
        fetchNoticePage({
          ...input,
          requestBackoffBaseMs: config.requestBackoffBaseMs,
          requestMaxRetries: config.requestMaxRetries,
        }));
    const checkFileReleasePage =
      dependencies?.fetchFileReleasePage ??
      ((input) =>
        fetchFileReleasePage({
          ...input,
          requestBackoffBaseMs: config.requestBackoffBaseMs,
          requestMaxRetries: config.requestMaxRetries,
        }));
    const noticeResponse = await checkNoticePage({
      apiContext,
      currentPage: 1,
      noticeType: dependencies?.authCheckNoticeType ?? config.authCheckNoticeType,
      pageSize: dependencies?.authCheckPageSize ?? config.authCheckPageSize,
    });
    const noticeRows = noticeResponse.datas?.tables ?? [];
    if (!noticeResponse.state || noticeRows.length === 0) {
      throw new Error(`auth check failed: notice surface unavailable: ${JSON.stringify(noticeResponse).slice(0, 500)}`);
    }
    const fileReleaseResponse = await checkFileReleasePage({
      apiContext,
      currentPage: 1,
      pageSize: dependencies?.authCheckPageSize ?? config.authCheckPageSize,
    });
    const fileReleaseRows = fileReleaseResponse.data ?? [];
    if (!fileReleaseResponse.state || fileReleaseRows.length === 0) {
      throw new Error(
        `auth check failed: file_release surface unavailable: ${JSON.stringify(fileReleaseResponse).slice(0, 500)}`,
      );
    }
    return {
      ok: true,
      notice: {
        sampleCount: noticeRows.length,
        firstNoticeId: noticeRows[0]?.notice_id ?? null,
        firstTitle: noticeRows[0]?.notice_title ?? null,
      },
      fileRelease: {
        sampleCount: fileReleaseRows.length,
        firstFileReleaseId: normalizeNumericId(fileReleaseRows[0]?.id),
        firstFilename: normalizeNullableText(fileReleaseRows[0]?.filename),
        firstFileTypeName: normalizeNullableText(fileReleaseRows[0]?.typename),
      },
    };
  } finally {
    await apiContext.dispose();
  }
}

export async function main(): Promise<void> {
  loadCollectorEnv();
  const result = await checkAuth();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function normalizeNumericId(raw: number | string | null | undefined): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeNullableText(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}
