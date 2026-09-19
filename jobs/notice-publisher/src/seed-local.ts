import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { NOTICE_CATEGORIES } from "@campus-agent/notices";
import { createNoticeDatabasePool, readNoticeDatabaseConfig } from "@campus-agent/notice-database";

const LOCAL_DATABASE_NAME = /^campus_agent_wt_[0-9]+_[a-f0-9]{8}$/u;


export async function seedLocalNoticeCategories(
	envOverrides: Record<string, string | undefined> = process.env,
): Promise<{ categoryCount: number; initialized: true }> {
	const config = readNoticeDatabaseConfig(envOverrides);
	assertLocalDatabaseUrl(config.connectionString);
	const pool = createNoticeDatabasePool(envOverrides, { max: 1 });
	try {
		const result = await pool.query(
			`insert into notices.categories(category)
			 select unnest($1::text[])
			 on conflict (category) do nothing`,
			[NOTICE_CATEGORIES],
		);
		return { categoryCount: result.rowCount ?? 0, initialized: true };
	} finally {
		await pool.end();
	}
}

function assertLocalDatabaseUrl(value: string): void {
	const url = new URL(value);
	const databaseName = decodeURIComponent(url.pathname.slice(1));
	if (url.hostname !== "127.0.0.1" || !LOCAL_DATABASE_NAME.test(databaseName)) {
		throw new Error("The local notice taxonomy can only be seeded into an isolated local database.");
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	seedLocalNoticeCategories()
		.then((result) => console.log(JSON.stringify(result)))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		});
}
