import { createSourceCollectorObjectStoreFromEnv } from "../../../src/object-store.js";
import { loadInternalPortalEnv, resolveInternalPortalConfig } from "./config.js";
import { backfillNoticeResources } from "./notice-resource-backfill.js";
import { createPortalApiContext } from "./portal.js";
import { formatSafeErrorMessage } from "./safe-error.js";

export async function main(argv = process.argv.slice(2)): Promise<void> {
	loadInternalPortalEnv();
	const options = parseArgs(argv);
	const objectStore = createSourceCollectorObjectStoreFromEnv(process.env);
	let apiContext: Awaited<ReturnType<typeof createPortalApiContext>> | undefined;
	try {
		const config = resolveInternalPortalConfig(process.env);
		if (!options.dryRun) {
			apiContext = await createPortalApiContext(config);
		}
		console.log(
			JSON.stringify(
				await backfillNoticeResources({
					...(apiContext ? { apiContext } : {}),
					concurrency: options.concurrency,
					dryRun: options.dryRun,
					...(options.noticeIds.length > 0 ? { noticeIds: options.noticeIds } : {}),
					objectStore,
					portalHost: new URL(config.portalBaseUrl).hostname,
				}),
				null,
				2,
			),
		);
	} finally {
		await apiContext?.dispose();
		await objectStore.close?.();
	}
}

function parseArgs(args: string[]): { concurrency: number; dryRun: boolean; noticeIds: number[] } {
	let concurrency = 4;
	let dryRun = false;
	const noticeIds: number[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const next = args[index + 1];
		if (args[index] === "--dry-run") {
			dryRun = true;
		} else if (args[index] === "--concurrency" && next && /^[1-9][0-9]*$/u.test(next)) {
			concurrency = Number(next);
			index += 1;
		} else if (args[index] === "--notice-id" && next && /^[1-9][0-9]*$/u.test(next)) {
			noticeIds.push(Number(next));
			index += 1;
		} else {
			throw new Error(`unknown or invalid argument: ${args[index]}`);
		}
	}
	return { concurrency, dryRun, noticeIds };
}
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(formatSafeErrorMessage(error));
		process.exitCode = 1;
	});
}
