import assert from "node:assert/strict";
import test from "node:test";
import { NoticeClassificationInvalidOutputError } from "notice-classifier-core/classifier";
import {
	NOTICE_CLASSIFIER_SYSTEM_PROMPT,
	NOTICE_CLASSIFIER_TEMPERATURE,
	parseNoticeModelOutput,
} from "notice-classifier-core/model";
import {
	createNoticeModelFetch,
	isRetryableNoticeProviderCause,
} from "notice-classifier-core/openai";
import { APIConnectionError, APIError } from "openai";

test("removes SDK metadata headers blocked by the model gateway", async () => {
	let receivedHeaders: Headers | undefined;
	const fetchImplementation: typeof globalThis.fetch = async (_input, init) => {
		receivedHeaders = new Headers(init?.headers);
		return new Response(null, { status: 204 });
	};
	const gatewayFetch = createNoticeModelFetch(fetchImplementation);

	await gatewayFetch("https://model.example/v1/responses", {
		headers: {
			Authorization: "Bearer key",
			"Content-Type": "application/json",
			"User-Agent": "openai-node/6.49.0",
			"X-Request-Id": "request-id",
			"X-Stainless-Arch": "x64",
			"X-Stainless-Retry-Count": "0",
			"X-Stainless-Runtime": "node",
		},
	});

	assert.equal(receivedHeaders?.get("user-agent"), null);
	assert.equal(receivedHeaders?.get("x-stainless-arch"), null);
	assert.equal(receivedHeaders?.get("x-stainless-retry-count"), null);
	assert.equal(receivedHeaders?.get("x-stainless-runtime"), null);
	assert.equal(receivedHeaders?.get("authorization"), "Bearer key");
	assert.equal(receivedHeaders?.get("content-type"), "application/json");
	assert.equal(receivedHeaders?.get("x-request-id"), "request-id");
});

test("builds the prompt from the bounded single-category taxonomy", () => {
	assert.equal(NOTICE_CLASSIFIER_TEMPERATURE, 0);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /research_affairs：科研和创新项目/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /campus_activities：以报名、招募/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /仅根据中央民族大学门户通知标题/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /一个且仅一个面向用户的主分类/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /主分类表示通知对用户的主要用途/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /只依据 notice_title/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /不依据运行日期或标题所述事项是否已过/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /专业分流和培养方向选拔归 teaching_affairs/u);
	assert.match(
		NOTICE_CLASSIFIER_SYSTEM_PROMPT,
		/职业趋势、职业指导和就业服务本身提供可复用职业信息/u,
	);
	assert.match(
		NOTICE_CLASSIFIER_SYSTEM_PROMPT,
		/入选论文或议程名单、日程与参与安排归 lectures_forums/u,
	);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /校友联络员推荐和校友组织机制建设归 governance/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /书单、专刊、推文和其他内容上线/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /业务主题本身不能阻止归入 campus_news/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /军训记忆、社会实践启动或纪实、主题党日参访/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /招生执行和就业服务规则优先于纯叙事一般规则/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /必须归 competitions，不得归 teaching_affairs/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /教学奖励只包括非竞赛性评奖和奖励办理/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /立项、开题、中期、结题与成果填报/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /作品、短视频、摄影或内容征集只有明确赛制/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /命名讲堂或论坛、明确期次、具名主讲人和主题/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /缺少明确期次或具名主讲人/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /代表队招募、权威名单和结果归 competitions/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /以招生组为执行主体/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /必须归 admissions，不得归 campus_news/u);
	assert.match(
		NOTICE_CLASSIFIER_SYSTEM_PROMPT,
		/就业工作坊、求职沙龙、招聘宣讲和职业指导及其活动回顾/u,
	);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /基层就业学费补偿和国家助学贷款代偿/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /系统经办人、责任人或内部流程信息归 governance/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /考试造成的教室占用、区域避让或开放变化/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /津贴或工资发放的完整流程归 employment/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /毕业生基层服务项目归 employment/u);
	assert.match(
		NOTICE_CLASSIFIER_SYSTEM_PROMPT,
		/学生体质健康测试成绩、免测和缓测名单归 teaching_affairs/u,
	);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /无偿献血等以报名和自愿参与/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /应急救护、安全技能和健康科普培训/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /体检报告领取归 human_resources/u);
	assert.doesNotMatch(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /核心业务的回顾保留所属业务分类/u);
	assert.doesNotMatch(
		NOTICE_CLASSIFIER_SYSTEM_PROMPT,
		/学生社会实践、志愿服务、学生荣誉和学生组织评优归 student_affairs/u,
	);
	assert.doesNotMatch(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /尚未发生|已发生事项/u);
	assert.doesNotMatch(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /academic_information/u);
	assert.doesNotMatch(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /content_kind/u);
	assert.doesNotMatch(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /门户栏目|正文|外链/u);
});

test("parses one exact category without treating invalid output as a provider failure", () => {
	assert.equal(parseNoticeModelOutput('{"category":"campus_operations"}'), "campus_operations");
	assert.throws(
		() => parseNoticeModelOutput("campus_operations"),
		(error) =>
			error instanceof NoticeClassificationInvalidOutputError &&
			/invalid classification JSON/u.test(error.message),
	);
	assert.throws(
		() => parseNoticeModelOutput('{"category":"campus_operations","reason":"title"}'),
		(error) =>
			error instanceof NoticeClassificationInvalidOutputError &&
			/an invalid classification/u.test(error.message),
	);
});

test("retries only transient OpenAI-compatible provider failures", () => {
	const headers = new Headers();
	assert.equal(
		isRetryableNoticeProviderCause(
			new APIConnectionError({ cause: new Error("connection reset") }),
		),
		true,
	);
	for (const status of [408, 409, 429, 500, 503]) {
		assert.equal(
			isRetryableNoticeProviderCause(new APIError(status, {}, "temporary", headers)),
			true,
		);
	}
	for (const status of [400, 401, 403, 404, 422]) {
		assert.equal(
			isRetryableNoticeProviderCause(new APIError(status, {}, "permanent", headers)),
			false,
		);
	}
	assert.equal(isRetryableNoticeProviderCause(new Error("local failure")), false);
});
