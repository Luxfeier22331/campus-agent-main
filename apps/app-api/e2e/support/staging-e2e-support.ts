import { buildCookieHeader, readJsonResponse } from "./e2e-auth-runtime";

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

export async function signInE2eIdentity(input: {
	captchaToken: string;
	chatBaseUrl: string;
	email: string;
	password: string;
}): Promise<string> {
	const response = await fetch(new URL("/api/auth/sign-in/email", input.chatBaseUrl).toString(), {
		body: JSON.stringify({
			email: input.email,
			password: input.password,
		}),
		headers: {
			accept: "application/json",
			"content-type": "application/json",
			origin: new URL(input.chatBaseUrl).origin,
			referer: new URL("/login", input.chatBaseUrl).toString(),
			"x-captcha-response": input.captchaToken,
		},
		method: "POST",
		signal: AbortSignal.timeout(30_000),
	});
	const payload = await readJsonResponse(response);
	if (!response.ok) {
		throw new Error(`E2E identity sign-in failed (${response.status}): ${JSON.stringify(payload)}`);
	}

	return buildCookieHeader(response);
}
