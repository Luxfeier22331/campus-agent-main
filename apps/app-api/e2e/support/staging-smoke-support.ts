import { randomBytes } from "node:crypto";

import { buildCookieHeader, readJsonResponse } from "./smoke-auth-runtime";

export function buildSmokePassword(): string {
	return `SmokePass!${randomBytes(12).toString("base64url")}`;
}

export async function fetchReadyz(url: string): Promise<{ payload: unknown; status: number }> {
	const response = await fetch(url, {
		headers: {
			accept: "application/json",
		},
		signal: AbortSignal.timeout(30_000),
	});
	const payload = await readJsonResponse(response);
	if (response.status !== 200) {
		throw new Error(
			`Expected readyz 200 from ${url}, received ${response.status}: ${JSON.stringify(payload)}`,
		);
	}

	return {
		payload,
		status: response.status,
	};
}

export async function mintStagingSmokeSession(input: {
	appApiReadyzUrl: string;
	email: string;
	name?: string;
	password: string;
	resetIdentity?: boolean;
	smokeAuthSecret: string;
}): Promise<string> {
	const response = await fetch(
		new URL("/api/internal/staging-smoke/auth/session", input.appApiReadyzUrl).toString(),
		{
			body: JSON.stringify({
				email: input.email,
				...(input.name ? { name: input.name } : {}),
				password: input.password,
				...(input.resetIdentity ? { resetIdentity: true } : {}),
			}),
			headers: {
				accept: "application/json",
				"content-type": "application/json",
				"x-app-staging-smoke-auth": input.smokeAuthSecret,
			},
			method: "POST",
			signal: AbortSignal.timeout(30_000),
		},
	);
	const payload = await readJsonResponse(response);
	if (!response.ok) {
		throw new Error(
			`Staging smoke session mint failed (${response.status}): ${JSON.stringify(payload)}`,
		);
	}

	return buildCookieHeader(response);
}
