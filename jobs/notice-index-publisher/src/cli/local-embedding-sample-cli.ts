import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
	createLocalEmbeddingConnection,
	createOpenAICompatibleEmbeddingClient,
} from "@campus-agent/embedding-runtime";

import { runLocalNoticeEmbeddingSample } from "../embedding-sample/index.ts";
import type { Sha256Ref } from "../types.ts";

const ARTIFACT_ROOT = fileURLToPath(new URL("../../../../var/", import.meta.url));

interface LocalEmbeddingSampleCommand {
	chunkRun: Sha256Ref;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	const command = parseLocalEmbeddingSampleCommand(argv);
	const apiKey = process.env.EMBEDDING_API_KEY?.trim();
	if (!apiKey) throw new Error("EMBEDDING_API_KEY is required");
	const baseUrl = process.env.EMBEDDING_BASE_URL?.trim();
	if (!baseUrl) throw new Error("EMBEDDING_BASE_URL is required");
	const connection = createLocalEmbeddingConnection({ apiKey, baseUrl });
	const result = await runLocalNoticeEmbeddingSample({
		artifactRoot: ARTIFACT_ROOT,
		chunkRun: command.chunkRun,
		embedding: createOpenAICompatibleEmbeddingClient(connection),
		modelTargetSha256: connection.targetSha256,
		onEmbeddingProgress(completedInputCount, totalInputCount) {
			process.stderr.write(
				`${JSON.stringify({
					completed_embedding_input_count: completedInputCount,
					stage: "embedding",
					total_embedding_input_count: totalInputCount,
				})}\n`,
			);
		},
	});
	console.log(
		JSON.stringify(
			{
				generated_embedding_input_count: result.generatedEmbeddingInputCount,
				model_target_sha256: connection.targetSha256,
				output_directory: result.outputDirectory,
				report_path: result.reportPath,
				report_run: result.reportRun,
				reused_embedding_input_count: result.reusedEmbeddingInputCount,
				run: result.run,
				selected_chunk_count: result.selectedChunkCount,
				unique_embedding_input_count: result.uniqueEmbeddingInputCount,
			},
			null,
			2,
		),
	);
}

export function parseLocalEmbeddingSampleCommand(
	argv: readonly string[],
): LocalEmbeddingSampleCommand {
	const args = argv[0] === "--" ? argv.slice(1) : [...argv];
	if (args.length !== 2 || args[0] !== "--chunk-run") usage();
	const chunkRun = args[1]?.trim();
	if (!chunkRun || !/^sha256:[0-9a-f]{64}$/u.test(chunkRun)) usage();
	return { chunkRun: chunkRun as Sha256Ref };
}

function usage(): never {
	throw new Error("Usage: sample-embeddings-local --chunk-run sha256:<id>");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
