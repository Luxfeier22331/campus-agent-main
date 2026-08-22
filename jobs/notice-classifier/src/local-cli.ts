import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { runNoticeClassificationJob } from "./job.ts";
import {
	createNoticeClassifierFromRuntimeConfig,
	resolveNoticeClassifierRuntimeConfig,
} from "./model.ts";
import { createNoticeClassifierObjectStoreFromEnv } from "./object-store.ts";
import { parseNoticeClassifierOptions } from "./options.ts";

export const LOCAL_NOTICE_CLASSIFIER_ENV_PATH = path.resolve(
	import.meta.dirname,
	"../.env.local",
);
export const LOCAL_NOTICE_CLASSIFIER_MODEL_CONFIG_URL = "http://127.0.0.1:18003";

const LOCAL_OBJECT_STORE_ENV_KEYS = [
	"OBJECT_STORE_ENDPOINT",
	"OBJECT_STORE_REGION",
	"OBJECT_STORE_BUCKET_SOURCE",
	"OBJECT_STORE_BUCKET_DERIVED",
	"OBJECT_STORE_SOURCE_ACCESS_KEY",
	"OBJECT_STORE_SOURCE_SECRET_KEY",
	"OBJECT_STORE_DERIVED_ACCESS_KEY",
	"OBJECT_STORE_DERIVED_SECRET_KEY",
] as const;

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

export function assertLocalNoticeClassifierObjectStoreEnvironment(
	env: NodeJS.ProcessEnv = process.env,
): void {
	for (const key of LOCAL_OBJECT_STORE_ENV_KEYS) {
		if (!env[key]?.trim()) throw new Error(`${key} is required`);
	}
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	loadLocalNoticeClassifierEnvironment();
	assertLocalNoticeClassifierObjectStoreEnvironment();
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
						options.modelConfigUrl ??
							process.env.MODEL_CONFIG_URL ??
							LOCAL_NOTICE_CLASSIFIER_MODEL_CONFIG_URL,
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
