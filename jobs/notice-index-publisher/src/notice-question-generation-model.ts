import type { ArtifactReference, Sha256Ref } from "./types.ts";

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
		if (!question || !answer || !chunkRef) {
			throw new Error(`notice generated question ${questionIndex} is invalid`);
		}
		return { answer, chunkRef, question };
	});
	if (new Set(questions.map((question) => question.question)).size !== questions.length) {
		throw new Error("notice generated questions are duplicated");
	}
	return questions;
}

function validateNoticeChunkSelections(
	questions: readonly GeneratedNoticeQuestionSelection[],
	chunkContents: readonly string[],
): void {
	const chunkReferences = new Set(chunkContents.map((_content, chunkIndex) => `chunk-${chunkIndex}`));
	for (const [questionIndex, question] of questions.entries()) {
		if (!chunkReferences.has(question.chunkRef)) {
			throw new Error(
				`notice generated question ${questionIndex} references unknown chunk: ${question.chunkRef}`,
			);
		}
	}
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
