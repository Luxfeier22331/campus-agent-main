import {
	PortalCredentialExpiredError,
	PortalCredentialUnavailableError,
	PortalSessionExpiredError,
} from "@campus-agent/internal-portal-client";
import {
	createInternalPortalCollectionObjectStoreFromEnv,
	type InternalPortalCollectionObjectStore,
} from "../../../src/object-store.js";
import { FILE_RELEASE_PAGE_SIZE, fetchFileReleasePage } from "./api.js";
import { bindApiContextCancellation } from "./api-context-cancellation.js";
import { type InternalPortalConfig, resolveInternalPortalConfig } from "./config.js";
import {
	type CaptureInternalPortalFileReleaseResult,
	captureInternalPortalFileRelease,
} from "./file-release-capture.js";
import { createPortalApiContext } from "./portal.js";
import type {
	ApiRequestContextLike,
	DisposableApiContextLike,
	FileReleaseListResponse,
} from "./types.js";

const MAX_FILE_RELEASE_PAGES = 1_000;

export interface FileSyncFailure {
	errorCode: string;
	fileReleaseId: number;
}

export interface FileSyncSummary {
	failed: number;
	failures: FileSyncFailure[];
	reused: number;
	scanned: number;
	written: number;
}

export interface FileSyncDependencies {
	capture?: typeof captureInternalPortalFileRelease;
	createApiContext?: () => Promise<ApiRequestContextLike & DisposableApiContextLike>;
	createObjectStore?: (env: Record<string, string | undefined>) => InternalPortalCollectionObjectStore;
	fetchPage?: (input: {
		apiContext: ApiRequestContextLike;
		currentPage: number;
	}) => Promise<FileReleaseListResponse>;
}

export async function runFileSync(
	input: {
		abortSignal?: AbortSignal;
		env: Record<string, string | undefined>;
		ssoTgc?: string;
	},
	dependencies: FileSyncDependencies = {},
): Promise<FileSyncSummary> {
	const config = resolveInternalPortalConfig({
		...input.env,
		...(input.ssoTgc ? { INTERNAL_PORTAL_SSO_TGC: input.ssoTgc } : {}),
	});
	const objectStore = (dependencies.createObjectStore ?? createInternalPortalCollectionObjectStoreFromEnv)(
		input.env,
	);
	try {
		const fileReleaseIds = await listFileReleaseIds(config, {
			...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
			...(dependencies.createApiContext ? { createApiContext: dependencies.createApiContext } : {}),
			...(dependencies.fetchPage ? { fetchPage: dependencies.fetchPage } : {}),
		});
		const summary: FileSyncSummary = {
			failed: 0,
			failures: [],
			reused: 0,
			scanned: fileReleaseIds.length,
			written: 0,
		};
		for (const fileReleaseId of fileReleaseIds) {
			input.abortSignal?.throwIfAborted();
			try {
				const result = await (dependencies.capture ?? captureInternalPortalFileRelease)(
					{
						...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
						config,
						fileReleaseId,
						objectStore,
					},
					{},
				);
				incrementDisposition(summary, result);
			} catch (error) {
				if (isAuthenticationFailure(error)) {
					throw error;
				}
				summary.failed += 1;
				summary.failures.push({
					errorCode: boundedErrorCode(error),
					fileReleaseId,
				});
			}
		}
		return summary;
	} finally {
		await objectStore.close?.();
	}
}

export async function listFileReleaseIds(
	config: InternalPortalConfig,
	dependencies: {
		abortSignal?: AbortSignal;
		createApiContext?: () => Promise<ApiRequestContextLike & DisposableApiContextLike>;
		fetchPage?: (input: {
			apiContext: ApiRequestContextLike;
			currentPage: number;
		}) => Promise<FileReleaseListResponse>;
	} = {},
): Promise<number[]> {
	const apiContext = await (
		dependencies.createApiContext ??
		(() =>
			createPortalApiContext(
				config,
				dependencies.abortSignal ? { abortSignal: dependencies.abortSignal } : {},
			))
	)();
	const disposeApiContext = bindApiContextCancellation(apiContext, dependencies.abortSignal);
	try {
		const ids: number[] = [];
		const seen = new Set<number>();
		let expectedTotal: number | null = null;
		for (let currentPage = 1; currentPage <= MAX_FILE_RELEASE_PAGES; currentPage += 1) {
			dependencies.abortSignal?.throwIfAborted();
			const response = await (dependencies.fetchPage ?? fetchFileReleasePage)({
				apiContext,
				currentPage,
			});
			const rows = response.datas?.tables ?? [];
			const page = response.datas?.page;
			if (!page) {
				throw new Error("Internal portal file list page metadata is missing.");
			}
			expectedTotal ??= normalizeNonNegativeInteger(page.totalCounts ?? page.total);
			for (const row of rows) {
				const id = normalizePositiveInteger(row.id);
				if (id === null) {
					throw new Error("Internal portal file list contains an invalid ID.");
				}
				if (seen.has(id)) {
					throw new Error(`Internal portal file list contains duplicate ID ${id}.`);
				}
				seen.add(id);
				ids.push(id);
			}
			if (rows.length === 0 || (expectedTotal !== null && ids.length >= expectedTotal)) {
				if (expectedTotal !== null && ids.length !== expectedTotal) {
					throw new Error(
						`Internal portal file list returned ${ids.length} rows, expected ${expectedTotal}.`,
					);
				}
				return ids;
			}
			if (rows.length < FILE_RELEASE_PAGE_SIZE && expectedTotal === null) {
				return ids;
			}
		}
		throw new Error("Internal portal file list exceeded the page limit.");
	} finally {
		await disposeApiContext();
	}
}

function incrementDisposition(
	summary: FileSyncSummary,
	result: CaptureInternalPortalFileReleaseResult,
): void {
	if (result.disposition === "reused") {
		summary.reused += 1;
	} else {
		summary.written += 1;
	}
}

function normalizePositiveInteger(value: number | string | null | undefined): number | null {
	if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
		return value;
	}
	if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value.trim())) {
		return null;
	}
	const parsed = Number(value.trim());
	return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizeNonNegativeInteger(value: number | string | null | undefined): number | null {
	if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
		return value;
	}
	if (typeof value !== "string" || !/^\d+$/u.test(value.trim())) {
		return null;
	}
	const parsed = Number(value.trim());
	return Number.isSafeInteger(parsed) ? parsed : null;
}

function isAuthenticationFailure(error: unknown): boolean {
	return (
		error instanceof PortalCredentialExpiredError ||
		error instanceof PortalCredentialUnavailableError ||
		error instanceof PortalSessionExpiredError
	);
}

function boundedErrorCode(error: unknown): string {
	if (error instanceof Error && /^[A-Za-z0-9_.:-]{1,80}$/u.test(error.name)) {
		return error.name;
	}
	return "file_capture_failed";
}
