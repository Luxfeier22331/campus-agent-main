import type { Page, Route } from "@playwright/test";
import type { CampusApiSessionState } from "./api-mocks";

export interface AuthRequestRecord {
	headers: Record<string, string>;
	method: string;
	path: string;
	postData: unknown;
}

interface AuthMockOptions {
	signIn?: "success" | "invalid";
	signUp?: "success" | "registered";
	sessionState?: CampusApiSessionState;
}

export async function mockAuthApi(
	page: Page,
	options: AuthMockOptions = {},
): Promise<AuthRequestRecord[]> {
	const records: AuthRequestRecord[] = [];
	await page.route(
		(url) =>
			url.pathname === "/api/auth/sign-in/email" ||
			url.pathname === "/api/auth/sign-up/email" ||
			url.pathname === "/api/auth/request-password-reset" ||
			url.pathname === "/api/auth/reset-password" ||
			url.pathname === "/api/auth/sign-out",
		async (route) => {
			records.push(readAuthRequestRecord(route));
			const url = new URL(route.request().url());
			if (url.pathname === "/api/auth/sign-in/email") {
				await fulfillSignIn(route, options.signIn ?? "invalid", options.sessionState);
				return;
			}
			if (url.pathname === "/api/auth/sign-up/email") {
				await fulfillSignUp(route, options.signUp ?? "success");
				return;
			}
			if (url.pathname === "/api/auth/sign-out") {
				if (options.sessionState) {
					options.sessionState.authenticated = false;
				}
				await route.fulfill({
					contentType: "application/json",
					json: { data: { success: true }, error: null },
					status: 200,
				});
				return;
			}
			await route.fulfill({
				contentType: "application/json",
				json: { data: null, error: null },
				status: 200,
			});
		},
	);
	return records;
}

async function fulfillSignIn(
	route: Route,
	mode: NonNullable<AuthMockOptions["signIn"]>,
	sessionState?: CampusApiSessionState,
) {
	if (mode === "success") {
		if (sessionState) {
			sessionState.authenticated = true;
		}
		await route.fulfill({
			contentType: "application/json",
			json: {
				data: {
					redirect: true,
					token: "session_token_e2e",
					url: null,
					user: {
						email: "student@example.edu",
						id: "user_e2e",
						name: "测试用户",
					},
				},
				error: null,
			},
			status: 200,
		});
		return;
	}
	await route.fulfill({
		contentType: "application/json",
		json: {
			data: null,
			error: {
				code: "INVALID_EMAIL_OR_PASSWORD",
				message: "Invalid email or password",
				status: 401,
				statusText: "Unauthorized",
			},
		},
		status: 401,
	});
}

async function fulfillSignUp(route: Route, mode: NonNullable<AuthMockOptions["signUp"]>) {
	if (mode === "registered") {
		await route.fulfill({
			contentType: "application/json",
			json: {
				data: null,
				error: {
					code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
					message: "User already exists. Use another email.",
					status: 422,
					statusText: "Unprocessable Entity",
				},
			},
			status: 422,
		});
		return;
	}
	await route.fulfill({
		contentType: "application/json",
		json: {
			data: {
				redirect: false,
				token: null,
				user: {
					email: "student@example.edu",
					id: "user_e2e",
					name: "测试用户",
				},
			},
			error: null,
		},
		status: 200,
	});
}

function readAuthRequestRecord(route: Route): AuthRequestRecord {
	const request = route.request();
	const headers = request.headers();
	let postData: unknown = null;
	try {
		postData = request.postDataJSON();
	} catch {
		postData = request.postData();
	}
	return {
		headers,
		method: request.method(),
		path: new URL(request.url()).pathname,
		postData,
	};
}
