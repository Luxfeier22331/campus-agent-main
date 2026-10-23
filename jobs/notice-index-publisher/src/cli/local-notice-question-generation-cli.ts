import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
	createOpenAICompatibleNoticeQuestionModel,
	resolveNoticeQuestionModelConfig,
	runLocalNoticeQuestionSetGeneration,
} from "../notice-question-generation/index.ts";
import type { Sha256Ref } from "../types.ts";

const ARTIFACT_ROOT = fileURLToPath(new URL("../../../../var/", import.meta.url));

interface LocalNoticeQuestionGenerationCommand {
	chunkRun: Sha256Ref;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	const command = parseLocalNoticeQuestionGenerationCommand(argv);
	const modelConfig = resolveNoticeQuestionModelConfig(process.env);
	const result = await runLocalNoticeQuestionSetGeneration({
		artifactRoot: ARTIFACT_ROOT,
		chunkRun: command.chunkRun,
		model: createOpenAICompatibleNoticeQuestionModel(modelConfig),
		modelName: modelConfig.model,
		onProgress(completedNoticeCount, totalNoticeCount) {
			process.stderr.write(
				`${JSON.stringify({
					completed_notice_count: completedNoticeCount,
					stage: "question_generation",
					total_notice_count: totalNoticeCount,
				})}\n`,
			);
		},
	});
	console.log(
		JSON.stringify(
			{
				model: result.model,
				output_directory: result.outputDirectory,
				question_count: result.questionCount,
				question_set_run: result.questionSetRun,
				targeted_notice_count: result.targetedNoticeCount,
				targeted_question_count: result.targetedQuestionCount,
			},
			null,
			2,
		),
	);
}

export function parseLocalNoticeQuestionGenerationCommand(
	argv: readonly string[],
): LocalNoticeQuestionGenerationCommand {
	const args = argv[0] === "--" ? argv.slice(1) : [...argv];
	if (args.length !== 2 || args[0] !== "--chunk-run") usage();
	const chunkRun = args[1]?.trim();
	if (!chunkRun || !/^sha256:[0-9a-f]{64}$/u.test(chunkRun)) usage();
	return { chunkRun: chunkRun as Sha256Ref };
}

function usage(): never {
	throw new Error("Usage: generate-notice-questions-local --chunk-run sha256:<id>");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
