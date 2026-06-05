export type HubOAuthClientId = "muc-wiki";

export interface HubOAuthClientContext {
	clientId: HubOAuthClientId;
	displayName: string;
	hostLabel: string;
	productLabel: string;
	scopeItems: readonly string[];
}

export interface HubOAuthContext {
	client: HubOAuthClientContext;
	authorizePath: string;
	isOAuthRequest: true;
}

const MUC_WIKI_CLIENT: HubOAuthClientContext = {
	clientId: "muc-wiki",
	displayName: "MUC Wiki",
	hostLabel: "wiki.mucwiki-edge.link",
	productLabel: "MUC Wiki Hub",
	scopeItems: ["登录身份", "邮箱地址", "基本资料"],
};

const ADMITTED_CLIENTS: Readonly<Record<string, HubOAuthClientContext>> = {
	[MUC_WIKI_CLIENT.clientId]: MUC_WIKI_CLIENT,
};

const OAUTH_PARAMETER_KEYS = new Set([
	"client_id",
	"code_challenge",
	"code_challenge_method",
	"nonce",
	"prompt",
	"redirect_uri",
	"response_type",
	"scope",
	"state",
]);

export function resolveHubOAuthContext(search: string | URLSearchParams): HubOAuthContext | null {
	const params = typeof search === "string" ? new URLSearchParams(search) : search;
	const clientId = params.get("client_id")?.trim();
	if (!clientId) {
		return null;
	}

	const client = ADMITTED_CLIENTS[clientId];
	if (!client) {
		return null;
	}

	return {
		authorizePath: `/api/federation/authorize?${copyOAuthParameters(params).toString()}`,
		client,
		isOAuthRequest: true,
	};
}

function copyOAuthParameters(params: URLSearchParams): URLSearchParams {
	const copied = new URLSearchParams();
	for (const [key, value] of params.entries()) {
		if (OAUTH_PARAMETER_KEYS.has(key)) {
			copied.append(key, value);
		}
	}
	return copied;
}
