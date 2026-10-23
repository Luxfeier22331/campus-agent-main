import type { Page, Route } from "@playwright/test";
import type { CampusApiSessionState } from "./api-mocks";

export interface AuthRequestRecord {
	headers: Record<string, string>;
	method: string;
	path: string;
	postData: unknown;
}

interface AuthMockOptions {
	signIn?: "success" | "invalid" | "rate-limited" | "unverified";
	signInRedirect?: string;
	signOut?: "failure" | "success";
	signUp?: "success" | "registered";
	sessionState?: CampusApiSessionState;
	verificationEmail?: "failure" | "rate-limited" | "success";
}

export async function mockAuthApi(
	page: Page,
	options: AuthMockOptions = {},
): Promise<AuthRequestRecord[]> {
	const records: AuthRequestRecord[] = [];
	await disableTurnstileInDocument(page);
	await page.route(
		(url) =>
			url.pathname === "/api/account/delete" ||
			url.pathname === "/api/auth/sign-in/email" ||
			url.pathname === "/api/auth/sign-up/email" ||
			url.pathname === "/api/auth/send-verification-email" ||
			url.pathname === "/api/auth/request-password-reset" ||
			url.pathname === "/api/auth/reset-password" ||
			url.pathname === "/api/auth/sign-out",
		async (route) => {
			records.push(readAuthRequestRecord(route));
			const url = new URL(route.request().url());
			if (url.pathname === "/api/account/delete") {
				if (options.sessionState) {
					options.sessionState.authenticated = false;
				}
				await route.fulfill({
					contentType: "application/json",
					json: { requestId: "acctdel_e2e", status: "deleting" },
					status: 202,
				});
				return;
			}
			if (url.pathname === "/api/auth/sign-in/email") {
				await fulfillSignIn(
					route,
					options.signIn ?? "invalid",
					options.sessionState,
					options.signInRedirect,
				);
				return;
			}
			if (url.pathname === "/api/auth/sign-up/email") {
				await fulfillSignUp(route, options.signUp ?? "success");
				return;
			}
			if (url.pathname === "/api/auth/send-verification-email") {
				await fulfillVerificationEmail(route, options.verificationEmail ?? "success");
				return;
			}
			if (url.pathname === "/api/auth/sign-out") {
				if (options.signOut === "failure") {
					await route.fulfill({
						contentType: "application/json",
						json: {
							error: {
								code: "dependency_not_ready",
								message: "账号服务暂时不可用。",
							},
						},
						status: 503,
					});
					return;
				}
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

// The e2e preview worker inherits the local .dev.vars Turnstile site key, and the widget
// depends on the external challenges.cloudflare.com network. Sign-in tests must stay
// hermetic, so strip the site key from the runtime config embedded in the document.
async function disableTurnstileInDocument(page: Page): Promise<void> {
	await page.route(
		() => true,
		async (route) => {
			if (route.request().resourceType() !== "document") {
				await route.fallback();
				return;
			}
			const response = await route.fetch();
			const body = (await response.text()).replace(/("turnstileSiteKey"\s*:\s*)"[^"]*"/u, "$1null");
			const headers = { ...response.headers() };
			delete headers["content-encoding"];
			delete headers["content-length"];
			await route.fulfill({ body, headers, status: response.status() });
		},
	);
}

async function fulfillSignIn(
	route: Route,
	mode: NonNullable<AuthMockOptions["signIn"]>,
	sessionState?: CampusApiSessionState,
	redirectUrl?: string,
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
					url: redirectUrl ?? null,
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
	if (mode === "unverified") {
		await route.fulfill({
			contentType: "application/json",
			json: {
				data: null,
				error: {
					code: "EMAIL_NOT_VERIFIED",
					message: "Email not verified",
					status: 403,
					statusText: "Forbidden",
				},
			},
			status: 403,
		});
		return;
	}
	if (mode === "rate-limited") {
		await route.fulfill({
			contentType: "application/json",
			headers: { "X-Retry-After": "17" },
			json: {
				code: "TOO_MANY_REQUESTS",
				message: "Too many requests",
			},
			status: 429,
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
		await fulfillSuccessfulSignUp(route);
		return;
	}
	await fulfillSuccessfulSignUp(route);
}

async function fulfillSuccessfulSignUp(route: Route) {
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

async function fulfillVerificationEmail(
	route: Route,
	mode: NonNullable<AuthMockOptions["verificationEmail"]>,
) {
	if (mode === "rate-limited") {
		await route.fulfill({
			contentType: "application/json",
			headers: { "X-Retry-After": "17" },
			json: { code: "TOO_MANY_REQUESTS", message: "Too many requests" },
			status: 429,
		});
		return;
	}
	if (mode === "failure") {
		await route.fulfill({
			contentType: "application/json",
			json: {
				error: {
					code: "dependency_not_ready",
					message: "邮件服务暂时不可用。",
				},
			},
			status: 503,
		});
		return;
	}
	await route.fulfill({
		contentType: "application/json",
		json: { data: { status: true }, error: null },
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
