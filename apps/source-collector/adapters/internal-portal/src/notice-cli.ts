import { createSourceCollectorObjectStoreFromEnv } from "../../../src/object-store.js";
import { fetchNoticeDetail, fetchNoticeMetadata, fetchNoticePage } from "./api.js";
import { loadInternalPortalEnv, resolveInternalPortalConfig } from "./config.js";
import { createInternalPortalNoticeMetaStore } from "./notice-meta-store.js";
import { DEFAULT_NOTICE_RESOURCE_CONCURRENCY } from "./notice-resources.js";
import {
	backfillInternalPortalNotices,
	isNoticeHistoryCovered,
	parseNoticeStartDate,
	syncInternalPortalNotices,
} from "./notice-runner.js";
import { createInternalPortalNoticeSourceStore } from "./notice-source.js";
import {
	createObjectStoreInternalPortalNoticeSyncStateStore,
	type InternalPortalNoticeSyncState,
} from "./notice-state-store.js";
import { createPortalApiContext } from "./portal.js";
import { formatSafeErrorMessage } from "./safe-error.js";

export type NoticeCommand =
	| { name: "backfill"; resourceConcurrency: number; startDate: string }
	| { name: "status" }
	| { name: "sync"; resourceConcurrency: number };

export interface NoticeCommandOptions {
	env?: NodeJS.ProcessEnv;
	ssoTgc?: string;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
	loadInternalPortalEnv();
	const command = parseNoticeCommand(argv);
	await runNoticeCommand(command);
}

export async function runNoticeCommand(
	command: NoticeCommand,
	options: NoticeCommandOptions = {},
): Promise<void> {
	const env = options.env ?? process.env;
	const objectStore = createSourceCollectorObjectStoreFromEnv(env);
	const stateStore = createObjectStoreInternalPortalNoticeSyncStateStore({ objectStore });
	try {
		if (command.name === "status") {
			const state = await stateStore.load();
			console.log(JSON.stringify(toStatusRecord(state), null, 2));
			return;
		}
		if (command.name === "backfill") {
			const state = await stateStore.load();
			if (state && isNoticeHistoryCovered(state, command.startDate)) {
				console.log(
					JSON.stringify(
						{
							mode: "backfill",
							noticeIds: [],
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
						},
						null,
						2,
					),
				);
				return;
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
				resourceConcurrency: command.resourceConcurrency,
				sourceStore: createInternalPortalNoticeSourceStore({ objectStore }),
				stateStore,
			};
			const result =
				command.name === "sync"
					? await syncInternalPortalNotices(runnerInput)
					: await backfillInternalPortalNotices({
							...runnerInput,
							startDate: command.startDate,
						});
			console.log(JSON.stringify(result, null, 2));
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
		return { name, resourceConcurrency: parseConcurrency(args) };
	}
	if (name === "status" && args.length === 0) {
		return { name };
	}
	if (name === "backfill") {
		const startDateIndex = args.indexOf("--start-date");
		if (startDateIndex >= 0 && startDateIndex === 0) {
			const startDate = parseNoticeStartDate(args[1] ?? "");
			const remaining = args.slice(2);
			return { name, resourceConcurrency: parseConcurrency(remaining), startDate };
		}
		throw new Error("notice:backfill requires --start-date YYYY-MM-DD");
	}
	throw new Error("notice command must be sync, backfill, or status");
}

function parseConcurrency(args: string[]): number {
	if (args.length === 0) {
		return DEFAULT_NOTICE_RESOURCE_CONCURRENCY;
	}
	if (args.length === 2 && args[0] === "--concurrency" && /^[1-9][0-9]*$/u.test(args[1] ?? "")) {
		const value = Number(args[1]);
		if (value >= 1 && value <= 16) {
			return value;
		}
	}
	throw new Error("notice sync/backfill accepts --concurrency 1..16");
}

function toStatusRecord(state: InternalPortalNoticeSyncState | null): Record<string, unknown> {
	return {
		history_covered_from: state?.historyCoveredFrom ?? null,
		head_notice_id: state?.headNoticeId ?? null,
		updated_at: state?.updatedAt ?? null,
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(formatSafeErrorMessage(error));
		process.exitCode = 1;
	});
}
