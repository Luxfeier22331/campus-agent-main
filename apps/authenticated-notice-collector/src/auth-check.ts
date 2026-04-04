import { createApiContextFromStorageState } from "./portal";
import { fetchNoticePage } from "./api";
import { loadCollectorEnv, resolveCollectorConfig } from "./config";
import type { ApiRequestContextLike, DisposableApiContextLike, NoticeListResponse } from "./types";

export interface AuthCheckResult {
  ok: boolean;
  sampleCount: number;
  firstNoticeId: number | null;
  firstTitle: string | null;
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
}

export async function checkAuth(dependencies?: AuthCheckDependencies): Promise<AuthCheckResult> {
  const config = resolveCollectorConfig(process.env);
  const createApiContext =
    dependencies?.createApiContext ??
    (() => createApiContextFromStorageState(config));
  const apiContext = await createApiContext();
  try {
    const response = await (dependencies?.fetchNoticePage ??
      ((input) =>
        fetchNoticePage({
          ...input,
          requestBackoffBaseMs: config.requestBackoffBaseMs,
          requestMaxRetries: config.requestMaxRetries,
        })))({
      apiContext,
      currentPage: 1,
      noticeType: dependencies?.authCheckNoticeType ?? config.authCheckNoticeType,
      pageSize: dependencies?.authCheckPageSize ?? config.authCheckPageSize,
    });
    const tables = response.datas?.tables ?? [];
    if (!response.state || tables.length === 0) {
      throw new Error(`auth check failed: ${JSON.stringify(response).slice(0, 500)}`);
    }
    return {
      ok: true,
      sampleCount: tables.length,
      firstNoticeId: tables[0]?.notice_id ?? null,
      firstTitle: tables[0]?.notice_title ?? null,
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
