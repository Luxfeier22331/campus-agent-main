import { createInternalPortalCollectionObjectStoreFromEnv } from "../../../src/object-store.js";
import { fetchNoticeDetail, fetchNoticeMetadata, fetchNoticePage } from "./api.js";
import { resolveInternalPortalConfig } from "./config.js";
import { createInternalPortalNoticeMetaStore } from "./notice-meta-store.js";
import {
	backfillInternalPortalNotices,
	isNoticeHistoryCovered,
	type NoticeRunnerResult,
	parseNoticeStartDate,
	syncInternalPortalNotices,
} from "./notice-runner.js";
import { createInternalPortalNoticeSourceStore } from "./notice-source.js";
import {
	createObjectStoreInternalPortalNoticeSyncStateStore,
} from "./notice-state-store.js";
import { createPortalApiContext } from "./portal.js";

export type NoticeCommand =
	| { name: "backfill"; startDate: string }
	| { name: "sync" };

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
	const stateStore = createObjectStoreInternalPortalNoticeSyncStateStore({ objectStore });
	try {
		if (command.name === "backfill") {
			const state = await stateStore.load();
			if (state && isNoticeHistoryCovered(state, command.startDate)) {
				return {
					mode: "backfill",
					noticesProcessed: 0,
					objectsReused: 0,
					objectsWritten: 0,
					pagesFetched: 0,
					resources: {
						attachmentsDownloaded: 0,
						attachmentsReused: 0,
						imagesDownloaded: 0,
						imagesReused: 0,
					},
					state,
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
				metaStore: createInternalPortalNoticeMetaStore({ objectStore }),
				objectStore,
				portalHost: new URL(config.portalBaseUrl).hostname,
				sourceStore: createInternalPortalNoticeSourceStore({ objectStore }),
				stateStore,
			};
			return await (
				command.name === "sync"
					? syncInternalPortalNotices(runnerInput)
					: backfillInternalPortalNotices({
							...runnerInput,
							startDate: command.startDate,
						})
			);
		} finally {
			await apiContext.dispose();
		}
	} finally {
		await objectStore.close?.();
	}
}

export function parseNoticeCommand(argv: string[]): NoticeCommand {
	const [name, ...args] = argv;
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
		throw new Error("notice backfill requires --start-date YYYY-MM-DD and accepts no other arguments");
	}
	throw new Error("notice command must be sync or backfill");
}
