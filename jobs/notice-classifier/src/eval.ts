import {
	type NoticeLabel,
	NoticeLabelCategorySchema,
	NoticeLabelIntentSchema,
} from "campus-contracts/notices";
import { classifyNoticeByLane } from "notice-classifier-core/lanes";

import { classifyNotice, NoticeClassificationInvalidOutputError } from "./classifier.ts";
import type { NoticeModelClassifier } from "./classifier.ts";
import { mapWithConcurrency } from "./concurrency.ts";
import type { NoticeClassificationInput } from "./job.ts";

/**
 * 标准答案：`rule_lane` 为规则车道标签，`dual_model` 为决策模型与 deepseek 按判定文本一致的标签；
 * `judge` 是模型标签落定时的判定文本版本，规则车道为空。不收人工特判：判不对的改规则或判定文本。
 */
export const NOTICE_EVAL_LABEL_SOURCES = ["rule_lane", "dual_model"] as const;

export interface NoticeEvalGoldLabel extends NoticeLabel {
	judge: string;
	noticeId: number;
	source: (typeof NOTICE_EVAL_LABEL_SOURCES)[number];
}

const GOLD_HEADER = "notice_id\tcategory\tintent\tsource\tjudge";

export function parseNoticeEvalGoldLabels(text: string): NoticeEvalGoldLabel[] {
	const [header, ...lines] = text.replace(/\n$/u, "").split("\n");
	if (header !== GOLD_HEADER) {
		throw new Error(`eval labels must start with: ${GOLD_HEADER}`);
	}
	const seen = new Set<number>();
	return lines.map((line, index) => {
		const [id, category, intent, source, judge, ...rest] = line.split("\t");
		const noticeId = Number(id);
		const sourceValue = NOTICE_EVAL_LABEL_SOURCES.find((value) => value === source);
		const categoryValue = NoticeLabelCategorySchema.safeParse(category);
		const intentValue = NoticeLabelIntentSchema.safeParse(intent);
		if (
			rest.length > 0 ||
			!/^[1-9][0-9]*$/u.test(id ?? "") ||
			!Number.isSafeInteger(noticeId) ||
			seen.has(noticeId) ||
			!sourceValue ||
			!categoryValue.success ||
			!intentValue.success ||
			judge === undefined ||
			(sourceValue === "rule_lane") !== (judge === "")
		) {
			throw new Error(`invalid eval label on line ${index + 2}: ${line}`);
		}
		seen.add(noticeId);
		return {
			category: categoryValue.data,
			intent: intentValue.data,
			judge,
			noticeId,
			source: sourceValue,
		};
	});
}

const INPUT_HEADER = "notice_id\tnotice_type\tnotice_type_name\ttitle";

/** 评测输入：判定标准答案时的通知栏目与标题，与本地数据库无关，所有开发者跑同一份输入。 */
export function parseNoticeEvalInputs(text: string): NoticeClassificationInput[] {
	const [header, ...lines] = text.replace(/\n$/u, "").split("\n");
	if (header !== INPUT_HEADER) {
		throw new Error(`eval inputs must start with: ${INPUT_HEADER}`);
	}
	const seen = new Set<number>();
	return lines.map((line, index) => {
		const [id, type, typeName, title, ...rest] = line.split("\t");
		const noticeId = Number(id);
		const noticeType = Number(type);
		if (
			rest.length > 0 ||
			!/^[1-9][0-9]*$/u.test(id ?? "") ||
			!/^[1-9][0-9]*$/u.test(type ?? "") ||
			!Number.isSafeInteger(noticeId) ||
			seen.has(noticeId) ||
			!typeName ||
			!title
		) {
			throw new Error(`invalid eval input on line ${index + 2}: ${line}`);
		}
		seen.add(noticeId);
		return { noticeId, noticeTitle: title, noticeType, noticeTypeName: typeName };
	});
}

/**
 * `sampling`：重跑后多数票回到标准答案，是单次采样波动；`consistent`：多数票仍偏离，需要回看规则、
 * 判定文本或标准答案本身。规则车道是确定性的，不重跑。
 */
export type NoticeEvalDiffKind = "rule" | "sampling" | "consistent" | "invalid_output";

export interface NoticeEvalDiff {
	actual: NoticeLabel | null;
	expected: NoticeEvalGoldLabel;
	input: NoticeClassificationInput;
	kind: NoticeEvalDiffKind;
	lane: "rule" | "model";
	votes: Record<string, number>;
}

export interface NoticeEvalCounts {
	category: number;
	label: number;
	intent: number;
	total: number;
}

export interface NoticeEvalResult {
	bySource: Record<NoticeEvalGoldLabel["source"], NoticeEvalCounts>;
	diffs: NoticeEvalDiff[];
	lanes: { model: NoticeEvalCounts; rule: NoticeEvalCounts };
	missing: number[];
	overall: NoticeEvalCounts;
}

export interface NoticeEvalOptions {
	classifyWithModel: NoticeModelClassifier | null;
	concurrency: number;
	gold: readonly NoticeEvalGoldLabel[];
	inputs: readonly NoticeClassificationInput[];
	onProgress?: (processed: number, total: number) => void;
	repeats: number;
	/** 无效输出与可重试错误沿用生产分类的重试间隔；测试可注入。 */
	sleep?: (delayMs: number) => Promise<void>;
}

/** 不写数据库：只按标准答案比较当前规则车道与模型的输出。`classifyWithModel` 为空时只评规则车道。 */
export async function runNoticeClassificationEval(
	options: NoticeEvalOptions,
): Promise<NoticeEvalResult> {
	const inputs = new Map(options.inputs.map((input) => [input.noticeId, input]));
	const missing = options.gold.filter((gold) => !inputs.has(gold.noticeId)).map((g) => g.noticeId);
	const cases = options.gold.flatMap((gold) => {
		const input = inputs.get(gold.noticeId);
		if (!input) return [];
		const ruled = classifyNoticeByLane(input.noticeType, input.noticeTitle);
		if (!ruled && !options.classifyWithModel) return [];
		return [{ gold, input, ruled }];
	});
	const model = options.classifyWithModel;
	let processed = 0;
	const outcomes = await mapWithConcurrency(cases, options.concurrency, async ({ gold, input, ruled }) => {
		let actual: NoticeLabel | null = ruled;
		if (!actual && model) {
			actual = await classifyOrInvalid(input, model, options.sleep);
		}
		processed += 1;
		options.onProgress?.(processed, cases.length);
		return { actual, gold, input, lane: ruled ? ("rule" as const) : ("model" as const) };
	});

	const empty = (): NoticeEvalCounts => ({ category: 0, intent: 0, label: 0, total: 0 });
	const overall = empty();
	const lanes = { model: empty(), rule: empty() };
	const bySource = { dual_model: empty(), rule_lane: empty() };
	const pending: (typeof outcomes)[number][] = [];
	for (const outcome of outcomes) {
		const { actual, gold } = outcome;
		for (const counts of [overall, lanes[outcome.lane], bySource[gold.source]]) {
			counts.total += 1;
			if (actual?.category === gold.category) counts.category += 1;
			if (actual?.intent === gold.intent) counts.intent += 1;
			if (sameLabel(actual, gold)) counts.label += 1;
		}
		if (!sameLabel(actual, gold)) pending.push(outcome);
	}

	const diffs = await mapWithConcurrency(pending, options.concurrency, async (outcome) => {
		const votes: Record<string, number> = {};
		const vote = (label: NoticeLabel | null) => {
			const key = label ? labelKey(label) : "invalid_output";
			votes[key] = (votes[key] ?? 0) + 1;
		};
		vote(outcome.actual);
		let kind: NoticeEvalDiffKind = "rule";
		if (outcome.lane === "model" && model) {
			for (let attempt = 0; attempt < options.repeats; attempt += 1) {
				vote(await classifyOrInvalid(outcome.input, model, options.sleep));
			}
			const total = options.repeats + 1;
			kind =
				(votes[labelKey(outcome.gold)] ?? 0) * 2 > total
					? "sampling"
					: (votes.invalid_output ?? 0) * 2 > total
						? "invalid_output"
						: "consistent";
		}
		return { ...outcome, expected: outcome.gold, kind, votes };
	});
	return {
		bySource,
		diffs: diffs
			.map(({ actual, expected, input, kind, lane, votes }) => ({
				actual,
				expected,
				input,
				kind,
				lane,
				votes,
			}))
			.sort((left, right) => left.input.noticeId - right.input.noticeId),
		lanes,
		missing,
		overall,
	};
}

async function classifyOrInvalid(
	input: NoticeClassificationInput,
	model: NoticeModelClassifier,
	sleep: NoticeEvalOptions["sleep"],
): Promise<NoticeLabel | null> {
	try {
		return await (sleep ? classifyNotice(input, model, sleep) : classifyNotice(input, model));
	} catch (error) {
		if (error instanceof Error && error.cause instanceof NoticeClassificationInvalidOutputError) {
			return null;
		}
		throw error;
	}
}

function sameLabel(actual: NoticeLabel | null, expected: NoticeLabel): boolean {
	return actual?.category === expected.category && actual.intent === expected.intent;
}

export function labelKey(label: NoticeLabel): string {
	return `${label.category}/${label.intent}`;
}

/** 差异清单列名写明期望与实际，避免对比时看反。 */
export function formatNoticeEvalDiffs(diffs: readonly NoticeEvalDiff[]): string {
	const rows = diffs.map((diff) =>
		[
			diff.input.noticeId,
			diff.lane,
			diff.kind,
			diff.expected.source,
			labelKey(diff.expected),
			diff.actual ? labelKey(diff.actual) : "invalid_output",
			JSON.stringify(diff.votes),
			diff.input.noticeTypeName,
			diff.input.noticeTitle.replaceAll(/\s+/gu, " "),
		].join("\t"),
	);
	return `${["notice_id", "lane", "kind", "expected_source", "expected", "actual", "votes", "notice_type", "title"].join("\t")}\n${rows.map((row) => `${row}\n`).join("")}`;
}
