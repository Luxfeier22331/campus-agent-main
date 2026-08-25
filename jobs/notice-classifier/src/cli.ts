import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { formatNoticeJobError } from "ingestion-contracts/job-error";
import { createNoticeDatabasePool } from "@campus-agent/notice-database";

import { runNoticeClassificationJob } from "./job.ts";
import { createNoticeClassifierFromRuntimeConfig, resolveNoticeClassifierRuntimeConfig } from "./model.ts";
export { parseNoticeClassifierOptions, type NoticeClassifierCliOptions } from "./options.ts";
import { parseNoticeClassifierOptions } from "./options.ts";

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	const options = parseNoticeClassifierOptions(argv);
	const database = createNoticeDatabasePool(process.env, { max: options.concurrency });
	try {
		let runtimeConfigPromise: ReturnType<typeof resolveNoticeClassifierRuntimeConfig> | undefined;
		let modelClassifier: ReturnType<typeof createNoticeClassifierFromRuntimeConfig> | undefined;
		const result = await runNoticeClassificationJob({
			concurrency: options.concurrency,
			createModelClassifier: () => async (input) => {
				modelClassifier ??= createNoticeClassifierFromRuntimeConfig(
					await (runtimeConfigPromise ??= resolveNoticeClassifierRuntimeConfig(
						fetch,
						options.modelConfigUrl,
					)),
				);
				return modelClassifier(input);
			},
			database,
			...(options.noticeIds ? { noticeIds: options.noticeIds } : {}),
		});
		process.stdout.write(`${JSON.stringify({ summary: result })}\n`);
	} finally {
		await database.end();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main().catch((error) => {
		console.error(formatNoticeJobError(error));
		process.exitCode = 1;
	});
}
