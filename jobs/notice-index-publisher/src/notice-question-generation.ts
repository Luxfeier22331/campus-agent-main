import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { writeImmutable } from "./artifacts.ts";
import { NOTICE_BROAD_REVIEW_ARTIFACT_DIRECTORY } from "./broad-review.ts";
import { canonicalJsonBytes, encodeNdjson, sha256 } from "./encoding.ts";
import { artifactHex, readNoticeChunkRun } from "./run-reader.ts";
import type { NoticeRetrievalQuestion } from "./embedding-evaluation.ts";
import type { ArtifactReference, NoticeChunk, Sha256Ref } from "./types.ts";

export const NOTICE_QUESTION_SET_DEFINITION = {
	algorithm: "notice_question_generation.v8",
	evidenceMode: "selected-chunk-content",
	questionScope: "global-dense-single-chunk-fact",
	modelInput: "notice_title_and_referenced_chunks",
	promptVersion: "notice_question_generation_prompt.v14",
	questionsPerNotice: 2,
} as const;

export const NOTICE_QUESTION_SET_SCHEMA_VERSION = "notice_question_set_run.v1" as const;
export const NOTICE_QUESTION_SET_VALIDATION_SCHEMA_VERSION =
	"notice_question_set_validation.v1" as const;
export const NOTICE_QUESTION_GENERATION_CONCURRENCY = 1;
export const NOTICE_QUESTION_MAX_OUTPUT_TOKENS = 16384;

export const NOTICE_QUESTION_GENERATION_SYSTEM_PROMPT = [
	"你负责为校园通知建立用于全库 dense retrieval 的单目标评测问题集。",
	"只能依据输入中的通知标题和 Chunk 正文，不得使用外部知识，不得补充正文没有出现的事实。",
	"必须恰好生成两道中文问题。两道问题都必须分别询问一个通知中的单一事实，每道问题都必须由一个 Chunk 独立回答。禁止生成需要把两个或多个 Chunk 的正文事实联系起来才能回答的复合问题。",
	"每道问题都必须仅凭 question 本身明确指向这条通知的主题或对象，不能依赖调用方另行提供的 notice_title、noticeId 或隐藏上下文。",
	"主题或对象锚点必须出现在 question 中。问题可以自然使用通知标题或正文中的活动名称、项目名称、学院、部门、专有名词、地点等区分性短语；不要求完整复述标题，也不要机械复制完整标题。",
	"本轮暂不处理名单类问题：不要询问名单、公示人选、候选人、录取、获奖或入选结果中的具体人员或具体条目，也不要询问具体人员的个人属性、排名、成绩或所属信息。名单通知仍可选择其中与名单无关的通知主题、流程、要求或安排等事实；如果当前事实只能通过名单行或具体人员来回答，改选其他事实。",
	"不要为了避免复述标题而删除消歧信息。禁止生成脱离主题后可能对应多条通知的泛化问题，例如“公示时间是什么时候”“报名截止时间是什么时候”“联系电话是多少”。如果当前事实只能用这种泛化问法表达，改选一个带有明确主题锚点的事实，不要生成需要先澄清通知身份的问题。",
	"输出前只看 question 本身检查：一个不知道隐藏标题的人，是否能判断问题询问的通知主题或对象？如果不能，先补充主题锚点再输出。",
	"两道问题必须询问不同的事实，或至少使用明显不同的问法并需要不同的证据；不能输出相同问题、同义重复问题或只改变一个无意义标点的问题。输出前请检查两道 question 字符串和所依据的事实确实不同。",
	"每道问题必须选择一个且仅一个 Chunk 作为问题和答案的完整依据，并把该 Chunk 的 chunk_ref 输出到问题对象；不要跨 Chunk 拼接事实。",
	"answer 必须简洁回答 question，只能包含 question 所问且所选 Chunk 能直接支持的内容；不要补充其他 Chunk 中的相关事实。",
	"chunk_ref 必须逐字复制输入中对应 Chunk 的 chunk_ref。不要输出 evidence，系统会直接使用所选 Chunk 的完整正文作为评测 evidence。",
	"不要选择只有通知标题、独立章节标题或图片占位符的 Chunk。不要输出解释、Markdown、问题编号或额外字段。",
].join("\n");

const NOTICE_QUESTION_RESPONSE_SCHEMA = {
	additionalProperties: false,
	properties: {
		questions: {
			items: {
				additionalProperties: false,
				properties: {
					answer: { minLength: 1, type: "string" },
					chunk_ref: { minLength: 1, type: "string" },
					question: { minLength: 1, type: "string" },
				},
				required: ["question", "answer", "chunk_ref"],
				type: "object",
			},
			maxItems: NOTICE_QUESTION_SET_DEFINITION.questionsPerNotice,
			minItems: NOTICE_QUESTION_SET_DEFINITION.questionsPerNotice,
			type: "array",
		},
	},
	required: ["questions"],
	type: "object",
} as const;

export interface NoticeQuestionModelConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
}

export interface NoticeQuestionModel {
	generate(input: {
		chunkContents: readonly string[];
		title: string;
	}): Promise<GeneratedNoticeQuestionSelection[]>;
}

export interface GeneratedNoticeQuestion {
	answer: string;
	evidence: string[];
	question: string;
}

export interface GeneratedNoticeQuestionSelection {
	answer: string;
	chunkRef: string;
	question: string;
}

export interface NoticeQuestionSetManifest {
	broadSample: {
		censusSha256: Sha256Ref;
		sampleSha256: Sha256Ref;
	};
	chunkRun: Sha256Ref;
	definition: typeof NOTICE_QUESTION_SET_DEFINITION;
	model: string;
	questionCount: number;
	questions: ArtifactReference;
	reviewCandidatesSha256: Sha256Ref;
	schemaVersion: typeof NOTICE_QUESTION_SET_SCHEMA_VERSION;
	targetedNoticeIds: string[];
	targetedQuestions: ArtifactReference;
	validation: ArtifactReference;
}

export interface NoticeQuestionSetValidation {
	anchoredEvidenceCount: number;
	broadSampleNoticeCount: number;
	chunkRun: Sha256Ref;
	invalidCount: 0;
	model: string;
	questionCount: number;
	questionsPerNotice: 2;
	schemaVersion: typeof NOTICE_QUESTION_SET_VALIDATION_SCHEMA_VERSION;
	targetedNoticeCount: number;
	targetedQuestionCount: number;
	unanchoredEvidenceCount: 0;
}

export interface LocalNoticeQuestionSetResult {
	model: string;
	outputDirectory: string;
	questionCount: number;
	questionSetRun: Sha256Ref;
	targetedNoticeCount: number;
	targetedQuestionCount: number;
}

interface BroadSampleChunk {
	chunkId: Sha256Ref;
	chunkIndex: number;
	content: string;
}

interface BroadSampleNotice {
	chunks: BroadSampleChunk[];
	noticeId: string;
	primaryStratum?: string;
	title: string;
}

interface LoadedBroadSample {
	censusBytes: Uint8Array;
	notices: BroadSampleNotice[];
	sampleBytes: Uint8Array;
}

export function resolveNoticeQuestionModelConfig(
	env: NodeJS.ProcessEnv,
): NoticeQuestionModelConfig {
	return {
		apiKey: requiredEnv(env, "LLM_API_KEY"),
		baseUrl: normalizeModelBaseUrl(requiredEnv(env, "LLM_BASE_URL")),
		model: requiredEnv(env, "LLM_MODEL"),
	};
}

export function createOpenAICompatibleNoticeQuestionModel(
	config: NoticeQuestionModelConfig,
	fetchImplementation: typeof fetch = fetch,
): NoticeQuestionModel {
	return {
		async generate(input) {
			const response = await fetchImplementation(`${config.baseUrl}/responses`, {
				body: JSON.stringify({
					input: [
						{ role: "system", content: NOTICE_QUESTION_GENERATION_SYSTEM_PROMPT },
						{
							role: "user",
							content: JSON.stringify({
								chunk_context: buildChunkContext(input.chunkContents),
								notice_title: input.title,
							}),
						},
					],
					max_output_tokens: NOTICE_QUESTION_MAX_OUTPUT_TOKENS,
					model: config.model,
					reasoning: { effort: "none" },
					temperature: 0,
					text: {
						format: {
							name: "notice_question_set",
							schema: NOTICE_QUESTION_RESPONSE_SCHEMA,
							strict: true,
							type: "json_schema",
						},
					},
				}),
				headers: {
					accept: "application/json",
					authorization: `Bearer ${config.apiKey}`,
					"content-type": "application/json",
				},
				method: "POST",
				redirect: "error",
			});
			if (!response.ok) {
				throw new Error(`notice question model returned HTTP ${response.status}`);
			}
			const payload = (await response.json()) as unknown;
			const outputText = responseOutputText(payload);
			let output: unknown;
			try {
				output = JSON.parse(outputText) as unknown;
			} catch (error) {
				throw new Error("notice question model output is not valid JSON", { cause: error });
			}
			const selections = parseGeneratedNoticeQuestionSelections(output);
			validateNoticeChunkSelections(selections, input.chunkContents);
			return selections;
		},
	};
}

function buildChunkContext(chunkContents: readonly string[]): Array<{
	chunk_ref: string;
	content: string;
}> {
	return chunkContents.map((content, chunkIndex) => ({
		chunk_ref: `chunk-${chunkIndex}`,
		content,
	}));
}

function parseGeneratedNoticeQuestionSelections(value: unknown): GeneratedNoticeQuestionSelection[] {
	if (!isRecord(value) || !Array.isArray(value.questions)) {
		throw new Error("notice question model output must contain questions");
	}
	if (value.questions.length !== NOTICE_QUESTION_SET_DEFINITION.questionsPerNotice) {
		throw new Error("notice question model output must contain exactly two questions");
	}
	const questions = value.questions.map((raw, questionIndex) => {
		if (!isRecord(raw)) {
			throw new Error(`notice generated question ${questionIndex} is invalid`);
		}
		const question = nonEmptyString(raw.question) ? raw.question.trim() : "";
		const answer = nonEmptyString(raw.answer) ? raw.answer.trim() : "";
		const chunkRef = nonEmptyString(raw.chunk_ref) ? raw.chunk_ref.trim() : "";
		if (
			!question ||
			!answer ||
			!chunkRef
		) {
			throw new Error(`notice generated question ${questionIndex} is invalid`);
		}
		return { answer, chunkRef, question };
	});
	if (new Set(questions.map((question) => question.question)).size !== questions.length) {
		throw new Error("notice generated questions are duplicated");
	}
	return questions;
}

export function materializeGeneratedNoticeQuestions(input: {
	chunkContents: readonly string[];
	questions: readonly GeneratedNoticeQuestionSelection[];
}): GeneratedNoticeQuestion[] {
	validateNoticeChunkSelections(input.questions, input.chunkContents);
	const chunkReferences = buildChunkReferenceIndex(input.chunkContents);
	return input.questions.map((question, questionIndex) => {
		const chunk = chunkReferences.get(question.chunkRef);
		if (!chunk) {
			throw new Error(
				`notice generated question ${questionIndex} references unknown chunk: ${question.chunkRef}`,
			);
		}
		return {
			answer: question.answer,
			evidence: [chunk.content],
			question: question.question,
		};
	});
}

function validateNoticeChunkSelections(
	questions: readonly GeneratedNoticeQuestionSelection[],
	chunkContents: readonly string[],
): void {
	const chunkReferences = buildChunkReferenceIndex(chunkContents);
	for (const [questionIndex, question] of questions.entries()) {
		if (!chunkReferences.has(question.chunkRef)) {
			throw new Error(
				`notice generated question ${questionIndex} references unknown chunk: ${question.chunkRef}`,
			);
		}
	}
}

interface NoticeChunkLocation {
	chunkIndex: number;
	content: string;
}

function buildChunkReferenceIndex(
	chunkContents: readonly string[],
): Map<string, NoticeChunkLocation> {
	const references = new Map<string, NoticeChunkLocation>();
	for (const [chunkIndex, content] of chunkContents.entries()) {
		references.set(`chunk-${chunkIndex}`, { chunkIndex, content });
	}
	return references;
}

function responseOutputText(value: unknown): string {
	if (!isRecord(value)) {
		throw new Error("notice question model response is invalid");
	}
	if (typeof value.output_text === "string" && value.output_text) {
		return value.output_text;
	}
	if (!Array.isArray(value.output)) {
		throw new Error("notice question model response is invalid");
	}
	const texts: string[] = [];
	for (const output of value.output) {
		if (!isRecord(output) || output.type !== "message" || !Array.isArray(output.content)) {
			continue;
		}
		for (const content of output.content) {
			if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") {
				texts.push(content.text);
			}
		}
	}
	const outputText = texts.join("");
	if (!outputText) throw new Error("notice question model response has no output text");
	return outputText;
}

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

function parseMaterializedGeneratedNoticeQuestions(value: unknown): GeneratedNoticeQuestion[] {
	if (!isRecord(value) || !Array.isArray(value.questions)) {
		throw new Error("notice question model output must contain questions");
	}
	if (value.questions.length !== NOTICE_QUESTION_SET_DEFINITION.questionsPerNotice) {
		throw new Error("notice question model output must contain exactly two questions");
	}
	const questions = value.questions.map((raw, index) => {
		if (!isRecord(raw)) throw new Error(`notice generated question ${index} is invalid`);
		const question = nonEmptyString(raw.question) ? raw.question.trim() : "";
		const answer = nonEmptyString(raw.answer) ? raw.answer.trim() : "";
		if (!question || !answer || !Array.isArray(raw.evidence) || raw.evidence.length === 0) {
			throw new Error(`notice generated question ${index} is invalid`);
		}
		const evidence = raw.evidence.map((item, evidenceIndex) => {
			if (!nonEmptyString(item)) {
				throw new Error(`notice generated question ${index} evidence ${evidenceIndex} is invalid`);
			}
			return item;
		});
		if (new Set(evidence).size !== evidence.length) {
			throw new Error(`notice generated question ${index} has duplicate evidence`);
		}
		return { answer, evidence, question };
	});
	if (new Set(questions.map((question) => question.question)).size !== questions.length) {
		throw new Error("notice generated questions are duplicated");
	}
	return questions;
}

export function validateGeneratedQuestions(input: {
	chunks: readonly Pick<NoticeChunk, "content">[];
	noticeId: string;
	questions: readonly GeneratedNoticeQuestion[];
}): GeneratedNoticeQuestion[] {
	const questions = parseMaterializedGeneratedNoticeQuestions({ questions: input.questions });
	for (const [questionIndex, question] of questions.entries()) {
		for (const [evidenceIndex, evidence] of question.evidence.entries()) {
			if (!input.chunks.some((chunk) => chunk.content.includes(evidence))) {
				throw new Error(
					`notice ${input.noticeId} question ${questionIndex + 1} evidence ${evidenceIndex + 1} is not contained in a chunk`,
				);
			}
		}
	}
	return questions;
}

async function loadBroadSample(
	artifactRoot: string,
	chunkRun: Sha256Ref,
	chunksByNoticeId: ReadonlyMap<string, readonly NoticeChunk[]>,
): Promise<LoadedBroadSample> {
	const directory = join(
		artifactRoot,
		"notices",
		"chunking",
		"reviews",
		"sha256",
		artifactHex(chunkRun),
		NOTICE_BROAD_REVIEW_ARTIFACT_DIRECTORY,
	);
	const [censusBytes, sampleBytes] = await Promise.all([
		readFile(join(directory, "census.json")),
		readFile(join(directory, "broad-sample.ndjson")),
	]);
	const census = parseJson(censusBytes, "notice broad sample census");
	if (!isRecord(census) || census.run !== chunkRun) {
		throw new Error("notice broad sample census does not match the chunk run");
	}
	const values = decodeNdjson(sampleBytes, "notice broad sample");
	const seenNoticeIds = new Set<string>();
	const notices = values.map((value, index) => {
		const notice = decodeBroadSampleNotice(value, index);
		if (seenNoticeIds.has(notice.noticeId)) {
			throw new Error(`notice broad sample notice is duplicated: ${notice.noticeId}`);
		}
		seenNoticeIds.add(notice.noticeId);
		const runChunks = chunksByNoticeId.get(notice.noticeId);
		if (!runChunks || runChunks.length !== notice.chunks.length) {
			throw new Error(`notice broad sample chunks do not match notice ${notice.noticeId}`);
		}
		const orderedSampleChunks = [...notice.chunks].sort(
			(left, right) => left.chunkIndex - right.chunkIndex,
		);
		const orderedRunChunks = [...runChunks].sort(
			(left, right) => left.chunkIndex - right.chunkIndex,
		);
		for (const [chunkIndex, sampleChunk] of orderedSampleChunks.entries()) {
			const runChunk = orderedRunChunks[chunkIndex];
			if (
				!runChunk ||
				sampleChunk.chunkIndex !== chunkIndex ||
				sampleChunk.chunkId !== runChunk.chunkId ||
				sampleChunk.content !== runChunk.content
			) {
				throw new Error(`notice broad sample chunk mismatch: ${notice.noticeId}:${chunkIndex}`);
			}
		}
		return { ...notice, chunks: orderedSampleChunks };
	});
	return { censusBytes, notices, sampleBytes };
}

async function loadReviewCandidates(
	artifactRoot: string,
	chunkRun: Sha256Ref,
): Promise<{ bytes: Uint8Array; noticeIds: string[] }> {
	const path = join(
		artifactRoot,
		"notices",
		"chunking",
		"reviews",
		"sha256",
		artifactHex(chunkRun),
		NOTICE_BROAD_REVIEW_ARTIFACT_DIRECTORY,
		"review-candidates.ndjson",
	);
	const bytes = await readFile(path);
	const values = decodeNdjson(bytes, "notice review candidates");
	const noticeIds = [...new Set(
		values.map((value, index) => {
			if (!isRecord(value) || !nonEmptyString(value.noticeId)) {
				throw new Error(`notice review candidate ${index} has invalid noticeId`);
			}
			return value.noticeId;
		}),
	)].sort(compareNoticeIds);
	return { bytes, noticeIds };
}

function decodeBroadSampleNotice(value: unknown, index: number): BroadSampleNotice {
	if (!isRecord(value) || !nonEmptyString(value.noticeId) || !nonEmptyString(value.title)) {
		throw new Error(`notice broad sample record ${index} is invalid`);
	}
	if (!Array.isArray(value.chunks) || value.chunks.length === 0) {
		throw new Error(`notice broad sample record ${index} has no chunks`);
	}
	const chunks = value.chunks.map((raw, chunkIndex) => {
		if (!isRecord(raw) || !isSha256Ref(raw.chunkId) || !nonEmptyString(raw.content)) {
			throw new Error(`notice broad sample ${index} chunk ${chunkIndex} is invalid`);
		}
		if (!nonNegativeInteger(raw.chunkIndex)) {
			throw new Error(`notice broad sample ${index} chunk ${chunkIndex} has invalid index`);
		}
		return {
			chunkId: raw.chunkId,
			chunkIndex: raw.chunkIndex,
			content: raw.content,
		};
	});
	if (value.primaryStratum !== undefined && !nonEmptyString(value.primaryStratum)) {
		throw new Error(`notice broad sample record ${index} has invalid primary stratum`);
	}
	return {
		chunks,
		noticeId: value.noticeId,
		...(value.primaryStratum !== undefined ? { primaryStratum: value.primaryStratum } : {}),
		title: value.title,
	};
}

function decodeNdjson(bytes: Uint8Array, label: string): unknown[] {
	const text = Buffer.from(bytes).toString("utf8");
	const lines = text.split("\n").filter((line) => line.trim() !== "");
	return lines.map((line, index) => {
		try {
			return JSON.parse(line) as unknown;
		} catch (error) {
			throw new Error(`${label} record ${index} is not valid JSON`, { cause: error });
		}
	});
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	try {
		return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
	} catch (error) {
		throw new Error(`${label} is not valid JSON`, { cause: error });
	}
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

function normalizeModelBaseUrl(raw: string): string {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new Error("LLM_BASE_URL must be an absolute HTTP(S) URL");
	}
	if (
		(parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
		parsed.username ||
		parsed.password ||
		parsed.search ||
		parsed.hash
	) {
		throw new Error("LLM_BASE_URL must be a credential-free HTTP(S) URL");
	}
	return parsed.toString().replace(/\/+$/u, "");
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
	const value = env[key]?.trim();
	if (!value) throw new Error(`${key} is required for notice question generation`);
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

function isSha256Ref(value: unknown): value is Sha256Ref {
	return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function compareNoticeIds(left: string, right: string): number {
	try {
		const leftNumber = BigInt(left);
		const rightNumber = BigInt(right);
		return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
	} catch {
		return left.localeCompare(right);
	}
}
