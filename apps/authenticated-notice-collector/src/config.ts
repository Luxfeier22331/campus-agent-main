import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface CollectorConfig {
  packageRoot: string;
  runtimeDir: string;
  authStorageStatePath: string;
  exportsDir: string;
  noticeTypesPath: string;
  portalBaseUrl: string;
  portalPageUrl: string;
  sourceHomeUrl: string;
  siteId: string;
  requestMaxRetries: number;
  requestBackoffBaseMs: number;
  authCheckNoticeType: string;
  authCheckPageSize: number;
}

export function loadCollectorEnv(): void {
  dotenv.config({ path: path.join(packageRoot, ".env") });
}

export function resolveCollectorConfig(source: NodeJS.ProcessEnv | Record<string, string | undefined>): CollectorConfig {
  const runtimeDir = path.resolve(
    String(source.AUTHENTICATED_NOTICE_RUNTIME_DIR || path.join(packageRoot, "runtime")),
  );
  const portalBaseUrl = String(source.AUTHENTICATED_NOTICE_BASE_URL || "https://my.muc.edu.cn").trim();
  return {
    packageRoot,
    runtimeDir,
    authStorageStatePath: path.join(runtimeDir, "auth", "storageState.json"),
    exportsDir: path.join(runtimeDir, "exports"),
    noticeTypesPath: path.resolve(
      String(source.AUTHENTICATED_NOTICE_NOTICE_TYPES_PATH || path.join(packageRoot, "config", "notice-types.json")),
    ),
    portalBaseUrl,
    portalPageUrl: String(source.AUTHENTICATED_NOTICE_PAGE_URL || "https://my.muc.edu.cn/page/11#/").trim(),
    sourceHomeUrl: String(source.AUTHENTICATED_NOTICE_SOURCE_HOME_URL || portalBaseUrl).trim(),
    siteId: String(source.AUTHENTICATED_NOTICE_SITE_ID || "muc_internal_portal").trim() || "muc_internal_portal",
    requestMaxRetries: parsePositiveInteger(source.AUTHENTICATED_NOTICE_REQUEST_MAX_RETRIES, 3),
    requestBackoffBaseMs: parsePositiveInteger(source.AUTHENTICATED_NOTICE_REQUEST_BACKOFF_BASE_MS, 1200),
    authCheckNoticeType: String(source.AUTHENTICATED_NOTICE_AUTH_CHECK_NOTICE_TYPE || "5").trim() || "5",
    authCheckPageSize: parsePositiveInteger(source.AUTHENTICATED_NOTICE_AUTH_CHECK_PAGE_SIZE, 3),
  };
}

export function ensureRuntimeDirs(config: CollectorConfig): void {
  for (const relativePath of ["auth", "raw", "logs", "exports", "blob-store"]) {
    fs.mkdirSync(path.join(config.runtimeDir, relativePath), { recursive: true });
  }
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw || "");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}
