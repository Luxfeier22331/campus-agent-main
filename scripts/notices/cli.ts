import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
	classifyNotice,
	type NoticeClassificationInput,
	type NoticeDomain,
	type NoticeModelClassifier,
} from "./classifier";
import { createOpenAINoticeModelClassifier } from "./model";
import {
	createNoticeSourceObjectStoreFromEnv,
	loadLocalNoticeSourceEnvironment,
	loadNoticeClassificationInputs,
} from "./source";

export interface NoticeClassificationResult {
	notice_id: number;
	domain: NoticeDomain;
}

export async function classifyNoticeBatch(
	inputs: readonly NoticeClassificationInput[],
	createModelClassifier: () => NoticeModelClassifier,
): Promise<NoticeClassificationResult[]> {
	let modelClassifier: NoticeModelClassifier | undefined;
	const classifyWithModel: NoticeModelClassifier = async (input) => {
		modelClassifier ??= createModelClassifier();
		return modelClassifier(input);
	};
	const results: NoticeClassificationResult[] = [];
	for (const input of inputs) {
		results.push({
			notice_id: input.noticeId,
			domain: await classifyNotice(input, classifyWithModel),
		});
	}
	return results;
}

export function parseNoticeIds(argv: readonly string[]): number[] | undefined {
	if (argv.length === 0) {
		return;
	}
	const ids = new Set<number>();
	for (let index = 0; index < argv.length; index += 2) {
		if (argv[index] !== "--notice-id" || index + 1 >= argv.length) {
			throw new Error("Usage: pnpm notice:classify [--notice-id <positive-integer> ...]");
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
	}
	return [...ids];
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
	loadLocalNoticeSourceEnvironment(repositoryRoot);
	const noticeIds = parseNoticeIds(argv);
	const objectStore = createNoticeSourceObjectStoreFromEnv();
	try {
		const inputs = await loadNoticeClassificationInputs(objectStore, noticeIds);
		const results = await classifyNoticeBatch(inputs, () =>
			createOpenAINoticeModelClassifier(process.env),
		);
		process.stdout.write(`${results.map((result) => JSON.stringify(result)).join("\n")}\n`);
	} finally {
		objectStore.close();
	}
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
