#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { stdin } from "node:process";
import { readTransportPublisherDatabaseConfig } from "./database.ts";
import { PostgresTransportPublisher } from "./postgres-publisher.ts";
import { prepareTransportPublication } from "./publication.ts";
import { installCampusServicesSchema } from "./schema.ts";

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of stdin) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString("utf8");
}

function inputPath(argv: string[]): string | null {
	if (argv[0] === "install-schema" && argv.length === 1) {
		return null;
	}
	if (argv[0] !== "publish" || argv[1] !== "--input" || !argv[2] || argv.length !== 3) {
		throw new Error(
			"Usage: transport-publisher install-schema | transport-publisher publish --input <path|->",
		);
	}
	return argv[2];
}

async function main(): Promise<void> {
	const path = inputPath(process.argv.slice(2));
	const databaseConfig = readTransportPublisherDatabaseConfig();
	if (path === null) {
		await installCampusServicesSchema(databaseConfig);
		console.log(JSON.stringify({ status: "installed" }));
		return;
	}
	const raw = path === "-" ? await readStdin() : await readFile(path, "utf8");
	const prepared = prepareTransportPublication(JSON.parse(raw) as unknown);
	const result = await new PostgresTransportPublisher(databaseConfig).publish(prepared);
	console.log(JSON.stringify(result));
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
