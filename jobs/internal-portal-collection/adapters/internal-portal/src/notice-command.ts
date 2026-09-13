import { createInternalPortalCollectionObjectStoreFromEnv } from "../../../src/object-store.js";
import { createNoticeDatabasePool } from "@campus-agent/notice-database";
import type { PoolClient } from "pg";
import { fetchNoticeDetail, fetchNoticeMetadata, fetchNoticePage } from "./api.js";
import { resolveInternalPortalConfig } from "./config.js";
import { createInternalPortalNoticeMetaStore } from "./notice-meta-store.js";
import { createNoticeInventoryStore } from "./notice-inventory-store.js";
import {
	backfillInternalPortalNotices,
	isNoticeHistoryCovered,
	type NoticeRunnerResult,
	parseNoticeStartDate,
	rescanInternalPortalNotices,
	syncInternalPortalNotices,
} from "./notice-runner.js";
import { createInternalPortalNoticeSourceStore } from "./notice-source.js";
import { createObjectStoreInternalPortalNoticeSyncStateStore } from "./notice-state-store.js";
import { createPortalApiContext } from "./portal.js";

const NOTICE_MAINTENANCE_LOCK_NAMESPACE = 1_315_928_137;
const NOTICE_MAINTENANCE_LOCK_ID = 1;

export type NoticeCommand = { name: "backfill"; startDate: string } | { name: "sync" } | { name: "rescan"; from: string; to: string };

export interface NoticeCommandOptions {
	env?: NodeJS.ProcessEnv;
	ssoTgc?: string;
}

export async function runNoticeCommand(
	command: NoticeCommand,
	options: NoticeCommandOptions = {},
): Promise<NoticeRunnerResult> {
	const env = options.env ?? process.env;
	const objectStore = createInternalPortalCollectionObjectStoreFromEnv(env);
	const databasePool = createNoticeDatabasePool(env, { max: 1 });
	const stateStore = createObjectStoreInternalPortalNoticeSyncStateStore({ objectStore });
	let databaseClient: PoolClient | null = null;
	let lockAcquired = false;
	let operationFailed = false;
	try {
		databaseClient = await databasePool.connect();
		const lock = await databaseClient.query<{ acquired: boolean }>(
			"SELECT pg_try_advisory_lock($1, $2) AS acquired",
			[NOTICE_MAINTENANCE_LOCK_NAMESPACE, NOTICE_MAINTENANCE_LOCK_ID],
		);
		lockAcquired = lock.rows[0]?.acquired === true;
		if (!lockAcquired) {
			throw new Error("another notice maintenance collection is already running");
		}
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

		const config = resolveInternalPortalConfig(
			options.ssoTgc === undefined ? env : { ...env, INTERNAL_PORTAL_SSO_TGC: options.ssoTgc },
		);
		const apiContext = await createPortalApiContext(config);
		try {
			const runnerInput = {
				apiContext,
				fetchNoticeDetail,
				fetchNoticeMetadata,
				fetchNoticePage,
				inventoryStore: createNoticeInventoryStore(databaseClient),
				metaStore: createInternalPortalNoticeMetaStore({ objectStore }),
				objectStore,
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
					}));
		} finally {
			await apiContext.dispose();
		}
	} catch (error) {
		operationFailed = true;
		throw error;
	} finally {
		let cleanupError: unknown;
		let unlockError: unknown;
		if (lockAcquired && databaseClient) {
			try {
				await databaseClient.query("SELECT pg_advisory_unlock($1, $2)", [
					NOTICE_MAINTENANCE_LOCK_NAMESPACE,
					NOTICE_MAINTENANCE_LOCK_ID,
				]);
			} catch (error) {
				unlockError = error;
				cleanupError = error;
			}
		}
		databaseClient?.release(
			unlockError === undefined ? undefined : unlockError instanceof Error ? unlockError : true,
		);
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
