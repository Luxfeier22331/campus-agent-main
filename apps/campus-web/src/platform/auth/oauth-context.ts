export type CampusOAuthClientId = "muc-wiki";

export interface CampusOAuthClientContext {
	clientId: CampusOAuthClientId;
	displayName: string;
	hostLabel: string;
	productLabel: string;
	scopeItems: readonly string[];
}

export interface CampusOAuthContext {
	client: CampusOAuthClientContext;
	authorizePath: string;
	isOAuthRequest: true;
}

const MUC_WIKI_CLIENT: CampusOAuthClientContext = {
	clientId: "muc-wiki",
	displayName: "MUC Wiki",
	hostLabel: "wiki.mucwiki-edge.link",
	productLabel: "MUC Campus",
	scopeItems: ["登录身份", "邮箱地址", "基本资料"],
};

const ADMITTED_CLIENTS: Readonly<Record<string, CampusOAuthClientContext>> = {
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

export function resolveCampusOAuthContext(
	search: string | URLSearchParams,
): CampusOAuthContext | null {
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
