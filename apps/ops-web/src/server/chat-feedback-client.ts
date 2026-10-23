import { ChatFeedbackDetailSchema, ChatFeedbackPageSchema } from "campus-contracts/chat-feedback";
import { resolveCampusWebPublicOrigin } from "./campus-web-origin.ts";
import { normalizeProductSources } from "./chat-source-mapping.ts";

interface ChatFeedbackEnv {
	OPS_WEB_CAMPUS_WEB_URL?: string;
	OPS_WEB_APP_API_URL?: string;
	OPS_WEB_INTERNAL_TOKEN?: string;
}

export class ChatFeedbackUnavailableError extends Error {}
export class ChatFeedbackResponseError extends Error {
	readonly response: Response;
	constructor(response: Response) {
		super(`Chat feedback API returned HTTP ${response.status}.`);
		this.response = response;
	}
}

export function createChatFeedbackClient(
	env: ChatFeedbackEnv,
	input: { fetchImplementation?: typeof fetch } = {},
) {
	const fetchImplementation = input.fetchImplementation ?? fetch;
	const baseUrl = env.OPS_WEB_APP_API_URL?.trim().replace(/\/$/u, "");
	const token = env.OPS_WEB_INTERNAL_TOKEN?.trim();
	async function request(path: string) {
		if (!(baseUrl && token)) {
			throw new ChatFeedbackUnavailableError("Chat feedback API is not configured.");
		}
		let response: Response;
		try {
			response = await fetchImplementation(`${baseUrl}/api/internal/admin/chat-feedback${path}`, {
				headers: { authorization: `Bearer ${token}` },
				method: "GET",
				signal: AbortSignal.timeout(15_000),
			});
		} catch {
			throw new ChatFeedbackUnavailableError("Chat feedback API is unavailable.");
		}
		if (!response.ok) {
			throw new ChatFeedbackResponseError(response);
		}
		return response.json();
	}
	return {
		async list(search: URLSearchParams) {
			return ChatFeedbackPageSchema.parse(await request(search.size > 0 ? `?${search}` : ""));
		},
		async getDetail(id: string) {
			const detail = ChatFeedbackDetailSchema.parse(await request(`/${encodeURIComponent(id)}`));
			return {
				...detail,
				answer: {
					...detail.answer,
					sources: normalizeProductSources(
						[{ type: "source_items", sourceItems: detail.answer.sources }],
						resolveCampusWebPublicOrigin(env.OPS_WEB_CAMPUS_WEB_URL),
					),
				},
			};
		},
	};
}
