import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
	type NoticeLabelCategory,
	NoticeLabelCategorySchema,
	type NoticeLabelIntent,
	NoticeLabelIntentSchema,
} from "campus-contracts/notices";
import { formatRawError } from "ingestion-contracts/raw-error";
import { NOTICE_JUDGE_VERSION } from "notice-classifier-core/model";

import {
	formatNoticeEvalDiffs,
	type NoticeEvalGoldLabel,
	parseNoticeEvalGoldLabels,
	parseNoticeEvalInputs,
	runNoticeClassificationEval,
} from "./eval.ts";
import { DEFAULT_NOTICE_CLASSIFICATION_CONCURRENCY } from "./job.ts";
import {
	LOCAL_NOTICE_CLASSIFIER_MODEL_CONFIG_URL,
	loadLocalNoticeClassifierEnvironment,
} from "./local-cli.ts";
import {
	createNoticeClassifierFromRuntimeConfig,
	resolveNoticeClassifierRuntimeConfig,
} from "./model.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
export const NOTICE_EVAL_LABELS_PATH = path.resolve(import.meta.dirname, "../eval/labels.tsv");
export const NOTICE_EVAL_INPUTS_PATH = path.resolve(import.meta.dirname, "../eval/titles.tsv");
export const NOTICE_EVAL_OUTPUT_ROOT = path.join(REPO_ROOT, "var/notices/classification/evaluations");

const BACKENDS = {
	decision: "notice_classification_decision",
	llm: "notice_classification_llm",
	rules: null,
} as const;

/**
 * 差异重跑次数按后端区分：决策模型同一输入的输出是确定的（0.3.28 至 0.3.33 的 17 条差异重跑 6 次全部
 * 一致），重跑只付费不提供信息；LLM 有采样波动，重跑区分 sampling 与 consistent。
 */
const DEFAULT_REPEATS = { decision: 0, llm: 5, rules: 0 } as const;

/** 只评标准答案的一部分；各条件同时生效，按期望标签筛选。 */
export interface NoticeEvalSelection {
	categories?: NoticeLabelCategory[];
	intents?: NoticeLabelIntent[];
	noticeIds?: number[];
}

export interface NoticeEvalCliOptions {
	backend: keyof typeof BACKENDS;
	concurrency: number;
	modelConfigUrl: string | undefined;
	repeats: number;
	selection: NoticeEvalSelection;
}

const USAGE =
	"Usage: notice-classifier-eval --backend <decision|llm|rules> [--notice-ids <id,...>] [--categories <category,...>] [--intents <intent,...>] [--repeats <non-negative-integer>] [--concurrency <positive-integer>] [--model-config-url <url>]";

export function parseNoticeEvalOptions(argv: readonly string[]): NoticeEvalCliOptions {
	let backend: NoticeEvalCliOptions["backend"] | undefined;
	let concurrency = DEFAULT_NOTICE_CLASSIFICATION_CONCURRENCY;
	let repeats: number | undefined;
	let modelConfigUrl: string | undefined;
	const selection: NoticeEvalSelection = {};
	for (let index = 0; index < argv.length; index += 2) {
		const [argument, value] = [argv[index], argv[index + 1]];
		if (value === undefined) throw new Error(USAGE);
		if (argument === "--backend" && Object.hasOwn(BACKENDS, value)) {
			backend = value as NoticeEvalCliOptions["backend"];
		} else if (argument === "--repeats" && /^[0-9]+$/u.test(value)) {
			repeats = Number(value);
		} else if (argument === "--concurrency" && /^[1-9][0-9]*$/u.test(value)) {
			concurrency = Number(value);
		} else if (argument === "--model-config-url") {
			modelConfigUrl = value.replace(/\/$/u, "");
		} else if (argument === "--notice-ids" && /^[1-9][0-9]*(,[1-9][0-9]*)*$/u.test(value)) {
			selection.noticeIds = value.split(",").map(Number);
		} else if (argument === "--categories") {
			selection.categories = parseList(value, (item) => NoticeLabelCategorySchema.parse(item));
		} else if (argument === "--intents") {
			selection.intents = parseList(value, (item) => NoticeLabelIntentSchema.parse(item));
		} else {
			throw new Error(USAGE);
		}
	}
	if (!backend) throw new Error(USAGE);
	return {
		backend,
		concurrency,
		modelConfigUrl,
		repeats: repeats ?? DEFAULT_REPEATS[backend],
		selection,
	};
}

function parseList<Value>(value: string, parse: (item: string) => Value): Value[] {
	try {
		return value.split(",").map(parse);
	} catch {
		throw new Error(USAGE);
	}
}

/** 指定的通知 ID 必须都在标准答案里，避免拼错 ID 时静默少评。 */
export function selectNoticeEvalGold(
	gold: readonly NoticeEvalGoldLabel[],
	selection: NoticeEvalSelection,
): NoticeEvalGoldLabel[] {
	const known = new Set(gold.map((label) => label.noticeId));
	const unknown = selection.noticeIds?.filter((id) => !known.has(id)) ?? [];
	if (unknown.length > 0) {
		throw new Error(`notice ids not in eval labels: ${unknown.join(",")}`);
	}
	return gold.filter(
		(label) =>
			(selection.noticeIds?.includes(label.noticeId) ?? true) &&
			(selection.categories?.includes(label.category) ?? true) &&
			(selection.intents?.includes(label.intent) ?? true),
	);
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
	const options = parseNoticeEvalOptions(argv);
	if (options.backend !== "rules" && !options.modelConfigUrl && !process.env.MODEL_CONFIG_URL) {
		loadLocalNoticeClassifierEnvironment();
	}
	const gold = selectNoticeEvalGold(
		parseNoticeEvalGoldLabels(readFileSync(NOTICE_EVAL_LABELS_PATH, "utf8")),
		options.selection,
	);
	const configName = BACKENDS[options.backend];
	const runtime = configName
		? await resolveNoticeClassifierRuntimeConfig(
				fetch,
				options.modelConfigUrl ?? process.env.MODEL_CONFIG_URL ?? LOCAL_NOTICE_CLASSIFIER_MODEL_CONFIG_URL,
				configName,
			)
		: null;
	const inputs = parseNoticeEvalInputs(readFileSync(NOTICE_EVAL_INPUTS_PATH, "utf8"));
	const startedAt = new Date();
	const result = await runNoticeClassificationEval({
		classifyWithModel: runtime ? createNoticeClassifierFromRuntimeConfig(runtime) : null,
		concurrency: options.concurrency,
		gold,
		inputs,
		onProgress: (processed, total) => {
			if (processed % 200 === 0 || processed === total) {
				console.error(JSON.stringify({ progress: { processed, total }, status: "running" }));
			}
		},
		repeats: options.repeats,
	});
	const summary = {
		backend: options.backend,
		bySource: result.bySource,
		diffKinds: Object.fromEntries(
			["rule", "sampling", "consistent", "invalid_output"].map((kind) => [
				kind,
				result.diffs.filter((diff) => diff.kind === kind).length,
			]),
		),
		finishedAt: new Date().toISOString(),
		judge: NOTICE_JUDGE_VERSION,
		lanes: result.lanes,
		missing: result.missing,
		model: runtime ? { model: runtime.model, name: runtime.name, protocol: runtime.protocol } : null,
		overall: result.overall,
		repeats: options.repeats,
		selection: options.selection,
		startedAt: startedAt.toISOString(),
	};
	const directory = path.join(
		NOTICE_EVAL_OUTPUT_ROOT,
		`${startedAt.toISOString().replaceAll(/[:.]/gu, "-")}-judge-${NOTICE_JUDGE_VERSION}-${options.backend}`,
	);
	mkdirSync(directory, { recursive: true });
	writeFileSync(path.join(directory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
	writeFileSync(path.join(directory, "diffs.tsv"), formatNoticeEvalDiffs(result.diffs));
	process.stdout.write(`${JSON.stringify({ output: path.relative(REPO_ROOT, directory), summary })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main().catch((error) => {
		console.error(formatRawError(error));
		process.exitCode = 1;
	});
}
