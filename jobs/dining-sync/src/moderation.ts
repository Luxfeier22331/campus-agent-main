import type { ModerationResult } from "./types.ts";

export interface DiningTextModerationInput {
	comment: string | null;
	contributorName: string | null;
	dishName: string;
	stallName: string;
}

export interface DiningImageModerationInput {
	url: string;
}

export interface GiteeAiDiningModeratorConfig {
	apiKey: string;
	baseUrl: string;
	fetch?: typeof fetch;
	imageModel: string;
	textModel: string;
	timeoutMs: number;
}

export class GiteeAiDiningModerator {
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly fetchImpl: typeof fetch;
	private readonly imageModel: string;
	private readonly textModel: string;
	private readonly timeoutMs: number;

	constructor(config: GiteeAiDiningModeratorConfig) {
		this.apiKey = config.apiKey;
		this.baseUrl = config.baseUrl.replace(/\/$/, "");
		this.fetchImpl = config.fetch ?? fetch;
		this.imageModel = config.imageModel;
		this.textModel = config.textModel;
		this.timeoutMs = config.timeoutMs;
	}

	async check(input: DiningTextModerationInput): Promise<ModerationResult> {
		return this.checkText(input);
	}

	async checkText(input: DiningTextModerationInput): Promise<ModerationResult> {
		return this.moderate({
			input: [
				{
					text: buildReviewText(input),
					type: "text",
				},
			],
			model: this.textModel,
		});
	}

	async checkImage(input: DiningImageModerationInput): Promise<ModerationResult> {
		return this.moderate({
			input: [
				{
					image_url: {
						url: input.url,
					},
					type: "image_url",
				},
			],
			model: this.imageModel,
		});
	}

	private async moderate(body: ModerationRequestBody): Promise<ModerationResult> {
		const response = await this.fetchImpl(`${this.baseUrl}/moderations`, {
			body: JSON.stringify(body),
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
			},
			method: "POST",
			signal: AbortSignal.timeout(this.timeoutMs),
		});
		if (!response.ok) {
			throw new Error(`Dining moderation provider failed: HTTP ${response.status}.`);
		}
		const payload = (await response.json()) as ModerationResponseBody;
		const result = payload.results?.[0];
		if (typeof result?.flagged !== "boolean") {
			throw new Error("Dining moderation provider returned an invalid moderation response.");
		}
		return result.flagged ? { status: "blocked" } : { status: "safe" };
	}
}

type ModerationRequestBody =
	| {
			input: Array<{ text: string; type: "text" }>;
			model: string;
	  }
	| {
			input: Array<{ image_url: { url: string }; type: "image_url" }>;
			model: string;
	  };

interface ModerationResponseBody {
	results?: Array<{ flagged?: unknown }>;
}

function buildReviewText(input: DiningTextModerationInput): string {
	return [
		`菜品：${input.dishName}`,
		`档口：${input.stallName}`,
		input.contributorName ? `评价者：${input.contributorName}` : null,
		input.comment ? `评价：${input.comment}` : null,
	]
		.filter((line): line is string => Boolean(line))
		.join("\n");
}
