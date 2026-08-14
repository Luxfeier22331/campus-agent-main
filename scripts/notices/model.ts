import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import {
	NOTICE_DOMAINS,
	type NoticeClassificationInput,
	type NoticeModelClassifier,
} from "./classifier";

const modelOutputSchema = z.object({
	domain: z.enum(NOTICE_DOMAINS),
});

const SYSTEM_PROMPT = `你负责把中央民族大学门户通知归入唯一内部领域。
领域定义：academic_information 学术信息；teaching_affairs 教学事务；academic_achievement 学术成果；
campus_news 校园新闻；student_support 学生资助；student_development 学生成长事务；
discipline_competition 学科竞赛；admissions 招生；international_programs 国际项目；employment 就业；
campus_operations 校园运行；human_resources 人事；external_cooperation 对外合作；procurement 采购；
governance 治理与制度；culture_sports 文体活动；unclassified 信息不足或暂不确定。
门户类型只是辅助特征。外链通知没有正文时仍应依据标题判断，不得猜测外链内容。`;

export interface NoticeClassifierModelConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
}

export function resolveNoticeClassifierModelConfig(
	env: NodeJS.ProcessEnv,
): NoticeClassifierModelConfig {
	return {
		apiKey: requiredEnv(env, "INTERNAL_NOTICE_CLASSIFIER_OPENAI_API_KEY"),
		baseUrl: requiredEnv(env, "INTERNAL_NOTICE_CLASSIFIER_OPENAI_BASE_URL"),
		model: requiredEnv(env, "INTERNAL_NOTICE_CLASSIFIER_OPENAI_MODEL"),
	};
}

export function createOpenAINoticeModelClassifier(
	env: NodeJS.ProcessEnv = process.env,
): NoticeModelClassifier {
	const config = resolveNoticeClassifierModelConfig(env);
	const client = new OpenAI({
		apiKey: config.apiKey,
		baseURL: config.baseUrl,
		maxRetries: 0,
	});
	return async (input) => {
		const response = await client.responses.parse({
			input: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: JSON.stringify(toModelInput(input)) },
			],
			model: config.model,
			text: {
				format: zodTextFormat(modelOutputSchema, "notice_classification"),
			},
		});
		if (!response.output_parsed) {
			throw new Error("model returned no structured classification");
		}
		return response.output_parsed.domain;
	};
}

export function toModelInput(input: NoticeClassificationInput): Record<string, unknown> {
	return {
		content_text: input.contentText,
		is_external: input.isExternal,
		notice_title: input.noticeTitle,
		notice_type_name: input.noticeTypeName,
	};
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required when a notice needs model classification`);
	}
	return value;
}
