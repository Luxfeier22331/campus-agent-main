import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertSha256Ref } from "./artifacts.ts";
import { createArtifactStore } from "./stream-store.ts";
import { buildIndex } from "./build.ts";
import { applyIndex } from "./apply.ts";
import { cleanupArtifacts } from "./cleanup-job.ts";

export function parseCommand(argv: readonly string[], env: NodeJS.ProcessEnv = process.env) {
	if (argv.length !== 1)
		throw new Error("Usage: retrieval-index build|apply|cleanup (inputs via environment)");
	const ref = (name: string) => assertSha256Ref(env[name] ?? "", name);
	const optional = (name: string) => (env[name] ? ref(name) : undefined);
	switch (argv[0]) {
		case "build": {
			const source = env.RETRIEVAL_BUILD_SOURCE;
			if (source !== "docs" && source !== "notices" && source !== "both")
				throw new Error("RETRIEVAL_BUILD_SOURCE must be docs, notices or both");
			const reuseDocs = optional("CAMPUS_DOCS_REUSE_EMBEDDING_SET"),
				reuseNotices = optional("CAMPUS_NOTICE_REUSE_EMBEDDING_SET");
			return {
				kind: "build" as const,
				source: source as "docs" | "notices" | "both",
				...(reuseDocs ? { reuseDocs } : {}),
				...(reuseNotices ? { reuseNotices } : {}),
			};
		}
		case "apply":
			return {
				kind: "apply" as const,
				docs: ref("CAMPUS_DOCS_EMBEDDING_SET"),
				notices: ref("CAMPUS_NOTICE_EMBEDDING_SET"),
			};
		case "cleanup": {
			const targets = ([...["docs", "notices"]] as const).flatMap((kind) =>
				(
					env[kind === "docs" ? "RETRIEVAL_CLEANUP_DOCS_SETS" : "RETRIEVAL_CLEANUP_NOTICE_SETS"] ??
					""
				)
					.split(",")
					.filter(Boolean)
					.map((id) => ({ kind, id: assertSha256Ref(id.trim(), "cleanup set") })),
			);
			if (!targets.length) throw new Error("cleanup requires explicit set IDs");
			return { kind: "cleanup" as const, targets };
		}
		default:
			throw new Error("Usage: retrieval-index build|apply|cleanup");
	}
}
export async function main(argv: readonly string[] = process.argv.slice(2)) {
	const command = parseCommand(argv);
	const store = createArtifactStore(process.env, command.kind === "apply");
	try {
		const result =
			command.kind === "build"
				? await buildIndex({ store, ...command })
				: command.kind === "apply"
					? await applyIndex({ store, ...command })
					: await cleanupArtifacts(store, command.targets);
		console.log(JSON.stringify(result));
	} finally {
		store.close();
	}
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
	main().catch((e) => {
		console.error(e instanceof Error ? e.message : String(e));
		process.exitCode = 1;
	});
