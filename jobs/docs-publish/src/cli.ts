import { readFileSync } from "node:fs";

import { materializeDocsRelease } from "./materialize.ts";
import { createDocsObjectStore } from "./object-store.ts";
import { loadDocsRelease, publishDocsRelease } from "./publisher.ts";
import { assertReleaseId } from "./release.ts";
import { parseObjectRef } from "./schema.ts";

async function main(argv: string[]): Promise<void> {
	const [command, ...args] = argv;
	if (command === "help" || command === "--help") {
		console.log(usage());
		return;
	}
	const store = createDocsObjectStore();
	if (command === "publish" || command === "publish-materialize") {
		const path = requiredArg(args, "--input-ref");
		const inputRef = parseObjectRef(JSON.parse(readFileSync(path, "utf8")));
		const release = await publishDocsRelease({ inputRef, store });
		if (command === "publish-materialize") {
			const loaded = await loadDocsRelease({ releaseId: release.releaseId, store });
			await materializeDocsRelease({
				manifest: loaded.manifest,
				releaseId: release.releaseId,
				store,
			});
		}
		console.log(JSON.stringify(release, null, 2));
		return;
	}
	if (command === "verify" || command === "materialize") {
		const releaseId = assertReleaseId(requiredArg(args, "--release-id"));
		const release = await loadDocsRelease({ releaseId, store });
		if (command === "materialize") {
			await materializeDocsRelease({ manifest: release.manifest, releaseId, store });
		}
		console.log(JSON.stringify({ releaseId, verified: true }));
		return;
	}
	throw new Error(usage());
}

function usage(): string {
	return "usage: docs-publish publish|publish-materialize --input-ref <path> | verify|materialize --release-id <sha256:id>";
}

function requiredArg(args: string[], name: string): string {
	const index = args.indexOf(name);
	const value = index >= 0 ? args[index + 1]?.trim() : "";
	if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
	if (args.length !== 2) throw new Error(`unexpected docs-publish arguments: ${args.join(" ")}`);
	return value;
}

main(process.argv.slice(2)).catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
