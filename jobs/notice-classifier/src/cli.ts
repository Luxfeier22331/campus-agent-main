import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { runNoticeClassificationJob } from "./job.ts";
import { createNoticeClassifierFromRuntimeConfig, resolveNoticeClassifierRuntimeConfig } from "./model.ts";
import { createNoticeClassifierObjectStoreFromEnv } from "./object-store.ts";
export { parseNoticeClassifierOptions, type NoticeClassifierCliOptions } from "./options.ts";
import { parseNoticeClassifierOptions } from "./options.ts";

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	const options = parseNoticeClassifierOptions(argv);
	const objectStore = createNoticeClassifierObjectStoreFromEnv();
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
			...(options.noticeIds ? { noticeIds: options.noticeIds } : {}),
			objectStore,
		});
		process.stdout.write(`${JSON.stringify(result)}\n`);
	} finally {
		objectStore.close();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
