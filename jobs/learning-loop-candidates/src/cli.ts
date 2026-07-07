#!/usr/bin/env node

import { createLearningLoopCandidatePublisher } from "eval-langfuse";
import { publishCandidates, verifyPublishedCandidates } from "./publish";
import { buildLearningLoopCandidates } from "./selector";
import { createPostgresCandidateSelectionStore } from "./store";

interface CliArgs {
	command: "select-candidates" | "publish-candidates" | "verify-published-candidates";
	dryRun: boolean;
	json: boolean;
	limit: number;
	since: string;
}

function readFlag(args: string[], name: string): string | null {
	const index = args.indexOf(name);
	return index >= 0 ? (args[index + 1] ?? null) : null;
}

export function parseCliArgs(argv: string[]): CliArgs {
	const [commandValue, ...args] = argv;
	if (
		commandValue !== "select-candidates" &&
		commandValue !== "publish-candidates" &&
		commandValue !== "verify-published-candidates"
	) {
		throw new Error(
			"Expected command: select-candidates, publish-candidates or verify-published-candidates.",
		);
	}

	const since = readFlag(args, "--since");
	if (!since) {
		throw new Error("--since is required.");
	}
	const limitValue = readFlag(args, "--limit") ?? "50";
	const limit = Number.parseInt(limitValue, 10);
	if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
		throw new Error("--limit must be an integer between 1 and 500.");
	}

	return {
		command: commandValue,
		dryRun: args.includes("--dry-run"),
		json: args.includes("--json"),
		limit,
		since,
	};
}

async function main(): Promise<void> {
	const args = parseCliArgs(process.argv.slice(2));
	const connectionString = process.env.APP_API_DB_URL ?? process.env.DATABASE_URL;
	if (!connectionString) {
		throw new Error("APP_API_DB_URL or DATABASE_URL is required.");
	}

	const store = createPostgresCandidateSelectionStore({ connectionString });
	try {
		const rows = await store.selectRows({ limit: args.limit, since: args.since });
		const candidates = buildLearningLoopCandidates(rows);
		if (args.command === "select-candidates") {
			console.log(JSON.stringify({ candidates, selectedCount: candidates.length }, null, 2));
			return;
		}
		if (args.command === "verify-published-candidates") {
			const result = await verifyPublishedCandidates({
				candidates,
				publisher: createLearningLoopCandidatePublisher(),
			});
			console.log(JSON.stringify(result, null, 2));
			return;
		}

		const result = await publishCandidates({
			candidates,
			dryRun: args.dryRun,
			publisher: createLearningLoopCandidatePublisher(),
		});
		console.log(JSON.stringify(result, null, 2));
	} finally {
		await store.close();
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
