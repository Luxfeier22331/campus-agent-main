import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
	classifyNoticeBatch,
	DEFAULT_NOTICE_CLASSIFICATION_CONCURRENCY as DEFAULT_NOTICE_CLASSIFICATION_CONCURRENCY_VALUE,
} from "notice-classifier-core/batch";
import { createOpenAINoticeModelClassifier } from "notice-classifier-core/openai";
import {
	createNoticeSourceObjectStoreFromEnv,
	loadLocalNoticeSourceEnvironment,
	loadNoticeClassificationInputs,
} from "./source";

export const DEFAULT_NOTICE_CLASSIFICATION_CONCURRENCY =
	DEFAULT_NOTICE_CLASSIFICATION_CONCURRENCY_VALUE;

export interface NoticeClassificationOptions {
	concurrency: number;
	noticeIds: number[] | undefined;
}

export function parseNoticeIds(argv: readonly string[]): number[] | undefined {
	return parseNoticeOptions(argv).noticeIds;
}

export function parseNoticeOptions(argv: readonly string[]): NoticeClassificationOptions {
	const ids = new Set<number>();
	let concurrency = DEFAULT_NOTICE_CLASSIFICATION_CONCURRENCY;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--concurrency") {
			const raw = argv[index + 1] ?? "";
			concurrency = parsePositiveInteger(raw, "concurrency");
			index += 1;
			continue;
		}
		if (argument !== "--notice-id" || index + 1 >= argv.length) {
			throw new Error(
				"Usage: pnpm notice:classify [--concurrency <positive-integer>] [--notice-id <positive-integer> ...]",
			);
		}
		const raw = argv[index + 1] ?? "";
		if (!/^[1-9][0-9]*$/u.test(raw)) {
			throw new Error(`invalid notice id: ${raw}`);
		}
		const noticeId = Number(raw);
		if (!Number.isSafeInteger(noticeId)) {
			throw new Error(`invalid notice id: ${raw}`);
		}
		if (ids.has(noticeId)) {
			throw new Error(`duplicate notice id: ${noticeId}`);
		}
		ids.add(noticeId);
		index += 1;
	}
	return { concurrency, noticeIds: ids.size > 0 ? [...ids] : undefined };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
	loadLocalNoticeSourceEnvironment(repositoryRoot);
	const options = parseNoticeOptions(argv);
	const objectStore = createNoticeSourceObjectStoreFromEnv();
	try {
		const inputs = await loadNoticeClassificationInputs(objectStore, options.noticeIds, {
			concurrency: options.concurrency,
		});
		const results = await classifyNoticeBatch(
			inputs,
			() => createOpenAINoticeModelClassifier(process.env),
			options.concurrency,
		);
		process.stdout.write(`${results.map((result) => JSON.stringify(result)).join("\n")}\n`);
	} finally {
		objectStore.close();
	}
}

function parsePositiveInteger(value: string, name: string): number {
	if (!/^[1-9][0-9]*$/u.test(value)) {
		throw new Error(`invalid ${name}: ${value}`);
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) {
		throw new Error(`invalid ${name}: ${value}`);
	}
	return parsed;
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
