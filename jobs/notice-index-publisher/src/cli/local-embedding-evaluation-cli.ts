import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
	createLocalEmbeddingConnection,
	createOpenAICompatibleEmbeddingClient,
} from "@campus-agent/embedding-runtime";
import {
	runLocalNoticeEmbeddingEvaluation,
} from "../embedding-evaluation/index.ts";
import type { Sha256Ref } from "../types.ts";

const ARTIFACT_ROOT = fileURLToPath(new URL("../../../../var/", import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

interface LocalEmbeddingEvaluationCommand {
	chunkRun: Sha256Ref;
	questionFile: string;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	const command = parseLocalEmbeddingEvaluationCommand(argv);
	const apiKey = process.env.EMBEDDING_API_KEY?.trim();
	if (!apiKey) throw new Error("EMBEDDING_API_KEY is required");
	const baseUrl = process.env.EMBEDDING_BASE_URL?.trim();
	if (!baseUrl) throw new Error("EMBEDDING_BASE_URL is required");
	const connection = createLocalEmbeddingConnection({ apiKey, baseUrl });
	const modelTargetSha256 = connection.targetSha256;
	const result = await runLocalNoticeEmbeddingEvaluation({
		artifactRoot: ARTIFACT_ROOT,
		chunkRun: command.chunkRun,
		embedding: createOpenAICompatibleEmbeddingClient(connection),
		modelTargetSha256,
		onEmbeddingProgress(completedInputCount, totalInputCount) {
			process.stderr.write(
				`${JSON.stringify({
					completed_embedding_input_count: completedInputCount,
					stage: "embedding",
					total_embedding_input_count: totalInputCount,
				})}\n`,
			);
		},
		onRankingProgress(completedQuestionCount, totalQuestionCount) {
			if (completedQuestionCount % 10 !== 0 && completedQuestionCount !== totalQuestionCount) {
				return;
			}
			process.stderr.write(
				`${JSON.stringify({
					completed_question_count: completedQuestionCount,
					stage: "ranking",
					total_question_count: totalQuestionCount,
				})}\n`,
			);
		},
		questionFile: command.questionFile,
	});
	console.log(
		JSON.stringify(
			{
				generated_embedding_input_count: result.generatedEmbeddingInputCount,
				metrics: result.metrics,
				model_target_sha256: modelTargetSha256,
				output_directory: result.outputDirectory,
				reused_embedding_input_count: result.reusedEmbeddingInputCount,
				run: result.run,
			},
			null,
			2,
		),
	);
}

export function parseLocalEmbeddingEvaluationCommand(
	argv: readonly string[],
): LocalEmbeddingEvaluationCommand {
	const args = argv[0] === "--" ? argv.slice(1) : [...argv];
	if (args.length !== 4) usage();
	const flags = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const name = args[index];
		const value = args[index + 1];
		if (!name?.startsWith("--") || !value || flags.has(name)) usage();
		flags.set(name, value);
	}
	for (const name of flags.keys()) {
		if (!["--chunk-run", "--questions"].includes(name)) usage();
	}
	const chunkRun = requiredFlag(flags, "--chunk-run");
	if (!/^sha256:[0-9a-f]{64}$/u.test(chunkRun)) usage();
	return {
		chunkRun: chunkRun as Sha256Ref,
		questionFile: resolve(REPOSITORY_ROOT, requiredFlag(flags, "--questions")),
	};
}

function requiredFlag(flags: ReadonlyMap<string, string>, name: string): string {
	const value = flags.get(name)?.trim();
	if (!value) usage();
	return value;
}

function usage(): never {
	throw new Error(
		"Usage: evaluate-embeddings-local --chunk-run sha256:<id> --questions <path>",
	);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
