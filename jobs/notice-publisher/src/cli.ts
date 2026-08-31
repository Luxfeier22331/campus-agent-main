import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createNoticeDatabasePool } from "@campus-agent/notice-database";
import { formatRawError } from "ingestion-contracts/raw-error";
import { backfillAttachmentLinks } from "./backfill.ts";
import { migrateNotices } from "./migrate.ts";
import { internalPortalHost } from "./portal.ts";
import { publishNotices, republishNotices } from "./publisher.ts";
import { createPublisherObjectStoreFromEnv } from "./store.ts";

try {
	process.loadEnvFile(new URL("../.env.local", import.meta.url));
} catch (error) {
	if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

async function main(): Promise<void> {
	const [command, ...args] = process.argv.slice(2);
	const pool = createNoticeDatabasePool(process.env, { max: 1 });
	const client = await pool.connect();
	try {
		if (command === "migrate") {
			console.log(JSON.stringify({ result: await migrateNotices(client) }));
			return;
		}
		if (command === "backfill-attachment-links") {
			const parsed = parseBackfillArgs(args);
			const store = createPublisherObjectStoreFromEnv(process.env);
			try {
				const result = await backfillAttachmentLinks({
					client,
					dryRun: parsed.dryRun,
					noticeIds: parsed.noticeIds.length ? parsed.noticeIds : undefined,
					objectStore: store,
				});
				console.log(JSON.stringify(result));
			} finally {
				store.close();
			}
			return;
		}
		if (command === "republish") {
			const parsed = parseRepublishArgs(args);
			const store = createPublisherObjectStoreFromEnv(process.env);
			try {
				const result = await republishNotices({
					client,
					noticeIds: parsed.noticeIds.length ? parsed.noticeIds : undefined,
					onProgress: (progress) =>
						console.log(JSON.stringify({ progress, status: "running" })),
					objectStore: store,
					portalHost: internalPortalHost(),
				});
				console.log(JSON.stringify({ summary: result }));
			} finally {
				store.close();
			}
			return;
		}
		if (command !== "publish") {
			throw new Error(
				"usage: notice-publisher <migrate|backfill-attachment-links|publish|republish>",
			);
		}
		const parsed = parsePublishArgs(args);
		const store = createPublisherObjectStoreFromEnv(process.env);
		try {
			const result = await publishNotices({
				client,
				noticeIds: parsed.noticeIds.length ? parsed.noticeIds : undefined,
				onProgress: (progress) =>
					console.log(JSON.stringify({ progress, status: "running" })),
				objectStore: store,
				portalHost: internalPortalHost(),
			});
			console.log(JSON.stringify({ summary: result }));
		} finally {
			store.close();
		}
	} finally {
		client.release();
		await pool.end();
	}
}

function parseBackfillArgs(args: string[]): { dryRun: boolean; noticeIds: number[] } {
	let dryRun = false;
	const noticeIds: number[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		const value = args[index + 1];
		if (argument === "--dry-run") {
			dryRun = true;
		} else if (argument === "--notice-id" && value && /^[1-9][0-9]*$/u.test(value)) {
			noticeIds.push(Number(value));
			index += 1;
		} else {
			throw new Error(`unknown or invalid argument: ${argument}`);
		}
	}
	return { dryRun, noticeIds };
}

export function parsePublishArgs(args: string[]): { noticeIds: number[] } {
	return parseNoticeIds(args);
}

export function parseRepublishArgs(args: string[]): { noticeIds: number[] } {
	return parseNoticeIds(args);
}

function parseNoticeIds(args: string[]): { noticeIds: number[] } {
	const noticeIds: number[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const value = args[index + 1];
		if (args[index] === "--notice-id" && value && /^[1-9][0-9]*$/u.test(value)) {
			const noticeId = Number(value);
			if (noticeIds.includes(noticeId)) throw new Error(`duplicate notice id: ${noticeId}`);
			noticeIds.push(noticeId);
			index += 1;
		} else throw new Error(`unknown or invalid argument: ${args[index]}`);
	}
	return { noticeIds };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	void main().catch((error) => {
		console.error(formatRawError(error));
		process.exitCode = 1;
	});
}
