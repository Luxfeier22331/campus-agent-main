import {
	OpsChatConversationSchema,
	OpsConversationListQuerySchema,
	OpsConversationListResponseSchema,
} from "campus-contracts/chat-conversations";
import { resolveCampusWebPublicOrigin } from "./campus-web-origin.ts";
import { normalizeProductSources } from "./chat-source-mapping.ts";

interface ChatConversationEnv {
	OPS_WEB_CAMPUS_WEB_URL?: string;
	OPS_WEB_APP_API_URL?: string;
	OPS_WEB_INTERNAL_TOKEN?: string;
}

export class ChatConversationUnavailableError extends Error {}
export class ChatConversationResponseError extends Error {
	readonly response: Response;
	constructor(response: Response) {
		super(`Chat conversation API returned HTTP ${response.status}.`);
		this.response = response;
	}
}

export function createChatConversationClient(
	env: ChatConversationEnv,
	input: { fetchImplementation?: typeof fetch } = {},
) {
	const fetchImplementation = input.fetchImplementation ?? fetch;
	const baseUrl = env.OPS_WEB_APP_API_URL?.trim().replace(/\/$/u, "");
	const token = env.OPS_WEB_INTERNAL_TOKEN?.trim();
	async function request(path: string) {
		if (!(baseUrl && token)) {
			throw new ChatConversationUnavailableError("Chat conversation API is not configured.");
		}
		let response: Response;
		try {
			response = await fetchImplementation(
				`${baseUrl}/api/internal/admin/chat-conversations${path}`,
				{
					headers: { authorization: `Bearer ${token}` },
					method: "GET",
					signal: AbortSignal.timeout(15_000),
				},
			);
		} catch {
			throw new ChatConversationUnavailableError("Chat conversation API is unavailable.");
		}
		if (!response.ok) {
			throw new ChatConversationResponseError(response);
		}
		return response.json();
	}
	return {
		async list(query: unknown) {
			const parsed = OpsConversationListQuerySchema.parse(query);
			const search = new URLSearchParams();
			for (const [key, value] of Object.entries(parsed)) {
				if (value !== undefined) {
					search.set(key, String(value));
				}
			}
			return OpsConversationListResponseSchema.parse(await request(`?${search.toString()}`));
		},
		async getDetail(id: string) {
			const detail = OpsChatConversationSchema.parse(await request(`/${encodeURIComponent(id)}`));
			return {
				...detail,
				messages: detail.messages.map((message) => ({
					...message,
					sources: normalizeProductSources(
						[{ type: "source_items", sourceItems: message.sources }],
						resolveCampusWebPublicOrigin(env.OPS_WEB_CAMPUS_WEB_URL),
					),
				})),
			};
		},
	};
}
