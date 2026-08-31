import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createNoticeDatabasePool } from "@campus-agent/notice-database";
import { formatRawError } from "ingestion-contracts/raw-error";

import { runNoticeClassificationJob } from "./job.ts";
import {
	createNoticeClassifierFromRuntimeConfig,
	resolveNoticeClassifierRuntimeConfig,
} from "./model.ts";
import { parseNoticeClassifierOptions } from "./options.ts";

export const LOCAL_NOTICE_CLASSIFIER_ENV_PATH = path.resolve(import.meta.dirname, "../.env.local");
export const LOCAL_NOTICE_CLASSIFIER_MODEL_CONFIG_URL = "http://127.0.0.1:18003";

export function loadLocalNoticeClassifierEnvironment(
	environmentPath = LOCAL_NOTICE_CLASSIFIER_ENV_PATH,
): void {
	if (!existsSync(environmentPath)) {
		throw new Error(
			`Local notice classifier environment is missing: ${environmentPath}. Run pnpm dev:init first.`,
		);
	}
	process.loadEnvFile(environmentPath);
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	loadLocalNoticeClassifierEnvironment();
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
						options.modelConfigUrl ??
							process.env.MODEL_CONFIG_URL ??
							LOCAL_NOTICE_CLASSIFIER_MODEL_CONFIG_URL,
					)),
				);
				return modelClassifier(input);
			},
			database,
			...(options.noticeIds ? { noticeIds: options.noticeIds } : {}),
			onProgress: (progress) =>
				console.log(JSON.stringify({ progress, status: "running" })),
		});
		process.stdout.write(`${JSON.stringify({ summary: result })}\n`);
	} finally {
		await database.end();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main().catch((error) => {
		console.error(formatRawError(error));
		process.exitCode = 1;
	});
}
