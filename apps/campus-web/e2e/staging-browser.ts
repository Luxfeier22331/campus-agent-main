import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { type BrowserContext, chromium, type Page } from "playwright";

const DEFAULT_CAMPUS_BASE_URL = "https://campus-staging.mucwiki-edge.link";
const DEFAULT_PROMPT = "中央民族大学本科学生国家奖学金评审办法";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");

interface Args {
	captchaToken: string;
	campusBaseUrl: string;
	email: string;
	evidenceDir: string;
	headed: boolean;
	password: string;
	prompt: string;
	timeoutMs: number;
}

interface NetworkRecord {
	method: string;
	status: number | null;
	url: string;
}

function optionalValue(value: string | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

function parseArgs(argv: string[]): Args {
	const args: Args = {
		captchaToken: "",
		campusBaseUrl: DEFAULT_CAMPUS_BASE_URL,
		email: "",
		evidenceDir: resolve(repoRoot, "var/staging-evidence/campus-browser-e2e"),
		headed: false,
		password: "",
		prompt: DEFAULT_PROMPT,
		timeoutMs: 120_000,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--headed") {
			args.headed = true;
			continue;
		}
		const next = optionalValue(argv[index + 1]);
		if (token === "--captcha-token" && next) {
			args.captchaToken = next;
			index += 1;
			continue;
		}
		if (token === "--campus-base-url" && next) {
			args.campusBaseUrl = next;
			index += 1;
			continue;
		}
		if (token === "--evidence-dir" && next) {
			args.evidenceDir = next;
			index += 1;
			continue;
		}
		if (token === "--email" && next) {
			args.email = next.toLowerCase();
			index += 1;
			continue;
		}
		if (token === "--password" && next) {
			args.password = next;
			index += 1;
			continue;
		}
		if (token === "--prompt" && next) {
			args.prompt = next;
			index += 1;
			continue;
		}
		if (token === "--timeout-ms" && next) {
			args.timeoutMs = Number.parseInt(next, 10);
			index += 1;
			continue;
		}
		throw new Error(`Unknown or incomplete argument: ${token}`);
	}
	if (!args.email) {
		throw new Error("--email is required.");
	}
	if (!args.password) {
		throw new Error("--password is required.");
	}
	if (!args.captchaToken) {
		throw new Error("--captcha-token is required.");
	}
	if (!Number.isInteger(args.timeoutMs) || args.timeoutMs <= 0) {
		throw new Error("--timeout-ms must be a positive integer.");
	}
	return args;
}

async function readJson(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) {
		return null;
	}
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

async function signInIdentity(args: Args): Promise<string> {
	const response = await fetch(new URL("/api/auth/sign-in/email", args.campusBaseUrl), {
		body: JSON.stringify({
			email: args.email,
			password: args.password,
		}),
		headers: {
			accept: "application/json",
			"content-type": "application/json",
			origin: new URL(args.campusBaseUrl).origin,
			referer: new URL("/login", args.campusBaseUrl).toString(),
			"x-captcha-response": args.captchaToken,
		},
		method: "POST",
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) {
		throw new Error(
			`E2E identity sign-in failed (${response.status}): ${JSON.stringify(await readJson(response))}`,
		);
	}
	return response.headers.get("set-cookie") ?? "";
}

async function seedBrowserSession(
	context: BrowserContext,
	campusBaseUrl: string,
	cookieHeader: string,
) {
	const hostname = new URL(campusBaseUrl).hostname;
	const cookies = cookieHeader
		.split(/,(?=\s*[^;,]+=)/)
		.flatMap((part) => (part.split(";")[0] ? [part.split(";")[0]] : []))
		.map((pair) => {
			const separator = pair.indexOf("=");
			return {
				domain: hostname,
				httpOnly: true,
				name: pair.slice(0, separator).trim(),
				path: "/",
				secure: true,
				value: pair.slice(separator + 1).trim(),
			};
		})
		.filter((cookie) => cookie.name && cookie.value);
	await context.addCookies(cookies);
}

async function expectNoBrokenNetwork(records: NetworkRecord[]) {
	const blocked = records.filter((record) => {
		if (record.status === null) {
			return true;
		}
		return record.status >= 500;
	});
	if (blocked.length > 0) {
		throw new Error(
			`Browser E2E saw blocked network records: ${JSON.stringify(blocked.slice(0, 8))}`,
		);
	}
}

async function sendChatPrompt(page: Page, prompt: string, timeoutMs: number) {
	await page.goto("/", { waitUntil: "domcontentloaded" });
	const textbox = page.getByRole("textbox").first();
	await textbox.waitFor({ timeout: timeoutMs });
	await textbox.fill(prompt);
	await textbox.press("Enter");
	await page.getByText(prompt, { exact: false }).waitFor({ timeout: timeoutMs });
	await page
		.waitForResponse(
			(response) =>
				response.url().includes("/api/chat/runs/") &&
				response.url().includes("/events") &&
				response.status() < 500,
			{ timeout: timeoutMs },
		)
		.catch(() => undefined);
	await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => undefined);
}

async function checkDocs(page: Page, timeoutMs: number) {
	await page.goto("/docs/", { waitUntil: "domcontentloaded" });
	await page.locator("body").waitFor({ timeout: timeoutMs });
	await page.goto("/docs/regulations/student_rules/", { waitUntil: "domcontentloaded" });
	await page.locator("body").waitFor({ timeout: timeoutMs });
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	await mkdir(args.evidenceDir, { recursive: true });
	const browser = await chromium.launch({ headless: !args.headed });
	const context = await browser.newContext({
		baseURL: args.campusBaseUrl,
		viewport: { height: 900, width: 1366 },
	});
	const consoleErrors: string[] = [];
	const network: NetworkRecord[] = [];
	context.on("page", (page) => {
		page.on("console", (message) => {
			if (message.type() === "error") {
				consoleErrors.push(message.text());
			}
		});
		page.on("response", (response) => {
			network.push({
				method: response.request().method(),
				status: response.status(),
				url: response.url(),
			});
		});
		page.on("requestfailed", (request) => {
			network.push({
				method: request.method(),
				status: null,
				url: request.url(),
			});
		});
	});
	try {
		const cookieHeader = await signInIdentity(args);
		await seedBrowserSession(context, args.campusBaseUrl, cookieHeader);
		const page = await context.newPage();
		await page.goto("/", { waitUntil: "domcontentloaded" });
		await page.screenshot({ fullPage: true, path: resolve(args.evidenceDir, "campus-home.png") });
		await sendChatPrompt(page, args.prompt, args.timeoutMs);
		await page.screenshot({ fullPage: true, path: resolve(args.evidenceDir, "campus-chat.png") });
		await checkDocs(page, args.timeoutMs);
		await page.screenshot({ fullPage: true, path: resolve(args.evidenceDir, "campus-docs.png") });
		await expectNoBrokenNetwork(network);
		const result = {
			checks: {
				chatPromptSubmitted: true,
				consoleErrorCount: consoleErrors.length,
				docsOpened: true,
				networkFailureCount: network.filter(
					(record) => record.status === null || record.status >= 500,
				).length,
			},
			evidenceDir: args.evidenceDir,
			passed: consoleErrors.length === 0,
			surface: "campus-web",
		};
		await writeFile(
			resolve(args.evidenceDir, "campus-browser-e2e.json"),
			JSON.stringify(result, null, 2),
		);
		console.log(JSON.stringify(result, null, 2));
		if (!result.passed) {
			process.exitCode = 1;
		}
	} finally {
		await browser.close();
	}
}

void main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
