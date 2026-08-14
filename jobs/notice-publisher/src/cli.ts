import { readFile } from "node:fs/promises";
import process from "node:process";
import { Pool } from "pg";
import { backfillAttachmentLinks } from "./backfill.ts";
import { migrateNotices } from "./migrate.ts";
import { parseClassifications, publishNotices } from "./publisher.ts";
import { createPublisherObjectStoreFromEnv } from "./store.ts";

try {
	process.loadEnvFile(new URL("../.env.local", import.meta.url));
} catch (error) {
	if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

async function main(): Promise<void> {
	const [command, ...args] = process.argv.slice(2);
	const pool = new Pool({ connectionString: required("NOTICES_DATABASE_URL"), max: 1 });
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
				classifications: parseClassifications(await readFile(parsed.classifications, "utf8")),
				client,
				noticeIds: parsed.noticeIds.length ? parsed.noticeIds : undefined,
				objectStore: store,
				portalHost: new URL(required("INTERNAL_PORTAL_BASE_URL")).hostname,
			});
			console.log(JSON.stringify(result));
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

function parsePublishArgs(args: string[]): { classifications: string; noticeIds: number[] } {
	let classifications = ""; const noticeIds: number[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const value = args[index + 1];
		if (args[index] === "--classifications" && value) { classifications = value; index += 1; }
		else if (args[index] === "--notice-id" && value && /^[1-9][0-9]*$/u.test(value)) { noticeIds.push(Number(value)); index += 1; }
		else throw new Error(`unknown or invalid argument: ${args[index]}`);
	}
	if (!classifications) throw new Error("--classifications is required");
	return { classifications, noticeIds };
}
function required(key: string): string { const value = process.env[key]?.trim(); if (!value) throw new Error(`${key} is required`); return value; }

void main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
