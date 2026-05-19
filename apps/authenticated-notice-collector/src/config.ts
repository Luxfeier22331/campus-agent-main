import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type { NoticeCollectionMode } from "./types.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const REQUIRED_NO_PROXY_HOSTS = ["muc.edu.cn", ".muc.edu.cn", "my.muc.edu.cn", "ca.muc.edu.cn"];

export interface CollectorConfig {
	packageRoot: string;
	repoRoot: string;
	runtimeDir: string;
	attachmentFetchRequestManifestPath: string | null;
	attachmentFetchStatusDatabaseUrl: string | null;
	attachmentFetchStatusDisabled: boolean;
	defaultInlineVisualCapture: boolean;
	authStorageStatePath: string;
	authJsessionId: string | null;
	authNginxCookie: string | null;
	authSsoTgcToken: string | null;
	collectionMode: NoticeCollectionMode;
	collectorRunLedgerDatabaseUrl: string | null;
	collectorRunLedgerDisabled: boolean;
	collectorRunLeaseDatabaseUrl: string | null;
	collectorRunLeaseDisabled: boolean;
	collectorRunLeaseTtlSeconds: number;
	ingestQueueEnqueueOnSuccess: boolean;
	ingestQueueEnqueueOutputDir: string | null;
	exportsDir: string;
	historicalBackfillMaxPagesPerType: number | null;
	noticeTypeAllowlist: string[] | null;
	noticeTypesPath: string;
	portalBaseUrl: string;
	portalPageUrl: string;
	sourceHomeUrl: string;
	siteId: string;
	writeLocalExports: boolean;
	requestMaxRetries: number;
	requestBackoffBaseMs: number;
	authCheckNoticeType: string;
	authCheckPageSize: number;
	bypassProxyForPortal: boolean;
	portalProxyServer: string | null;
}

export function loadCollectorEnv(): void {
	dotenv.config({ path: path.join(repoRoot, ".env") });
	dotenv.config({ path: path.join(packageRoot, ".env"), override: true });
	applyCollectorNoProxyEnv(process.env);
}

export function applyCollectorNoProxyEnv(target: NodeJS.ProcessEnv): void {
	const raw = target.NO_PROXY ?? target.no_proxy;
	const merged = shouldBypassProxyForPortal(target.AUTHENTICATED_NOTICE_BYPASS_PROXY)
		? mergeNoProxyValue(raw)
		: removePortalNoProxyHosts(raw);
	target.NO_PROXY = merged;
	target.no_proxy = merged;
}

export function resolveCollectorConfig(
	source: NodeJS.ProcessEnv | Record<string, string | undefined>,
): CollectorConfig {
	const runtimeDir = path.resolve(
		String(source.AUTHENTICATED_NOTICE_RUNTIME_DIR || path.join(packageRoot, "runtime")),
	);
	const portalBaseUrl = String(
		source.AUTHENTICATED_NOTICE_BASE_URL || "https://my.muc.edu.cn",
	).trim();
	const bypassProxyForPortal = shouldBypassProxyForPortal(source.AUTHENTICATED_NOTICE_BYPASS_PROXY);
	return {
		packageRoot,
		repoRoot,
		runtimeDir,
		attachmentFetchRequestManifestPath: normalizeOptionalPath(
			source.AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_REQUEST_MANIFEST_PATH,
		),
		attachmentFetchStatusDatabaseUrl: normalizeOptionalSecret(
			source.AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_STATUS_DATABASE_URL,
		),
		attachmentFetchStatusDisabled: parseBooleanFlag(
			source.AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_STATUS_DISABLE,
			false,
		),
		defaultInlineVisualCapture: parseBooleanFlag(
			source.AUTHENTICATED_NOTICE_DEFAULT_INLINE_VISUAL_CAPTURE,
			false,
		),
		authStorageStatePath: path.join(runtimeDir, "auth", "storageState.json"),
		authJsessionId: normalizeOptionalSecret(source.AUTHENTICATED_NOTICE_JSESSIONID),
		authNginxCookie: normalizeOptionalSecret(source.AUTHENTICATED_NOTICE_NGINX),
		authSsoTgcToken: normalizeOptionalSecret(source.AUTHENTICATED_NOTICE_SSO_TGC),
		collectionMode: parseCollectionMode(source.AUTHENTICATED_NOTICE_COLLECTION_MODE),
		collectorRunLedgerDatabaseUrl: normalizeOptionalSecret(
			source.AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DATABASE_URL,
		),
		collectorRunLedgerDisabled: parseBooleanFlag(
			source.AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DISABLE,
			false,
		),
		collectorRunLeaseDatabaseUrl: normalizeOptionalSecret(
			source.AUTHENTICATED_NOTICE_COLLECTOR_LEASE_DATABASE_URL,
		),
		collectorRunLeaseDisabled: parseBooleanFlag(
			source.AUTHENTICATED_NOTICE_COLLECTOR_LEASE_DISABLE,
			false,
		),
		collectorRunLeaseTtlSeconds: parsePositiveInteger(
			source.AUTHENTICATED_NOTICE_COLLECTOR_LEASE_TTL_SECONDS,
			3600,
		),
		ingestQueueEnqueueOnSuccess: parseBooleanFlag(
			source.AUTHENTICATED_NOTICE_INGEST_QUEUE_ENQUEUE_ON_SUCCESS,
			false,
		),
		ingestQueueEnqueueOutputDir: normalizeOptionalPath(
			source.AUTHENTICATED_NOTICE_INGEST_QUEUE_ENQUEUE_OUTPUT_DIR,
		),
		exportsDir: path.join(runtimeDir, "exports"),
		historicalBackfillMaxPagesPerType: parseOptionalPositiveInteger(
			source.AUTHENTICATED_NOTICE_HISTORICAL_BACKFILL_MAX_PAGES_PER_TYPE,
		),
		noticeTypeAllowlist: parseOptionalStringList(source.AUTHENTICATED_NOTICE_NOTICE_TYPE_ALLOWLIST),
		noticeTypesPath: path.resolve(
			String(
				source.AUTHENTICATED_NOTICE_NOTICE_TYPES_PATH ||
					path.join(packageRoot, "config", "notice-types.json"),
			),
		),
		portalBaseUrl,
		portalPageUrl: String(
			source.AUTHENTICATED_NOTICE_PAGE_URL || "https://my.muc.edu.cn/page/11#/",
		).trim(),
		sourceHomeUrl: String(source.AUTHENTICATED_NOTICE_SOURCE_HOME_URL || portalBaseUrl).trim(),
		siteId:
			String(source.AUTHENTICATED_NOTICE_SITE_ID || "muc_internal_portal").trim() ||
			"muc_internal_portal",
		writeLocalExports: parseBooleanFlag(source.AUTHENTICATED_NOTICE_WRITE_LOCAL_EXPORTS, false),
		requestMaxRetries: parsePositiveInteger(source.AUTHENTICATED_NOTICE_REQUEST_MAX_RETRIES, 3),
		requestBackoffBaseMs: parsePositiveInteger(
			source.AUTHENTICATED_NOTICE_REQUEST_BACKOFF_BASE_MS,
			1200,
		),
		authCheckNoticeType:
			String(source.AUTHENTICATED_NOTICE_AUTH_CHECK_NOTICE_TYPE || "5").trim() || "5",
		authCheckPageSize: parsePositiveInteger(source.AUTHENTICATED_NOTICE_AUTH_CHECK_PAGE_SIZE, 3),
		bypassProxyForPortal,
		portalProxyServer: resolvePortalProxyServer(source, bypassProxyForPortal),
	};
}

function parseOptionalStringList(raw: string | undefined): string[] | null {
	const tokens = [
		...new Set(
			(raw ?? "")
				.split(",")
				.map((token) => token.trim())
				.filter(Boolean),
		),
	];
	return tokens.length > 0 ? tokens : null;
}

function normalizeOptionalSecret(raw: string | undefined): string | null {
	const normalized = String(raw ?? "").trim();
	return normalized ? normalized : null;
}

function normalizeOptionalPath(raw: string | undefined): string | null {
	const normalized = String(raw ?? "").trim();
	return normalized ? path.resolve(normalized) : null;
}

export function ensureRuntimeDirs(config: CollectorConfig): void {
	for (const relativePath of ["auth", "raw", "logs", "exports", "blob-store"]) {
		fs.mkdirSync(path.join(config.runtimeDir, relativePath), { recursive: true });
	}
}

function parsePositiveInteger(raw: string | undefined, defaultValue: number): number {
	const parsed = Number(raw || "");
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return defaultValue;
	}
	return Math.floor(parsed);
}

function parseOptionalPositiveInteger(raw: string | undefined): number | null {
	const parsed = Number(raw || "");
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return null;
	}
	return Math.floor(parsed);
}

function parseBooleanFlag(raw: string | undefined, defaultValue: boolean): boolean {
	const normalized = String(raw ?? "")
		.trim()
		.toLowerCase();
	if (!normalized) {
		return defaultValue;
	}
	if (["1", "true", "yes", "on"].includes(normalized)) {
		return true;
	}
	if (["0", "false", "no", "off"].includes(normalized)) {
		return false;
	}
	return defaultValue;
}

function parseCollectionMode(raw: string | undefined): NoticeCollectionMode {
	const normalized = String(raw ?? "")
		.trim()
		.toLowerCase();
	if (!normalized) {
		return "incremental";
	}
	if (normalized === "incremental" || normalized === "backfill" || normalized === "selected") {
		return normalized;
	}
	throw new Error(
		"AUTHENTICATED_NOTICE_COLLECTION_MODE must be incremental, backfill, or selected",
	);
}

function mergeNoProxyValue(raw: string | undefined): string {
	const tokens = (raw || "")
		.split(",")
		.map((token) => token.trim())
		.filter(Boolean);
	const seen = new Set(tokens.map((token) => token.toLowerCase()));
	for (const host of REQUIRED_NO_PROXY_HOSTS) {
		const normalized = host.toLowerCase();
		if (seen.has(normalized)) {
			continue;
		}
		tokens.push(host);
		seen.add(normalized);
	}
	return tokens.join(",");
}

function removePortalNoProxyHosts(raw: string | undefined): string {
	const portalHosts = new Set(REQUIRED_NO_PROXY_HOSTS.map((host) => host.toLowerCase()));
	return (raw || "")
		.split(",")
		.map((token) => token.trim())
		.filter(Boolean)
		.filter((token) => !portalHosts.has(token.toLowerCase()))
		.join(",");
}

function shouldBypassProxyForPortal(raw: string | undefined): boolean {
	const normalized = String(raw ?? "")
		.trim()
		.toLowerCase();
	if (!normalized) {
		return true;
	}
	return !["0", "false", "no", "off"].includes(normalized);
}

function resolvePortalProxyServer(
	source: NodeJS.ProcessEnv | Record<string, string | undefined>,
	bypassProxyForPortal: boolean,
): string | null {
	if (bypassProxyForPortal) {
		return null;
	}
	for (const candidate of [
		source.AUTHENTICATED_NOTICE_PROXY_SERVER,
		source.HTTPS_PROXY,
		source.https_proxy,
		source.HTTP_PROXY,
		source.http_proxy,
		source.ALL_PROXY,
		source.all_proxy,
	] as Array<string | undefined>) {
		const normalized = String(candidate ?? "").trim();
		if (normalized) {
			return normalized;
		}
	}
	return null;
}
