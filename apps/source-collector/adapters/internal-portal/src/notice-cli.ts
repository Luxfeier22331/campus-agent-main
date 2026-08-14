import { createSourceCollectorObjectStoreFromEnv } from "../../../src/object-store.js";
import { fetchNoticeDetail, fetchNoticeMetadata, fetchNoticePage } from "./api.js";
import { loadInternalPortalEnv, resolveInternalPortalConfig } from "./config.js";
import { createInternalPortalNoticeMetaStore } from "./notice-meta-store.js";
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

type NoticeCommand =
	| { name: "backfill"; startDate: string }
	| { name: "status" }
	| { name: "sync" };

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
	loadInternalPortalEnv();
	const command = parseCommand(argv);
	const objectStore = createSourceCollectorObjectStoreFromEnv(process.env);
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
							objectsReused: 0,
							objectsWritten: 0,
							pagesFetched: 0,
							state,
						},
						null,
						2,
					),
				);
				return;
			}
		}

		const config = resolveInternalPortalConfig(process.env);
		const apiContext = await createPortalApiContext(config);
		try {
			const runnerInput = {
				apiContext,
				fetchNoticeDetail,
				fetchNoticeMetadata,
				fetchNoticePage,
				metaStore: createInternalPortalNoticeMetaStore({ objectStore }),
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

function parseCommand(argv: string[]): NoticeCommand {
	const [name, ...args] = argv;
	if (name === "sync" && args.length === 0) {
		return { name };
	}
	if (name === "status" && args.length === 0) {
		return { name };
	}
	if (name === "backfill") {
		const startDateIndex = args.indexOf("--start-date");
		if (startDateIndex >= 0 && args.length === 2 && startDateIndex === 0) {
			return { name, startDate: parseNoticeStartDate(args[1] ?? "") };
		}
		throw new Error("notice:backfill requires --start-date YYYY-MM-DD");
	}
	throw new Error("notice command must be sync, backfill, or status");
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
