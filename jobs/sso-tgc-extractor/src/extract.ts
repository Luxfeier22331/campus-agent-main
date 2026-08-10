import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type ElementHandle, type Frame, type Page } from "playwright";
import type { ExtractorConfig, SsoTgcResult } from "./types";

const USERNAME_SELECTORS = [
	'input[name="username"]',
	"#username",
	'input[name="user"]',
	'input[name="account"]',
	'input[name="uid"]',
	'input[name="loginName"]',
];

const PASSWORD_SELECTORS = [
	'input[name="password"]',
	"#password",
	'input[name="pass"]',
	'input[type="password"]',
];

const SUBMIT_SELECTORS = [
	'button[type="submit"]',
	'input[type="submit"]',
	"#loginBtn",
	".login-btn",
	".btn-login",
	'button:has-text("登录")',
	'button:has-text("Login")',
	".auth_login_btn",
];

const CAPTCHA_IMG_SELECTORS = [
	'img[src*="captcha"]',
	'img[src*="checkCode"]',
	'img[src*="randCode"]',
	'img[src*="verifyCode"]',
	'img[id*="captcha"]',
	'img[id*="verifyCode"]',
	"#captcha",
	"#captchaImg",
	"#verifyCodeImg",
	".captcha-img",
	".captcha-image",
];

const CAPTCHA_INPUT_SELECTORS = [
	'input[name="captcha"]',
	'input[name="verifyCode"]',
	'input[name="randcode"]',
	'input[name="randCode"]',
	'input[name="checkCode"]',
	'input[name="validationCode"]',
	'input[id*="captcha"]',
	'input[id*="verifyCode"]',
];

const CAPTCHA_SLIDER_SELECTORS = [
	"#sliderContainer",
	"#sliderContainerPopup",
	".slider-container",
	".slider-captcha",
	'[class*="slide-captcha"]',
	'[class*="sliderVerify"]',
];

const ERROR_TEXT_PATTERNS = [
	"密码",
	"password",
	"错误",
	"error",
	"失败",
	"fail",
	"验证码",
	"captcha",
	"incorrect",
	"invalid",
	"账户",
	"account",
];

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStorageStatePath(config: ExtractorConfig): string | null {
	if (!config.storageStateDir) return null;
	if (!existsSync(config.storageStateDir)) {
		mkdirSync(config.storageStateDir, { recursive: true });
	}
	return path.join(config.storageStateDir, "state.json");
}

export function isOnLoginPage(url: string): boolean {
	const lower = url.toLowerCase();
	return (
		lower.includes("cas/login") ||
		lower.includes("zfca/login") ||
		lower.includes("authserver") ||
		lower.includes("sso/login") ||
		lower.includes("/login")
	);
}

async function findLoginFrame(page: Page, timeout = 15000): Promise<Frame | null> {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		for (const frame of page.frames()) {
			for (const selector of USERNAME_SELECTORS) {
				try {
					const el = await frame.$(selector);
					if (el) {
						const visible = await el.isVisible().catch(() => false);
						if (visible) return frame;
					}
				} catch {}
			}
		}
		await sleep(500);
	}
	return null;
}

async function findElementInFrame(
	frame: Frame,
	selectors: string[],
	timeout = 8000,
): Promise<ElementHandle | null> {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		for (const selector of selectors) {
			try {
				const el = await frame.$(selector);
				if (el) {
					const visible = await el.isVisible().catch(() => false);
					if (visible) return el;
				}
			} catch {}
		}
		await sleep(300);
	}
	return null;
}

async function hasCaptchaInFrame(frame: Frame): Promise<boolean> {
	for (const selector of CAPTCHA_INPUT_SELECTORS) {
		try {
			const el = await frame.$(selector);
			if (el && (await el.isVisible().catch(() => false))) return true;
		} catch {}
	}
	for (const selector of CAPTCHA_SLIDER_SELECTORS) {
		try {
			const el = await frame.$(selector);
			if (el && (await el.isVisible().catch(() => false))) return true;
		} catch {}
	}
	for (const selector of CAPTCHA_IMG_SELECTORS) {
		try {
			const el = await frame.$(selector);
			if (el && (await el.isVisible().catch(() => false))) {
				const box = await el.boundingBox().catch(() => null);
				if (box && box.width > 30 && box.height > 15 && box.width < 400) {
					return true;
				}
			}
		} catch {}
	}
	return false;
}

async function tryExistingSession(
	context: BrowserContext,
	config: ExtractorConfig,
): Promise<SsoTgcResult | null> {
	const storagePath = getStorageStatePath(config);
	if (!storagePath || !existsSync(storagePath)) return null;

	const page = await context.newPage();
	try {
		await page.goto(config.portalUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
		await sleep(2000);
		if (!isOnLoginPage(page.url())) {
			const cookies = await context.cookies();
			const target = cookies.find((c) => c.name === config.cookieName);
			if (target) {
				return {
					value: target.value,
					domain: target.domain,
					path: target.path,
					expires: target.expires,
					httpOnly: target.httpOnly,
					secure: target.secure,
					extractedAt: new Date().toISOString(),
					reused: true,
				};
			}
		}
	} catch {} finally {
		await page.close();
	}
	return null;
}

async function performLogin(page: Page, config: ExtractorConfig): Promise<void> {
	const frame = await findLoginFrame(page);
	if (!frame) {
		throw new Error("未找到登录表单（在主页面和所有 iframe 中均未发现可见的用户名输入框）");
	}

	const usernameInput = await findElementInFrame(frame, USERNAME_SELECTORS, 5000);
	if (!usernameInput) throw new Error("未找到用户名输入框");

	const passwordInput = await findElementInFrame(frame, PASSWORD_SELECTORS, 5000);
	if (!passwordInput) throw new Error("未找到密码输入框");

	const captchaPresent = await hasCaptchaInFrame(frame);
	if (captchaPresent) {
		if (!config.headed) {
			throw new Error("Headless 模式下检测到验证码，请设置 SSO_TGC_EXTRACTOR_HEADED=true");
		}
	}

	await usernameInput.fill(config.username);
	await passwordInput.fill(config.password);

	if (captchaPresent && config.headed) {
		const captchaInput = await findElementInFrame(frame, CAPTCHA_INPUT_SELECTORS, 3000);
		if (captchaInput) {
			const captchaSelector = await captchaInput
				.evaluate((el: HTMLInputElement) => {
					const name = el.getAttribute("name");
					return name ? `input[name="${name}"]` : "";
				})
				.catch(() => "");
			if (captchaSelector) {
				try {
				await frame.waitForFunction(
					(sel: string) => {
						const el = document.querySelector(sel) as HTMLInputElement | null;
						return el?.value && el.value.length > 0;
					},
						captchaSelector,
						{ timeout: 60000 },
					);
				} catch {}
			}
		}
	}

	const submitButton = await findElementInFrame(frame, SUBMIT_SELECTORS, 5000);
	if (submitButton) {
		await Promise.all([
			page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {}),
			submitButton.click(),
		]);
	} else {
		await Promise.all([
			page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {}),
			passwordInput.press("Enter"),
		]);
	}

	await sleep(3000);

	if (isOnLoginPage(page.url())) {
		let bodyText = "";
		for (const f of page.frames()) {
			try {
				bodyText += await f.textContent("body").catch(() => "");
			} catch {}
		}
		const matched = ERROR_TEXT_PATTERNS.find((p) =>
			bodyText.toLowerCase().includes(p.toLowerCase()),
		);
		if (matched) {
			throw new Error(`登录可能失败（页面含错误关键词: "${matched}"）`);
		}
	}
}

async function extractCookieFromContext(
	context: BrowserContext,
	config: ExtractorConfig,
): Promise<SsoTgcResult> {
	const cookies = await context.cookies();
	const target = cookies.find((c) => c.name === config.cookieName);
	if (!target) {
		const names = cookies.map((c) => `${c.name}@${c.domain}`);
		throw new Error(`未找到 Cookie "${config.cookieName}"。当前 cookies: ${names.join(", ") || "(空)"}`);
	}
	return {
		value: target.value,
		domain: target.domain,
		path: target.path,
		expires: target.expires,
		httpOnly: target.httpOnly,
		secure: target.secure,
		extractedAt: new Date().toISOString(),
		reused: false,
	};
}

async function saveStorageState(context: BrowserContext, config: ExtractorConfig): Promise<void> {
	const storagePath = getStorageStatePath(config);
	if (storagePath) {
		try {
			await context.storageState({ path: storagePath });
		} catch {}
	}
}

async function extractOnce(config: ExtractorConfig, attempt: number): Promise<SsoTgcResult> {
	const launchOptions = {
		headless: !config.headed,
		args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
	};

	const storagePath = getStorageStatePath(config);
	const contextOptions: Record<string, unknown> = {
		userAgent:
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
		viewport: { width: 1280, height: 800 },
	};

	if (storagePath && existsSync(storagePath)) {
		contextOptions.storageState = storagePath;
	}

	const browser = await chromium.launch(launchOptions);
	try {
		const context = await browser.newContext(contextOptions as never);

		const existing = await tryExistingSession(context, config);
		if (existing) return existing;

		const page = await context.newPage();
		await page.goto(config.loginUrl, { waitUntil: "networkidle", timeout: 30000 });
		await sleep(2000);

		if (isOnLoginPage(page.url())) {
			await performLogin(page, config);
		}

		await sleep(2000);
		const result = await extractCookieFromContext(context, config);
		await saveStorageState(context, config);
		return result;
	} finally {
		await browser.close();
	}
}

export async function getSSOTGC(config: ExtractorConfig): Promise<SsoTgcResult> {
	let lastError: Error | null = null;
	for (let attempt = 1; attempt <= config.retryTimes; attempt++) {
		try {
			return await extractOnce(config, attempt);
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			if (attempt < config.retryTimes) {
				await sleep(config.retryDelay);
			}
		}
	}
	throw lastError ?? new Error("提取失败");
}
