import {
	NOTICE_LABEL_CATEGORIES,
	NOTICE_LABEL_INTENTS,
	type NoticeLabel,
} from "campus-contracts/notices";
import { z } from "zod";
import { NoticeClassificationInvalidOutputError } from "./classifier.ts";
import judge from "./notice-judge.json" with { type: "json" };

/**
 * 判定文本：类别定义、intent 判据、易混组合裁决与 news 泄漏防护。LLM 的系统提示与决策模型的两个
 * choice 问题都由它生成，生成方式与模型车道试标一致。改动按版本号递增，见
 * `.agents/notes/proposed/feature/2026-10-21-notice-classification-redesign.md`。
 */
interface NoticeJudge {
	version: string;
	role: string;
	output_format: { description: string; category_enum: string[]; intent_enum: string[] };
	input_description: string;
	judgment_order: string;
	general_principle: string;
	step1_category: {
		instruction: string;
		categories: Record<string, JudgeText>;
		notice_type_prior: { instruction: string; rules: NoticeTypePrior[] };
	};
	/** intent 判据不按标题裁剪：五个 intent 的对照分散在各条特例里，决策模型每次收到全文。 */
	step2_intent: { instruction: string; intents: Record<string, string> };
	category_boundary_rules: { instruction: string; rules: NoticeBoundaryRule[] };
	news_leakage_guard: { instruction: string; guards: (string | GatedClause)[] };
}

/** 栏目说明按栏目名分条；决策模型只收到本条通知所在栏目的一条，栏目不在表中时不收说明。 */
interface NoticeTypePrior {
	notice_types: string[];
	text: string;
}

/**
 * 决策模型没有提示缓存、按输入计费，判定文本按标题拼装：带 `title_signal` 的条款只在标题命中该正则时发给
 * 决策模型，纯字符串条款每次都发。并列清单（`items`）逐项判断，一项都不命中时连同前后缀一起省略。LLM
 * 系统提示走提示缓存，始终按原顺序拼回全文。
 */
type JudgeText = string | JudgeClause[];
type JudgeClause =
	| string
	| GatedClause
	| { prefix?: string; items: (string | GatedClause)[]; suffix: string };

interface GatedClause {
	text: string;
	title_signal: string;
}

/** 易混裁决整条的 `title_signal` 不命中时不发；命中后裁决内部的条款再按各自的信号拼装。 */
interface NoticeBoundaryRule {
	pair: string;
	title_signal?: string;
	verdict: JudgeText;
}

const NOTICE_JUDGE: NoticeJudge = judge;

const signalCache = new Map<string, RegExp>();

function signalMatches(signal: string, title: string): boolean {
	let pattern = signalCache.get(signal);
	if (!pattern) {
		pattern = new RegExp(signal, "u");
		signalCache.set(signal, pattern);
	}
	return pattern.test(title);
}

/** `title` 为空时拼回全文，用于 LLM 系统提示。 */
function renderJudgeText(text: JudgeText, title: string | null): string {
	if (typeof text === "string") {
		return text;
	}
	const kept = (clause: string | GatedClause) =>
		typeof clause === "string" || title === null || signalMatches(clause.title_signal, title);
	const plain = (clause: string | GatedClause) =>
		typeof clause === "string" ? clause : clause.text;
	// 省掉的条款以句号收尾时，前面保留的文本补成句号结尾，句子不会断在分号或半句上。
	const closeSentence = (text: string) =>
		text === "" || text.endsWith("。") ? text : `${text.replace(/[；，、]$/u, "")}。`;
	let rendered = "";
	for (const clause of text) {
		let piece: string;
		let original: string;
		if (typeof clause === "string" || "text" in clause) {
			original = plain(clause);
			piece = kept(clause) ? original : "";
		} else {
			original = clause.suffix;
			const items = clause.items.filter(kept).map(plain);
			const body = items.join("");
			piece =
				items.length === 0
					? ""
					: `${clause.prefix ?? ""}${
							items.length === clause.items.length ? body : body.replace(/(，?以及|、|，)$/u, "")
						}${clause.suffix}`;
		}
		rendered = piece === "" && original.endsWith("。") ? closeSentence(rendered) : rendered + piece;
	}
	return rendered.replace(/；$/u, "。");
}

export const NOTICE_JUDGE_VERSION = NOTICE_JUDGE.version;

/** 判定文本里的类别顺序；提示、schema 与决策模型选项都按此顺序，与试标请求一致。 */
const JUDGE_CATEGORIES = judgeEnum(
	NOTICE_JUDGE.output_format.category_enum,
	NOTICE_LABEL_CATEGORIES,
);
const JUDGE_INTENTS = judgeEnum(NOTICE_JUDGE.output_format.intent_enum, NOTICE_LABEL_INTENTS);

/** 模型只看到标题与门户栏目名；栏目只作形式参考，判据见判定文本的 `notice_type_prior`。 */
export interface NoticeModelInput {
	noticeTitle: string;
	noticeTypeName: string;
}

export const NoticeClassifierModelOutputSchema = z
	.object({
		category: z.enum(NOTICE_LABEL_CATEGORIES),
		intent: z.enum(NOTICE_LABEL_INTENTS),
	})
	.strict();

export const NOTICE_CLASSIFIER_SYSTEM_PROMPT = buildSystemPrompt(NOTICE_JUDGE);

export function noticeClassificationJSONSchema(): Record<string, unknown> {
	return {
		additionalProperties: false,
		properties: {
			category: { enum: [...JUDGE_CATEGORIES], type: "string" },
			intent: { enum: [...JUDGE_INTENTS], type: "string" },
		},
		required: ["category", "intent"],
		type: "object",
	};
}

export function toModelUserMessage(input: NoticeModelInput): string {
	return `notice_type：${input.noticeTypeName}\n标题：${input.noticeTitle}`;
}

export function toSystemOneState(input: NoticeModelInput): Record<string, string> {
	return { notice_title: input.noticeTitle, notice_type: input.noticeTypeName };
}

export interface SystemOneChoiceQuestion {
	criteria: Record<string, string>;
	instructions: string;
	type: "choice";
}

const buildSystemOneQuestions = systemOneQuestionBuilder(NOTICE_JUDGE);

/** 决策模型没有提示缓存、按输入计费，每条通知按标题与栏目拼装判定文本。 */
export function toSystemOneQuestions(
	input: NoticeModelInput,
): Record<"category" | "intent", SystemOneChoiceQuestion> {
	return buildSystemOneQuestions(input);
}

export function parseNoticeModelOutput(value: string): NoticeLabel {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch (error) {
		throw new NoticeClassificationInvalidOutputError(
			`model returned invalid classification JSON: ${value}`,
			{ cause: error, rawResponse: value },
		);
	}
	const result = NoticeClassifierModelOutputSchema.safeParse(parsed);
	if (!result.success) {
		throw new NoticeClassificationInvalidOutputError(
			`model returned an invalid classification: ${value}`,
			{ rawResponse: value },
		);
	}
	return result.data;
}

function buildSystemPrompt(j: NoticeJudge): string {
	const step1 = j.step1_category;
	return [
		j.role,
		`输入说明：${j.input_description}`,
		`输出格式：${j.output_format.description}`,
		`判定顺序：${j.judgment_order}`,
		`总原则：${j.general_principle}`,
		"",
		"【第1步：判断 category】",
		step1.instruction,
		...Object.entries(step1.categories).map(
			([category, text]) => `- ${category}：${renderJudgeText(text, null)}`,
		),
		"",
		step1.notice_type_prior.instruction,
		...step1.notice_type_prior.rules.map((rule) => `- ${rule.text}`),
		"",
		"【第2步：判断 intent】",
		j.step2_intent.instruction,
		...Object.entries(j.step2_intent.intents).map(([intent, text]) => `- ${intent}：${text}`),
		"",
		"【易混组合裁决】",
		j.category_boundary_rules.instruction,
		...j.category_boundary_rules.rules.map(
			(rule) => `- ${rule.pair}：${renderJudgeText(rule.verdict, null)}`,
		),
		"",
		"【news 泄漏防护】",
		j.news_leakage_guard.instruction,
		...j.news_leakage_guard.guards.map((guard) => `- ${renderJudgeText([guard], null)}`),
	].join("\n");
}

/**
 * 每类判据是按标题拼装的类别定义；news 另加按标题命中的泄漏防护；intent 判据发全文。总则、栏目说明与标题命中的易混裁决只在
 * category 问题的 instructions 里发一次，不按点名的类别复制。输入说明讲的是规则筛选与栏目分布，决策模型
 * 不需要；栏目说明只发本栏目的一条，主栏目没有说明。
 */
function systemOneQuestionBuilder(
	j: NoticeJudge,
): (input: NoticeModelInput) => Record<"category" | "intent", SystemOneChoiceQuestion> {
	const priors = j.step1_category.notice_type_prior.rules;
	const definitions = JUDGE_CATEGORIES.map((category) => {
		const definition = j.step1_category.categories[category];
		if (!definition) {
			throw new Error(`judge text has no definition for ${category}`);
		}
		return [category, definition] as const;
	});
	const intentInstructions = [
		"判断这条校园通知要读者做什么 intent，只能选择一个选项。",
		j.step2_intent.instruction,
	].join("\n");
	return ({ noticeTitle: title, noticeTypeName }) => {
		const columnPriors = priors
			.filter((rule) => rule.notice_types.includes(noticeTypeName))
			.map((rule) => `- ${rule.text}`);
		const boundaries = j.category_boundary_rules.rules
			.filter((rule) => rule.title_signal === undefined || signalMatches(rule.title_signal, title))
			.map((rule) => [rule.pair, renderJudgeText(rule.verdict, title)] as const)
			.filter(([, verdict]) => verdict !== "")
			.map(([pair, verdict]) => `${pair}：${verdict}`);
		const guards = j.news_leakage_guard.guards
			.map((guard) => renderJudgeText([guard], title))
			.filter((guard) => guard !== "");
		const newsGuard =
			guards.length > 0 ? `\n${j.news_leakage_guard.instruction}${guards.join("")}` : "";
		const categoryInstructions = [
			"判断这条校园通知的业务主题 category，只能选择一个选项。",
			j.general_principle,
			columnPriors.length > 0
				? j.step1_category.notice_type_prior.instruction
				: j.step1_category.notice_type_prior.instruction.replace(/：$/u, "。"),
			...columnPriors,
			...(boundaries.length > 0 ? ["易混裁决：", ...boundaries.map((text) => `- ${text}`)] : []),
		].join("\n");
		const criteria = Object.fromEntries(
			definitions.map(([category, definition]) => {
				const text = renderJudgeText(definition, title);
				return [category, category === "news" ? `${text}${newsGuard}` : text];
			}),
		);
		return {
			category: { criteria, instructions: categoryInstructions, type: "choice" },
			intent: {
				criteria: j.step2_intent.intents,
				instructions: intentInstructions,
				type: "choice",
			},
		};
	};
}

function judgeEnum<Value extends string>(
	values: readonly string[],
	contract: readonly Value[],
): readonly Value[] {
	const allowed = new Set<string>(contract);
	if (values.length !== contract.length || !values.every((value) => allowed.has(value))) {
		throw new Error(
			`judge text enum does not match the notice label contract: ${values.join(",")}`,
		);
	}
	return values as Value[];
}
