import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { formatNoticeJobError } from "ingestion-contracts/job-error";
import { Pool } from "pg";
import { backfillAttachmentLinks } from "./backfill.ts";
import { readNoticeDatabaseConfig } from "./database.ts";
import { migrateNotices } from "./migrate.ts";
import { internalPortalHost } from "./portal.ts";
import { parseClassifications, publishNotices } from "./publisher.ts";
import { createPublisherObjectStoreFromEnv } from "./store.ts";

try {
	process.loadEnvFile(new URL("../.env.local", import.meta.url));
} catch (error) {
	if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

async function main(): Promise<void> {
	const [command, ...args] = process.argv.slice(2);
	const database = readNoticeDatabaseConfig(process.env);
	const pool = new Pool({ ...database, max: 1 });
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
		if (command !== "publish") {
			throw new Error("usage: notice-publisher <migrate|backfill-attachment-links|publish>");
		}
		const parsed = parsePublishArgs(args);
		const store = createPublisherObjectStoreFromEnv(process.env);
		try {
			const result = await publishNotices({
				...(parsed.classifications
					? {
						classifications: parseClassifications(
							await readFile(parsed.classifications, "utf8"),
						),
					}
					: {}),
				client,
				noticeIds: parsed.noticeIds.length ? parsed.noticeIds : undefined,
				objectStore: store,
				portalHost: internalPortalHost(),
			});
			console.log(JSON.stringify({ summary: result }));
		} finally { store.close(); }
	} finally { client.release(); await pool.end(); }
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

export function parsePublishArgs(
	args: string[],
): { classifications: string | null; noticeIds: number[] } {
	let classifications: string | null = null;
	const noticeIds: number[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const value = args[index + 1];
		if (args[index] === "--classifications" && value) { classifications = value; index += 1; }
		else if (args[index] === "--notice-id" && value && /^[1-9][0-9]*$/u.test(value)) { noticeIds.push(Number(value)); index += 1; }
		else throw new Error(`unknown or invalid argument: ${args[index]}`);
	}
	return { classifications, noticeIds };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	void main().catch((error) => {
		console.error(formatNoticeJobError(error));
		process.exitCode = 1;
	});
}
