export function parsePublishedReaderSyncArgs(argv) {
	const args = argv.filter((token) => token !== "--");
	const command = args.shift();
	if (!["all", "docs", "assets", "check"].includes(command)) {
		throw new Error(
			"usage: node scripts/sync-campus-published-reader.mjs all|docs|assets|check --manifest-path <path> | --manifest-key <key>",
		);
	}
	let manifestFilePath;
	let manifestObjectKey;
	for (let index = 0; index < args.length; index += 1) {
		const token = args[index];
		if (token === "--manifest-path" || token === "--manifest-key") {
			const value = args[index + 1]?.trim();
			if (!value || value.startsWith("--")) {
				throw new Error(`${token} requires a value`);
			}
			if (token === "--manifest-path") {
				manifestFilePath = value;
			} else {
				manifestObjectKey = value;
			}
			index += 1;
			continue;
		}
		throw new Error(`unknown docs sync argument: ${token}`);
	}
	if (Boolean(manifestFilePath) === Boolean(manifestObjectKey)) {
		throw new Error("expected exactly one of --manifest-path or --manifest-key");
	}
	return { command, manifestFilePath, manifestObjectKey };
}
