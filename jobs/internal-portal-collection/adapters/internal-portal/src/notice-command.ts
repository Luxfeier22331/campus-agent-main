import { createInternalPortalCollectionObjectStoreFromEnv } from "../../../src/object-store.js";
import {
	createNoticeDatabasePool,
	type NoticeLockSkipped,
	withNoticeMaintenanceLock,
} from "@campus-agent/notice-database";
import type { PoolClient } from "pg";
import { bindApiContextCancellation } from "./api-context-cancellation.js";
import { fetchNoticeDetail, fetchNoticeMetadata, fetchNoticePage } from "./api.js";
import { resolveInternalPortalConfig } from "./config.js";
import { createInternalPortalNoticeMetaStore } from "./notice-meta-store.js";
import { createNoticeInventoryStore } from "./notice-inventory-store.js";
import {
	backfillInternalPortalNotices,
	isNoticeHistoryCovered,
	type NoticeRunnerResult,
 type NoticeRunnerProgress,
	parseNoticeStartDate,
	rescanInternalPortalNotices,
	syncInternalPortalNotices,
} from "./notice-runner.js";
import { createInternalPortalNoticeSourceStore } from "./notice-source.js";
import { createObjectStoreInternalPortalNoticeSyncStateStore } from "./notice-state-store.js";
import { createPortalApiContext } from "./portal.js";

export type NoticeCommand =
	| { name: "backfill"; startDate: string; windowDays?: number }
	| { name: "sync" }
	| { name: "rescan"; from: string; to: string };

export interface NoticeCommandOptions {
	abortSignal?: AbortSignal;
	env?: NodeJS.ProcessEnv;
	ssoTgc?: string;
	onProgress?: (progress: NoticeRunnerProgress) => void;
}

export async function runNoticeCommand(
	command: NoticeCommand,
	options: NoticeCommandOptions = {},
): Promise<NoticeRunnerResult | NoticeLockSkipped> {
	options.abortSignal?.throwIfAborted();
	const env = options.env ?? process.env;
	const objectStore = createInternalPortalCollectionObjectStoreFromEnv(env);
	const databasePool = createNoticeDatabasePool(env, { max: 1 });
	const stateStore = createObjectStoreInternalPortalNoticeSyncStateStore({ objectStore });
	let databaseClient: PoolClient | null = null;
	let operationFailed = false;
	try {
		const client = await databasePool.connect();
		databaseClient = client;
		return await withNoticeMaintenanceLock(client, async (lockSignal) => {
			const abortSignal = options.abortSignal
				? AbortSignal.any([options.abortSignal, lockSignal])
				: lockSignal;
			if (command.name === "backfill") {
				const state = await stateStore.load();
				if (state && isNoticeHistoryCovered(state, command.startDate)) {
					if (!(state.coveredFrom && state.coveredUntil)) {
						throw new Error("internal portal notice sync state has no complete maintenance range");
					}
					console.log(
						JSON.stringify({
							processedRange: null,
							progress: { phase: "finalizing", processed: 0, total: 0 },
							status: "running",
						}),
					);
					return {
						failures: [],
						maintenanceRange: { from: state.coveredFrom, to: state.coveredUntil },
						mode: "backfill",
						noticesAdded: 0,
						noticesUpdated: 0,
						noticesUnchanged: 0,
						noticesProcessed: 0,
						objectsReused: 0,
						objectsWritten: 0,
						pagesFetched: 0,
						processedRange: null,
						resources: {
							attachmentsDownloaded: 0,
							attachmentsMissing: 0,
							attachmentsReused: 0,
							imagesDownloaded: 0,
							imagesReused: 0,
						},
						state,
						upToDate: false,
					};
				}
			}

			abortSignal.throwIfAborted();
			const config = resolveInternalPortalConfig(
				options.ssoTgc === undefined ? env : { ...env, INTERNAL_PORTAL_SSO_TGC: options.ssoTgc },
			);
			const apiContext = await createPortalApiContext(config, { abortSignal });
			const disposeApiContext = bindApiContextCancellation(apiContext, abortSignal);
			try {
				const runnerInput = {
					...(options.onProgress ? { onProgress: options.onProgress } : {}),
					abortSignal,
					apiContext,
					fetchNoticeDetail,
					fetchNoticeMetadata,
					fetchNoticePage,
					inventoryStore: createNoticeInventoryStore(client),
					metaStore: createInternalPortalNoticeMetaStore({ objectStore }),
					objectStore,
					enablePeriodicReview: true,
					portalHost: new URL(config.portalBaseUrl).hostname,
					sourceStore: createInternalPortalNoticeSourceStore({ objectStore }),
					stateStore,
				};
				if (command.name === "rescan") {
					return await rescanInternalPortalNotices({ ...runnerInput, from: command.from, to: command.to });
				}
				return await (command.name === "sync"
					? syncInternalPortalNotices(runnerInput)
					: backfillInternalPortalNotices({
							...runnerInput,
							startDate: command.startDate,
							...(command.windowDays === undefined ? {} : { windowDays: command.windowDays }),
						}));
			} finally {
				await disposeApiContext();
			}
		});
	} catch (error) {
		operationFailed = true;
		throw error;
	} finally {
		let cleanupError: unknown;
		// A failed run may have lost or kept its session lock; dropping the connection ends both.
		databaseClient?.release(operationFailed ? true : undefined);
		try {
			await objectStore.close?.();
		} catch (error) {
			cleanupError ??= error;
		}
		try {
			await databasePool.end();
		} catch (error) {
			cleanupError ??= error;
		}
		if (!operationFailed && cleanupError !== undefined) {
			throw cleanupError;
		}
	}
}

export function parseNoticeCommand(argv: string[]): NoticeCommand {
	const [name, ...args] = argv;
	if (name === "rescan" && args.length === 4 && args[0] === "--from" && args[2] === "--to") {
		const from = parseNoticeStartDate(args[1] ?? "");
		const to = parseNoticeStartDate(args[3] ?? "");
		if (from >= to) throw new Error("notice rescan requires from < to");
		return { name, from, to };
	}
	if (name === "sync") {
		if (args.length > 0) {
			throw new Error("notice sync does not accept additional arguments");
		}
		return { name };
	}
	if (name === "backfill") {
		const startDateIndex = args.indexOf("--start-date");
		if (startDateIndex === 0 && args.length === 2) {
			const startDate = parseNoticeStartDate(args[1] ?? "");
			return { name, startDate };
		}
		throw new Error(
			"notice backfill requires --start-date YYYY-MM-DD and accepts no other arguments",
		);
	}
	throw new Error("notice command must be sync, backfill or rescan --from YYYY-MM-DD --to YYYY-MM-DD");
}
