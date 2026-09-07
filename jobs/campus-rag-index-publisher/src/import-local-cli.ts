import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { assertSha256Ref } from "./artifacts.ts";
import { importCampusRagArtifacts } from "./artifact-import.ts";
import {
	createS3ReaderStoreFromConfig,
	createS3WriterStore,
	DEFAULT_DERIVED_BUCKET,
} from "./object-store.ts";
import { connectToKubernetesObjectStore } from "./kubectl.ts";
import type { Sha256Ref } from "./types.ts";

export interface LocalArtifactImportCommand {
	context?: string;
	docsEmbeddingSet: Sha256Ref;
	namespace: string;
	noticeEmbeddingSet: Sha256Ref;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	const command = parseLocalArtifactImportCommand(argv);
	const targetBucket = requiredEnv(process.env.OBJECT_STORE_BUCKET_DERIVED, "OBJECT_STORE_BUCKET_DERIVED");
	if (targetBucket === DEFAULT_DERIVED_BUCKET) {
		throw new Error("local artifact import refuses to write the shared derived bucket");
	}

	const kubernetesStore = await connectToKubernetesObjectStore({
		...(command.context ? { context: command.context } : {}),
		namespace: command.namespace,
	});
	try {
		const result = await importCampusRagArtifacts({
			docsEmbeddingSet: command.docsEmbeddingSet,
			noticeEmbeddingSet: command.noticeEmbeddingSet,
			sourceStore: createS3ReaderStoreFromConfig({
				accessKeyId: kubernetesStore.accessKeyId,
				bucket: DEFAULT_DERIVED_BUCKET,
				endpoint: kubernetesStore.endpoint,
				secretAccessKey: kubernetesStore.secretAccessKey,
			}),
			targetStore: createS3WriterStore(),
		});
		console.log(
			JSON.stringify(
				{
					byte_count: result.byteCount,
					created_object_count: result.createdObjectCount,
					docs_embedding_set: command.docsEmbeddingSet,
					existing_object_count: result.existingObjectCount,
					notice_embedding_set: command.noticeEmbeddingSet,
					object_count: result.objectCount,
				},
				null,
				2,
			),
		);
	} finally {
		await kubernetesStore.close();
	}
}

export function parseLocalArtifactImportCommand(
	argv: readonly string[],
): LocalArtifactImportCommand {
	const args = argv[0] === "--" ? argv.slice(1) : argv;
	if (args.length < 6 || args.length > 8 || args.length % 2 !== 0) usage();
	const flags = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const name = args[index];
		const value = args[index + 1]?.trim();
		if (!name?.startsWith("--") || !value || flags.has(name)) usage();
		flags.set(name, value);
	}
	for (const name of flags.keys()) {
		if (!["--context", "--docs-embedding-set", "--namespace", "--notice-embedding-set"].includes(name)) {
			usage();
		}
	}
	return {
		...(flags.has("--context") ? { context: requiredFlag(flags, "--context") } : {}),
		docsEmbeddingSet: assertSha256Ref(
			requiredFlag(flags, "--docs-embedding-set"),
			"--docs-embedding-set",
		),
		namespace: requiredFlag(flags, "--namespace"),
		noticeEmbeddingSet: assertSha256Ref(
			requiredFlag(flags, "--notice-embedding-set"),
			"--notice-embedding-set",
		),
	};
}

function requiredFlag(flags: ReadonlyMap<string, string>, name: string): string {
	const value = flags.get(name)?.trim();
	if (!value) usage();
	return value;
}

function requiredEnv(value: string | undefined, name: string): string {
	const normalized = value?.trim();
	if (!normalized) throw new Error(`${name} is required for local artifact import`);
	return normalized;
}

function usage(): never {
	throw new Error(
		"Usage: import-artifacts-local --namespace <namespace> [--context <context>] --docs-embedding-set sha256:<id> --notice-embedding-set sha256:<id>",
	);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
