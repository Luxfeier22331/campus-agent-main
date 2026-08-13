import type { CredentialSyncResult, ExtractorConfig, SsoTgcResult } from "./types";

export interface AutomationCredential {
	credentialId: string;
	name: string;
	version: number;
}

export async function syncViaAutomationApi(
	config: ExtractorConfig,
	cookieData: SsoTgcResult,
): Promise<CredentialSyncResult> {
	if (!config.automationUrl) {
		throw new Error("SSO_TGC_EXTRACTOR_AUTOMATION_URL 未设置。");
	}
	if (!config.automationToken) {
		throw new Error("SSO_TGC_EXTRACTOR_AUTOMATION_TOKEN 未设置。");
	}
	if (!config.credentialName) {
		throw new Error("SSO_TGC_EXTRACTOR_CREDENTIAL_NAME 未设置。");
	}

	const baseUrl = config.automationUrl.replace(/\/$/, "");
	const headers: Record<string, string> = {
		Authorization: `Bearer ${config.automationToken}`,
	};

	const listData = await fetchCredentialList(baseUrl, headers);
	const matches = listData.credentials.filter((c) => c.name === config.credentialName);
	if (matches.length === 0) {
		let createResponse: Response;
		try {
			createResponse = await fetch(
				`${baseUrl}/api/automation/internal-portal/credentials`,
				{
					method: "POST",
					headers: {
						...headers,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						name: config.credentialName,
						ssoTgc: cookieData.value,
					}),
				},
			);
		} catch {
			throw new Error("创建凭据失败：请求未完成。");
		}

		if (createResponse.ok) {
			const createData = await readCredentialResponse(createResponse, "创建凭据");
			return {
				action: "created",
				credentialId: createData.credential.credentialId,
				credentialName: createData.credential.name,
				previousVersion: null,
				version: createData.credential.version,
				extractedAt: cookieData.extractedAt,
				reused: cookieData.reused,
			};
		}

		if (createResponse.status !== 409) {
			throw new Error(`创建凭据失败: HTTP ${createResponse.status}`);
		}

		// Another run may have created this name between our list and POST.
		// Re-read once, then use the normal CAS rotation path.
		const afterConflict = await fetchCredentialList(baseUrl, headers);
		const conflictMatches = afterConflict.credentials.filter(
			(c) => c.name === config.credentialName,
		);
		if (conflictMatches.length === 0) {
			throw new Error("创建凭据失败: HTTP 409");
		}
		if (conflictMatches.length > 1) {
			throw new Error(
				`找到 ${conflictMatches.length} 条名为 "${config.credentialName}" 的凭据，无法确定轮换目标。请使用唯一名称。`,
			);
		}
		const target = conflictMatches[0];
		if (!target) {
			throw new Error("创建凭据失败: HTTP 409");
		}
		return rotateCredential(baseUrl, headers, target, cookieData);
	}
	if (matches.length > 1) {
		throw new Error(
			`找到 ${matches.length} 条名为 "${config.credentialName}" 的凭据，无法确定轮换目标。请使用唯一名称。`,
		);
	}
	const target = matches[0];
	if (!target) {
		throw new Error("未找到待轮换凭据。");
	}
	return rotateCredential(baseUrl, headers, target, cookieData);
}

async function fetchCredentialList(
	baseUrl: string,
	headers: Record<string, string>,
): Promise<{ credentials: AutomationCredential[] }> {
	let response: Response;
	try {
		response = await fetch(`${baseUrl}/api/automation/internal-portal/credentials`, {
			headers,
		});
	} catch {
		throw new Error("获取凭据列表失败：请求未完成。");
	}
	if (!response.ok) {
		throw new Error(`获取凭据列表失败: HTTP ${response.status}`);
	}
	return await readCredentialList(response);
}

async function rotateCredential(
	baseUrl: string,
	headers: Record<string, string>,
	target: AutomationCredential,
	cookieData: SsoTgcResult,
): Promise<CredentialSyncResult> {
	let rotateResponse: Response;
	try {
		rotateResponse = await fetch(
			`${baseUrl}/api/automation/internal-portal/credentials/${encodeURIComponent(target.credentialId)}`,
			{
				method: "PUT",
				headers: {
					...headers,
					"Content-Type": "application/json",
					"If-Match": `"${target.version}"`,
				},
				body: JSON.stringify({ ssoTgc: cookieData.value }),
			},
		);
	} catch {
		throw new Error("轮换凭据失败：请求未完成。");
	}

	if (!rotateResponse.ok) {
		throw new Error(`轮换凭据失败: HTTP ${rotateResponse.status}`);
	}

	const rotateData = await readCredentialResponse(rotateResponse, "轮换凭据");
	return {
		action: "rotated",
		credentialId: rotateData.credential.credentialId,
		credentialName: rotateData.credential.name,
		previousVersion: target.version,
		version: rotateData.credential.version,
		extractedAt: cookieData.extractedAt,
		reused: cookieData.reused,
	};
}

async function readCredentialList(
	response: Response,
): Promise<{ credentials: AutomationCredential[] }> {
	try {
		const value: unknown = await response.json();
		if (!isRecord(value) || !Array.isArray(value.credentials)) {
			throw new Error("invalid response");
		}
		const credentials = value.credentials.map(parseCredential);
		return { credentials };
	} catch {
		throw new Error("获取凭据列表失败：响应格式无效。");
	}
}

async function readCredentialResponse(
	response: Response,
	operation: string,
): Promise<{ credential: AutomationCredential }> {
	try {
		const value: unknown = await response.json();
		if (!isRecord(value)) throw new Error("invalid response");
		return { credential: parseCredential(value.credential) };
	} catch {
		throw new Error(`${operation}失败：响应格式无效。`);
	}
}

function parseCredential(value: unknown): AutomationCredential {
	if (!isRecord(value)) throw new Error("invalid credential");
	const { credentialId, name, version } = value;
	if (
		typeof credentialId !== "string" ||
		typeof name !== "string" ||
		typeof version !== "number" ||
		!Number.isSafeInteger(version) ||
		version < 1
	) {
		throw new Error("invalid credential");
	}
	return { credentialId, name, version };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
