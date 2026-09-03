import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { writeImmutable } from "../artifacts.ts";
import { canonicalJsonBytes, encodeNdjson, sha256 } from "../encoding.ts";
import type { NoticeRetrievalQuestion } from "../embedding-evaluation/model.ts";
import { artifactHex, readNoticeChunkRun } from "../run-reader.ts";
import type { ArtifactReference, Sha256Ref } from "../types.ts";
import { loadBroadSample, loadReviewCandidates } from "./artifacts.ts";
import {
	NOTICE_QUESTION_GENERATION_CONCURRENCY,
	NOTICE_QUESTION_SET_DEFINITION,
	NOTICE_QUESTION_SET_SCHEMA_VERSION,
	NOTICE_QUESTION_SET_VALIDATION_SCHEMA_VERSION,
	type GeneratedNoticeQuestion,
	type LocalNoticeQuestionSetResult,
	type NoticeQuestionModel,
	type NoticeQuestionSetManifest,
	type NoticeQuestionSetValidation,
} from "./model.ts";
import {
	materializeGeneratedNoticeQuestions,
	validateGeneratedQuestions,
} from "./validation.ts";

export async function runLocalNoticeQuestionSetGeneration(input: {
	artifactRoot: string;
	chunkRun: Sha256Ref;
	model: NoticeQuestionModel;
	modelName: string;
	onProgress?: (completedNoticeCount: number, totalNoticeCount: number) => void;
}): Promise<LocalNoticeQuestionSetResult> {
	const runData = await readNoticeChunkRun(input.artifactRoot, input.chunkRun);
	const broadSample = await loadBroadSample(
		input.artifactRoot,
		input.chunkRun,
		runData.chunksByNoticeId,
	);
	const reviewCandidates = await loadReviewCandidates(input.artifactRoot, input.chunkRun);

	let completedNoticeCount = 0;
	const generated = await mapWithConcurrency(
		broadSample.notices,
		NOTICE_QUESTION_GENERATION_CONCURRENCY,
		async (notice) => {
			let validated: GeneratedNoticeQuestion[];
			try {
				const selections = await input.model.generate({
					chunkContents: notice.chunks.map((chunk) => chunk.content),
					title: notice.title,
				});
				const questions = materializeGeneratedNoticeQuestions({
					chunkContents: notice.chunks.map((chunk) => chunk.content),
					questions: selections,
				});
				validated = validateGeneratedQuestions({
					chunks: notice.chunks,
					noticeId: notice.noticeId,
					questions,
				});
			} catch (error) {
				throw new Error(
					`notice ${notice.noticeId} question generation failed: ${
						error instanceof Error ? error.message : String(error)
					}`,
					{ cause: error },
				);
			}
			completedNoticeCount += 1;
			input.onProgress?.(completedNoticeCount, broadSample.notices.length);
			return validated.map<NoticeRetrievalQuestion>((question, questionIndex) => ({
				answer: question.answer,
				evidence: question.evidence.map((text) => ({ text })),
				noticeId: notice.noticeId,
				question: question.question,
				questionId: `notice:${notice.noticeId}:${questionIndex + 1}`,
				stratum: notice.primaryStratum ?? "coverage-fill",
			}));
		},
	);
	const questions = generated.flat();
	const targetedNoticeIdSet = new Set(reviewCandidates.noticeIds);
	const targetedQuestions = questions.filter((question) =>
		targetedNoticeIdSet.has(question.noticeId),
	);
	const validation: NoticeQuestionSetValidation = {
		anchoredEvidenceCount: questions.reduce((sum, question) => sum + question.evidence.length, 0),
		broadSampleNoticeCount: broadSample.notices.length,
		chunkRun: input.chunkRun,
		invalidCount: 0,
		model: input.modelName,
		questionCount: questions.length,
		questionsPerNotice: NOTICE_QUESTION_SET_DEFINITION.questionsPerNotice,
		schemaVersion: NOTICE_QUESTION_SET_VALIDATION_SCHEMA_VERSION,
		targetedNoticeCount: reviewCandidates.noticeIds.length,
		targetedQuestionCount: targetedQuestions.length,
		unanchoredEvidenceCount: 0,
	};
	if (
		questions.length !==
		broadSample.notices.length * NOTICE_QUESTION_SET_DEFINITION.questionsPerNotice
	) {
		throw new Error("notice question generation did not produce the expected question count");
	}

	const questionBytes = encodeNdjson(questions);
	const targetedQuestionBytes = encodeNdjson(targetedQuestions);
	const validationBytes = canonicalJsonBytes(validation);
	const manifest: NoticeQuestionSetManifest = {
		broadSample: {
			censusSha256: sha256(broadSample.censusBytes),
			sampleSha256: sha256(broadSample.sampleBytes),
		},
		chunkRun: input.chunkRun,
		definition: NOTICE_QUESTION_SET_DEFINITION,
		model: input.modelName,
		questionCount: questions.length,
		questions: reference("questions.ndjson", questionBytes),
		reviewCandidatesSha256: sha256(reviewCandidates.bytes),
		schemaVersion: NOTICE_QUESTION_SET_SCHEMA_VERSION,
		targetedNoticeIds: reviewCandidates.noticeIds,
		targetedQuestions: reference("targeted-questions.ndjson", targetedQuestionBytes),
		validation: reference("validation.json", validationBytes),
	};
	const manifestBytes = canonicalJsonBytes(manifest);
	const questionSetRun = sha256(manifestBytes);
	const outputDirectory = join(
		input.artifactRoot,
		"notices",
		"chunking",
		"question-sets",
		"sha256",
		artifactHex(questionSetRun),
	);
	await mkdir(outputDirectory, { recursive: true });
	await Promise.all([
		writeImmutable(join(outputDirectory, "manifest.json"), manifestBytes),
		writeImmutable(join(outputDirectory, "questions.ndjson"), questionBytes),
		writeImmutable(join(outputDirectory, "targeted-questions.ndjson"), targetedQuestionBytes),
		writeImmutable(join(outputDirectory, "validation.json"), validationBytes),
	]);
	return {
		model: input.modelName,
		outputDirectory,
		questionCount: questions.length,
		questionSetRun,
		targetedNoticeCount: reviewCandidates.noticeIds.length,
		targetedQuestionCount: targetedQuestions.length,
	};
}

async function mapWithConcurrency<Input, Output>(
	inputs: readonly Input[],
	concurrency: number,
	map: (input: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
	const outputs = new Array<Output>(inputs.length);
	let nextIndex = 0;
	let failure: unknown;
	async function worker(): Promise<void> {
		while (failure === undefined) {
			const index = nextIndex;
			if (index >= inputs.length) return;
			nextIndex += 1;
			try {
				outputs[index] = await map(inputs[index] as Input, index);
			} catch (error) {
				failure = error;
			}
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()),
	);
	if (failure !== undefined) throw failure;
	return outputs;
}

function reference(file: string, bytes: Uint8Array): ArtifactReference {
	return { byteSize: bytes.byteLength, file, sha256: sha256(bytes) };
}
