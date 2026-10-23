import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { NoticeModelClassifier } from "../src/classifier.ts";
import {
	formatNoticeEvalDiffs,
	parseNoticeEvalGoldLabels,
	parseNoticeEvalInputs,
	runNoticeClassificationEval,
} from "../src/eval.ts";
import {
	NOTICE_EVAL_INPUTS_PATH,
	NOTICE_EVAL_LABELS_PATH,
	parseNoticeEvalOptions,
	selectNoticeEvalGold,
} from "../src/eval-cli.ts";
import { PORTAL_NOTICE_TYPES } from "notice-classifier-core/lanes";

import { NoticeClassificationInvalidOutputError } from "../src/classifier.ts";

const HEADER = "notice_id\tcategory\tintent\tsource\tjudge";
// 留学标题跨栏目走规则车道，其余进模型车道。
const STUDY_ABROAD = {
	noticeId: 1,
	noticeTitle: "关于2025年国家公派留学项目拟录取名单的公示",
	noticeType: PORTAL_NOTICE_TYPES.announcement,
	noticeTypeName: "公示公告",
};
const STUDY_ROOM = { noticeId: 2, noticeTitle: "关于开放海淀校区有声自习室的通知", noticeType: 5, noticeTypeName: "办公通知" };
const REPORTING = { noticeId: 3, noticeTitle: "关于进一步加强信息报送工作的通知", noticeType: 5, noticeTypeName: "办公通知" };

describe("notice classification eval labels", () => {
	it("parses the committed labels", () => {
		const labels = parseNoticeEvalGoldLabels(readFileSync(NOTICE_EVAL_LABELS_PATH, "utf8"));
		expect(labels.length).toBeGreaterThan(3000);
		expect(new Set(labels.map((label) => label.source))).toEqual(
			new Set(["rule_lane", "dual_model"]),
		);
	});

	it("has an input row for every label and the rule lane reproduces its labels", async () => {
		const labels = parseNoticeEvalGoldLabels(readFileSync(NOTICE_EVAL_LABELS_PATH, "utf8"));
		const inputs = parseNoticeEvalInputs(readFileSync(NOTICE_EVAL_INPUTS_PATH, "utf8"));
		const result = await runNoticeClassificationEval({
			classifyWithModel: null,
			concurrency: 1,
			gold: labels,
			inputs,
			repeats: 0,
		});
		expect(result.missing).toEqual([]);
		expect(result.overall.total).toBe(labels.filter((label) => label.source === "rule_lane").length);
		expect(result.diffs).toEqual([]);
	});

	it.each([
		["a wrong input header", "id\tnotice_type\tnotice_type_name\ttitle\n"],
		["an input without a title", "notice_id\tnotice_type\tnotice_type_name\ttitle\n1\t5\t办公通知\t\n"],
	])("rejects %s", (_name, text) => {
		expect(() => parseNoticeEvalInputs(text)).toThrow();
	});

	it.each([
		["a wrong header", "id\tcategory\tintent\tsource\tjudge\n"],
		["an unknown category", `${HEADER}\n1\tnotices\taction\tdual_model\t0.2.45\n`],
		["a duplicate notice", `${HEADER}\n1\tnews\tresult\tdual_model\t0.2.45\n1\tnews\tresult\tdual_model\t0.2.45\n`],
		["a manual label", `${HEADER}\n1\tnews\tresult\thuman\t0.2.45\n`],
		["a rule lane label with a judge version", `${HEADER}\n1\tnews\tresult\trule_lane\t0.2.45\n`],
		["a model label without a judge version", `${HEADER}\n1\tnews\tresult\tdual_model\t\n`],
	])("rejects %s", (_name, text) => {
		expect(() => parseNoticeEvalGoldLabels(text)).toThrow();
	});
});

describe("notice classification eval", () => {
	const gold = parseNoticeEvalGoldLabels(
		[
			HEADER,
			"1\tinternational\tresult\trule_lane\t",
			"2\tservice_info\taction\tdual_model\t0.2.30",
			"3\tgovernance\taction\tdual_model\t0.2.42",
			"4\tnews\tresult\tdual_model\t0.2.45",
		].join("\n"),
	);

	it("separates sampling flips from consistent misses and reports missing notices", async () => {
		const reportingAnswers = ["reference", "action", "action", "reference"];
		const model: NoticeModelClassifier = async (input) =>
			input.noticeTitle === STUDY_ROOM.noticeTitle
				? { category: "service_info", intent: "reference" }
				: { category: "governance", intent: reportingAnswers.shift() as "action" | "reference" };

		const result = await runNoticeClassificationEval({
			classifyWithModel: model,
			concurrency: 1,
			gold,
			inputs: [STUDY_ABROAD, STUDY_ROOM, REPORTING],
			repeats: 3,
		});

		expect(result.missing).toEqual([4]);
		expect(result.overall).toEqual({ category: 3, intent: 1, label: 1, total: 3 });
		expect(result.lanes.rule).toEqual({ category: 1, intent: 1, label: 1, total: 1 });
		expect(result.bySource.dual_model).toEqual({ category: 2, intent: 0, label: 0, total: 2 });
		expect(result.diffs.map(({ input, kind, votes }) => [input.noticeId, kind, votes])).toEqual([
			[2, "consistent", { "service_info/reference": 4 }],
			[3, "consistent", { "governance/reference": 2, "governance/action": 2 }],
		]);
		const report = formatNoticeEvalDiffs(result.diffs);
		expect(report.split("\n")[0]).toBe(
			"notice_id\tlane\tkind\texpected_source\texpected\tactual\tvotes\tnotice_type\ttitle",
		);
		expect(report).toContain(
			"2\tmodel\tconsistent\tdual_model\tservice_info/action\tservice_info/reference\t",
		);
	});

	it("counts a majority of expected answers on rerun as sampling", async () => {
		const answers = ["reference", "action", "action", "action"];
		const result = await runNoticeClassificationEval({
			classifyWithModel: async () => ({
				category: "governance",
				intent: answers.shift() as "action" | "reference",
			}),
			concurrency: 1,
			gold: gold.filter((label) => label.noticeId === 3),
			inputs: [REPORTING],
			repeats: 3,
		});
		expect(result.diffs.map((diff) => diff.kind)).toEqual(["sampling"]);
	});

	it("keeps invalid model output as a diff instead of failing the run", async () => {
		const result = await runNoticeClassificationEval({
			classifyWithModel: async () => {
				throw new NoticeClassificationInvalidOutputError("bad", { rawResponse: "{}" });
			},
			concurrency: 1,
			gold: gold.filter((label) => label.noticeId === 3),
			inputs: [REPORTING],
			repeats: 0,
			sleep: async () => {},
		});
		expect(result.diffs.map((diff) => [diff.kind, diff.actual])).toEqual([["invalid_output", null]]);
	});

	it("evaluates only the rule lane without a model", async () => {
		const result = await runNoticeClassificationEval({
			classifyWithModel: null,
			concurrency: 1,
			gold,
			inputs: [STUDY_ABROAD, STUDY_ROOM, REPORTING],
			repeats: 5,
		});
		expect(result.overall.total).toBe(1);
		expect(result.diffs).toEqual([]);
	});
});

describe("notice classification eval options", () => {
	it("requires a backend and reruns diffs only for the sampling backend by default", () => {
		expect(parseNoticeEvalOptions(["--backend", "decision"])).toEqual({
			backend: "decision",
			concurrency: 8,
			modelConfigUrl: undefined,
			repeats: 0,
			selection: {},
		});
		expect(parseNoticeEvalOptions(["--backend", "llm"]).repeats).toBe(5);
		expect(parseNoticeEvalOptions(["--backend", "decision", "--repeats", "2"]).repeats).toBe(2);
		expect(() => parseNoticeEvalOptions([])).toThrow("Usage");
		expect(() => parseNoticeEvalOptions(["--backend", "gemini"])).toThrow("Usage");
	});

	it("parses a subset of notice ids, categories and intents", () => {
		expect(
			parseNoticeEvalOptions([
				"--backend",
				"llm",
				"--notice-ids",
				"2,3",
				"--categories",
				"governance,affairs",
				"--intents",
				"action",
			]).selection,
		).toEqual({ categories: ["governance", "affairs"], intents: ["action"], noticeIds: [2, 3] });
		expect(() => parseNoticeEvalOptions(["--backend", "llm", "--notice-ids", "2,x"])).toThrow("Usage");
		expect(() => parseNoticeEvalOptions(["--backend", "llm", "--categories", "notices"])).toThrow(
			"Usage",
		);
	});

	it("selects gold labels by every given condition and rejects unknown ids", () => {
		const gold = parseNoticeEvalGoldLabels(
			[
				HEADER,
				"2\tservice_info\taction\tdual_model\t0.2.30",
				"3\tgovernance\taction\tdual_model\t0.2.42",
				"4\tgovernance\tnotice\tdual_model\t0.2.45",
			].join("\n"),
		);
		const ids = (selection: Parameters<typeof selectNoticeEvalGold>[1]) =>
			selectNoticeEvalGold(gold, selection).map((label) => label.noticeId);
		expect(ids({})).toEqual([2, 3, 4]);
		expect(ids({ categories: ["governance"] })).toEqual([3, 4]);
		expect(ids({ categories: ["governance"], intents: ["action"] })).toEqual([3]);
		expect(ids({ noticeIds: [2, 4], intents: ["action"] })).toEqual([2]);
		expect(() => ids({ noticeIds: [9] })).toThrow("9");
	});
});
