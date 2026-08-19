import {
	NOTICE_CATEGORY_DESCRIPTIONS,
	NOTICE_CLASSIFICATION_RULES,
} from "@campus-agent/notices/taxonomy";
import { NOTICE_CATEGORIES, type NoticeCategory } from "campus-contracts/notices";
import { z } from "zod";

import { NoticeClassificationInvalidOutputError } from "./classifier.ts";

export const NoticeClassifierModelOutputSchema = z
	.object({
		category: z.enum(NOTICE_CATEGORIES),
	})
	.strict();

export const NOTICE_CLASSIFIER_TEMPERATURE = 0;

export const NOTICE_CLASSIFIER_SYSTEM_PROMPT = [
	"你负责仅根据中央民族大学门户通知标题，将通知归入一个且仅一个面向用户的主分类。",
	"主分类表示通知对用户的主要用途；根据标题体现的办理、参与、核验、权威状态或信息用途判断。",
	...NOTICE_CATEGORIES.map(
		(category) => `${category}：${NOTICE_CATEGORY_DESCRIPTIONS[category]}。`,
	),
	"裁决规则：",
	...NOTICE_CLASSIFICATION_RULES,
].join("\n");

export function parseNoticeModelOutput(value: string): NoticeCategory {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch (error) {
		throw new NoticeClassificationInvalidOutputError("model returned invalid classification JSON", {
			cause: error,
		});
	}
	const result = NoticeClassifierModelOutputSchema.safeParse(parsed);
	if (!result.success) {
		throw new NoticeClassificationInvalidOutputError("model returned an invalid classification");
	}
	return result.data.category;
}
export function toModelInput(noticeTitle: string): Record<string, unknown> {
	return { notice_title: noticeTitle };
}
