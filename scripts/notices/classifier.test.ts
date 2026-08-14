import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	classifyNotice,
	classifyNoticeByRule,
	cleanNoticeContentHtml,
	type NoticeClassificationInput,
	type NoticeDomain,
} from "./classifier";
import { toModelInput } from "./model";

interface GoldenNotice {
	expected_domain: NoticeDomain;
	is_external: boolean;
	notice_id: number;
	notice_title: string;
	notice_type_name: string;
}

test("classifies the golden notices without invoking the model", async () => {
	const fixture = JSON.parse(
		await readFile(new URL("./golden/recent-notices.json", import.meta.url), "utf8"),
	) as GoldenNotice[];
	assert.equal(fixture.length, 33);
	const actual = new Map<NoticeDomain, number>();
	for (const notice of fixture) {
		const input = toInput(notice);
		assert.equal(classifyNoticeByRule(input), notice.expected_domain, String(notice.notice_id));
		const domain = await classifyNotice(input, async () => {
			throw new Error("model must not be called for golden notices");
		});
		assert.equal(domain, notice.expected_domain);
		actual.set(domain, (actual.get(domain) ?? 0) + 1);
	}
	assert.deepEqual(Object.fromEntries(actual), {
		academic_information: 3,
		admissions: 2,
		campus_news: 19,
		campus_operations: 1,
		procurement: 8,
	});
});

test("uses semantic rules before the activity-report fallback", () => {
	assert.equal(
		classifyNoticeByRule({
			contentText: null,
			isExternal: true,
			noticeId: 358168,
			noticeTitle: "管理学院关于2027年接收推荐免试研究生预报名的通知",
			noticeTypeName: "活动报道",
		}),
		"admissions",
	);
	assert.equal(
		classifyNoticeByRule({
			contentText: null,
			isExternal: true,
			noticeId: 358167,
			noticeTitle: "管理学院研究生刊物《治道论衡》第26期电子刊上线啦！",
			noticeTypeName: "活动报道",
		}),
		"academic_information",
	);
});

test("cleans portal HTML in memory without retaining links or scripts", () => {
	assert.equal(
		cleanNoticeContentHtml(
			'<p>校园&nbsp;通知</p><script>ignore()</script><a href="https://example.edu">查看安排</a>',
		),
		"校园 通知 查看安排",
	);
	assert.equal(cleanNoticeContentHtml("<div> </div>"), null);
	assert.equal(cleanNoticeContentHtml(null), null);
});

test("sends only approved source features to the model", () => {
	assert.deepEqual(
		toModelInput({
			contentText: null,
			isExternal: true,
			noticeId: 1,
			noticeTitle: "待判断通知",
			noticeTypeName: "办公通知",
		}),
		{
			content_text: null,
			is_external: true,
			notice_title: "待判断通知",
			notice_type_name: "办公通知",
		},
	);
});

function toInput(notice: GoldenNotice): NoticeClassificationInput {
	return {
		contentText: null,
		isExternal: notice.is_external,
		noticeId: notice.notice_id,
		noticeTitle: notice.notice_title,
		noticeTypeName: notice.notice_type_name,
	};
}
