import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createNoticeDatabasePool } from "@campus-agent/notice-database";

import { runLocalNoticeChunkBuild } from "../command.ts";

const ARTIFACT_ROOT = fileURLToPath(new URL("../../../../var/", import.meta.url));

export async function main(): Promise<void> {
	const pool = createNoticeDatabasePool(process.env, { max: 1 });
	try {
		const result = await runLocalNoticeChunkBuild({ artifactRoot: ARTIFACT_ROOT, pool });
		console.log(
			JSON.stringify(
				{
					chunk_count: result.chunkCount,
					notice_count: result.noticeCount,
					output_directory: result.outputDirectory,
					run: result.run,
				},
				null,
				2,
			),
		);
	} finally {
		await pool.end();
	}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
