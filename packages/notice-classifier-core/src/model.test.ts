import assert from "node:assert/strict";
import test from "node:test";

import { NOTICE_LABEL_CATEGORIES, NOTICE_LABEL_INTENTS } from "campus-contracts/notices";

import {
	NOTICE_CLASSIFIER_SYSTEM_PROMPT,
	NOTICE_JUDGE_VERSION,
	parseNoticeModelOutput,
	toModelUserMessage,
	toSystemOneQuestions,
	toSystemOneState,
} from "./model.ts";

const INPUT = { noticeTitle: "关于临时关闭校园南门的通知", noticeTypeName: "办公通知" };

test("the model sees the notice title and its portal column", () => {
	assert.equal(
		toModelUserMessage(INPUT),
		"notice_type：办公通知\n标题：关于临时关闭校园南门的通知",
	);
	assert.deepEqual(toSystemOneState(INPUT), {
		notice_title: "关于临时关闭校园南门的通知",
		notice_type: "办公通知",
	});
});

test("the model output is one category and one intent", () => {
	assert.deepEqual(parseNoticeModelOutput('{"category":"service_info","intent":"notice"}'), {
		category: "service_info",
		intent: "notice",
	});
	for (const invalid of [
		'{"category":"service_info"}',
		'{"category":"service_info","intent":"notice","reason":"title"}',
		'{"category":"campus_operations","intent":"notice"}',
		"not-json",
	]) {
		assert.throws(
			() => parseNoticeModelOutput(invalid),
			(error) => error instanceof Error && "rawResponse" in error && error.rawResponse === invalid,
		);
	}
});

test("the prompt carries the judge text for every category and intent", () => {
	assert.match(NOTICE_JUDGE_VERSION, /^0\.3\.[0-9]+$/u);
	for (const value of [...NOTICE_LABEL_CATEGORIES, ...NOTICE_LABEL_INTENTS]) {
		assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, new RegExp(`- ${value}：`, "u"));
	}
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /【易混组合裁决】/u);
	// 宽口径裁决只有 affairs 与 application 的对照每次都发，其余主句已并入类别定义。
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /- affairs vs application：主动争取名额/u);
	assert.doesNotMatch(
		NOTICE_CLASSIFIER_SYSTEM_PROMPT,
		/- governance vs service_info：组织行为与工作部署/u,
	);
});

test("decision-model boundary rules are sent once in the category instructions", () => {
	const tender = toSystemOneQuestions({
		noticeTitle: "关于某研究课题招标的通知",
		noticeTypeName: "科研通知",
	});
	const { category, intent } = tender;
	assert.deepEqual(Object.keys(category.criteria).sort(), [...NOTICE_LABEL_CATEGORIES].sort());
	assert.deepEqual(Object.keys(intent.criteria).sort(), [...NOTICE_LABEL_INTENTS].sort());
	// 标题命中的裁决在 instructions 里只出现一次，不复制到点名的类别下。
	assert.equal(category.instructions.split("procurement vs application").length, 2);
	for (const text of Object.values(category.criteria)) {
		assert.doesNotMatch(text, /procurement vs application/u);
	}

	// 栏目说明只发本栏目的一条，主栏目没有说明。
	assert.match(
		category.instructions,
		/notice_type 只作形式参考，不决定 category。$|。\n易混裁决：/mu,
	);
	assert.doesNotMatch(category.instructions, /- 公示公告|- 学术信息|进入本分类器的标题/u);

	const plain = toSystemOneQuestions({ noticeTitle: "关于某事的通知", noticeTypeName: "办公通知" });
	assert.match(plain.category.instructions, /易混裁决：\n- affairs vs application：[^\n]*$/u);
	const announcement = toSystemOneQuestions({
		noticeTitle: "关于某事的通知",
		noticeTypeName: "公示公告",
	});
	assert.match(announcement.category.instructions, /不决定 category：\n- 公示公告/u);
	// news 泄漏防护按标题拼装，不命中时只发正向定义。
	assert.doesNotMatch(plain.category.criteria.news ?? "", /竞赛身份|不归 news：/u);
	assert.match(plain.category.criteria.news ?? "", /任一机制的，归对应业务类/u);
	const contest = toSystemOneQuestions({
		noticeTitle: "我校学子在某大赛斩获佳绩",
		noticeTypeName: "学工通知",
	});
	assert.match(contest.category.criteria.news ?? "", /以下情况不归 news：标题有竞赛身份/u);
});

test("decision-model category definitions keep only the clauses whose title signal matches", () => {
	const classroom = "关于开设国旗下的“铸牢”课堂的通知";
	const { category } = toSystemOneQuestions({
		noticeTitle: classroom,
		noticeTypeName: "学工通知",
	});
	assert.match(category.criteria.lecture_forum ?? "", /国旗下课堂等参与型思政教育活动/u);

	// intent 判据每次都发全文：五个 intent 的对照分散在各条特例里，只发半边会让决策模型偏向发全的一边。
	const plain = toSystemOneQuestions(INPUT);
	assert.doesNotMatch(plain.category.criteria.lecture_forum ?? "", /国旗下课堂/u);
	assert.match(plain.intent.criteria.event ?? "", /国旗下课堂等定期举行的思政课堂/u);
	assert.match(plain.intent.criteria.action ?? "", /网课的期末考试在一段时间内自行完成/u);
	// 并列清单只留命中的项，前后缀保留。
	assert.match(
		toSystemOneQuestions({ noticeTitle: "关于预算批复的通知", noticeTypeName: "办公通知" }).category
			.criteria.governance ?? "",
		/。预算批复与细化预算上报也属于本类。/u,
	);
	// 清单末项省掉时，保留的最后一项改用句号收尾。
	const library = toSystemOneQuestions({
		noticeTitle: "图书馆元旦放假通知",
		noticeTypeName: "办公通知",
	}).category.criteria.service_info;
	assert.match(library ?? "", /：食堂、超市、浴室、公寓、场馆、图书馆等的开放与关闭。例：/u);
	assert.doesNotMatch(library ?? "", /班车|结核/u);
});

test("the LLM prompt carries every clause regardless of title signals", () => {
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /国旗下课堂等定期举行的思政课堂/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /预算批复与细化预算上报、/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /班车与接驳车，/u);
	assert.ok(
		JSON.stringify(toSystemOneQuestions(INPUT)).length < NOTICE_CLASSIFIER_SYSTEM_PROMPT.length / 2,
	);
});
