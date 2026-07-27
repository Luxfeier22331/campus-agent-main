import { createSourceCollectorObjectStoreFromEnv } from "../../../src/object-store.js";
import { fetchNoticeDetail, fetchNoticePage } from "./api.js";
import {
	loadInternalPortalEnv,
	resolveInternalPortalConfig,
	resolveInternalPortalSiteId,
} from "./config.js";
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
	const siteId = resolveInternalPortalSiteId(process.env);
	const objectStore = createSourceCollectorObjectStoreFromEnv(process.env);
	const stateStore = createObjectStoreInternalPortalNoticeSyncStateStore({ objectStore });
	try {
		if (command.name === "status") {
			const state = await stateStore.load(siteId);
			console.log(
				JSON.stringify(
					{
						site_id: siteId,
						...toStatusRecord(state),
					},
					null,
					2,
				),
			);
			return;
		}
		if (command.name === "backfill") {
			const state = await stateStore.load(siteId);
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
				fetchNoticePage,
				siteId,
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
		incremental_head_id: state?.incrementalHeadId ?? null,
		max_captured_id: state?.maxCapturedId ?? null,
		min_captured_id: state?.minCapturedId ?? null,
		updated_at: state?.updatedAt ?? null,
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(formatSafeErrorMessage(error));
		process.exitCode = 1;
	});
}
