import type {
	PublishedReaderSyncArgs,
	PublishedReaderSyncCommand,
} from "./published-reader-types.ts";

const SYNC_COMMANDS = new Set<PublishedReaderSyncCommand>(["all", "assets", "check", "docs"]);

export function parsePublishedReaderSyncArgs(argv: string[]): PublishedReaderSyncArgs {
	const args = argv.filter((token) => token !== "--");
	const command = args.shift();
	if (!isPublishedReaderSyncCommand(command)) {
		throw new Error(
			"usage: pnpm exec tsx src/docs-reader-build/sync-campus-published-reader.ts all|docs|assets|check --manifest-path <path>",
		);
	}
	let manifestFilePath: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const token = args[index];
		if (token === "--manifest-path") {
			const value = args[index + 1]?.trim();
			if (!value || value.startsWith("--")) {
				throw new Error(`${token} requires a value`);
			}
			manifestFilePath = value;
			index += 1;
			continue;
		}
		throw new Error(`unknown docs sync argument: ${token}`);
	}
	if (!manifestFilePath) {
		throw new Error("--manifest-path is required");
	}
	return { command, manifestFilePath };
}

function isPublishedReaderSyncCommand(
	value: string | undefined,
): value is PublishedReaderSyncCommand {
	return Boolean(value && SYNC_COMMANDS.has(value as PublishedReaderSyncCommand));
}
