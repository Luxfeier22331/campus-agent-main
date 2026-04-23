import type { ThemedToken, TokensResult } from "shiki";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

type ThemeLoader = () => Promise<{ default: unknown }>;
type LanguageLoader = () => Promise<{ default: unknown }>;

const THEME_LOADERS = {
	"github-dark": () => import("shiki/dist/themes/github-dark.mjs"),
	"github-light": () => import("shiki/dist/themes/github-light.mjs"),
} as const satisfies Record<string, ThemeLoader>;

const LANGUAGE_LOADERS = {
	bash: () => import("shiki/dist/langs/bash.mjs"),
	css: () => import("shiki/dist/langs/css.mjs"),
	diff: () => import("shiki/dist/langs/diff.mjs"),
	html: () => import("shiki/dist/langs/html.mjs"),
	ini: () => import("shiki/dist/langs/ini.mjs"),
	javascript: () => import("shiki/dist/langs/javascript.mjs"),
	json: () => import("shiki/dist/langs/json.mjs"),
	json5: () => import("shiki/dist/langs/json5.mjs"),
	jsonc: () => import("shiki/dist/langs/jsonc.mjs"),
	jsx: () => import("shiki/dist/langs/jsx.mjs"),
	markdown: () => import("shiki/dist/langs/markdown.mjs"),
	mdx: () => import("shiki/dist/langs/mdx.mjs"),
	python: () => import("shiki/dist/langs/python.mjs"),
	scss: () => import("shiki/dist/langs/scss.mjs"),
	sql: () => import("shiki/dist/langs/sql.mjs"),
	toml: () => import("shiki/dist/langs/toml.mjs"),
	tsx: () => import("shiki/dist/langs/tsx.mjs"),
	typescript: () => import("shiki/dist/langs/typescript.mjs"),
	xml: () => import("shiki/dist/langs/xml.mjs"),
	yaml: () => import("shiki/dist/langs/yaml.mjs"),
} as const satisfies Record<string, LanguageLoader>;

const LANGUAGE_ALIASES = {
	bash: "bash",
	conf: "ini",
	console: "bash",
	css: "css",
	diff: "diff",
	env: "ini",
	htm: "html",
	html: "html",
	ini: "ini",
	js: "javascript",
	json: "json",
	json5: "json5",
	jsonc: "jsonc",
	jsx: "jsx",
	md: "markdown",
	markdown: "markdown",
	mdx: "mdx",
	py: "python",
	python: "python",
	scss: "scss",
	sh: "bash",
	shell: "bash",
	shellscript: "bash",
	shellsession: "bash",
	sql: "sql",
	toml: "toml",
	ts: "typescript",
	tsx: "tsx",
	typescript: "typescript",
	xml: "xml",
	yaml: "yaml",
	yml: "yaml",
	zsh: "bash",
} as const satisfies Record<string, keyof typeof LANGUAGE_LOADERS>;

const PLAIN_TEXT_ALIASES = new Set(["", "none", "plain", "plaintext", "text", "txt"]);

export const DEFAULT_SHIKI_THEMES = ["github-light", "github-dark"] as const;

export type CampusShikiLanguage = keyof typeof LANGUAGE_LOADERS;
export type CampusShikiTheme = keyof typeof THEME_LOADERS;
export type CampusCodeHighlightResult = Pick<TokensResult, "bg" | "fg" | "rootStyle" | "tokens">;

type CampusLoadedHighlighter = ReturnType<typeof createHighlighterCore>;

type HighlightCallback = (result: CampusCodeHighlightResult) => void;
interface HighlighterOptions {
	code: string;
	language: string;
	themes?: readonly [string, string];
}

const highlighterCache = new Map<string, Promise<CampusLoadedHighlighter>>();
const tokensCache = new Map<string, CampusCodeHighlightResult>();
const subscribers = new Map<string, Set<HighlightCallback>>();
const regexEngine = createJavaScriptRegexEngine({ forgiving: true });

const makeTokensCacheKey = (
	code: string,
	language: string,
	themes: readonly [CampusShikiTheme, CampusShikiTheme],
) => {
	const start = code.slice(0, 100);
	const end = code.length > 100 ? code.slice(-100) : "";
	return `${language}:${themes[0]}:${themes[1]}:${code.length}:${start}:${end}`;
};

const makeHighlighterCacheKey = (
	language: CampusShikiLanguage,
	themes: readonly [CampusShikiTheme, CampusShikiTheme],
) => `${language}:${themes[0]}:${themes[1]}`;

export const getSupportedShikiLanguages = (): CampusShikiLanguage[] =>
	Object.keys(LANGUAGE_LOADERS) as CampusShikiLanguage[];

export const resolveShikiLanguage = (
	language: string | null | undefined,
): CampusShikiLanguage | null => {
	const normalized = (language ?? "")
		.trim()
		.replace(/^language-/, "")
		.toLowerCase();

	if (normalized in LANGUAGE_LOADERS) {
		return normalized as CampusShikiLanguage;
	}

	if (normalized in LANGUAGE_ALIASES) {
		return LANGUAGE_ALIASES[normalized as keyof typeof LANGUAGE_ALIASES];
	}

	if (PLAIN_TEXT_ALIASES.has(normalized)) {
		return null;
	}

	return null;
};

export const supportsShikiLanguage = (language: string): boolean =>
	resolveShikiLanguage(language) !== null;

export const normalizeShikiThemes = (
	themes?: readonly [string, string],
): readonly [CampusShikiTheme, CampusShikiTheme] => {
	if (themes && themes[0] in THEME_LOADERS && themes[1] in THEME_LOADERS) {
		return themes as readonly [CampusShikiTheme, CampusShikiTheme];
	}

	return DEFAULT_SHIKI_THEMES;
};

export const createRawHighlightResult = (code: string): CampusCodeHighlightResult => ({
	bg: "transparent",
	fg: "inherit",
	rootStyle: undefined,
	tokens: code.split("\n").map((line) =>
		line === ""
			? []
			: [
					{
						bgColor: "transparent",
						color: "inherit",
						content: line,
						htmlStyle: {},
						offset: 0,
					} as ThemedToken,
				],
	),
});

const getHighlighter = async (
	language: CampusShikiLanguage,
	themes: readonly [CampusShikiTheme, CampusShikiTheme],
) => {
	const cacheKey = makeHighlighterCacheKey(language, themes);
	const cached = highlighterCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const highlighterPromise = Promise.all([
		LANGUAGE_LOADERS[language](),
		THEME_LOADERS[themes[0]](),
		THEME_LOADERS[themes[1]](),
	]).then(([languageModule, lightTheme, darkTheme]) =>
		createHighlighterCore({
			engine: regexEngine,
			langs: [languageModule.default as never],
			themes: [lightTheme.default as never, darkTheme.default as never],
		}),
	);

	highlighterCache.set(cacheKey, highlighterPromise);
	return highlighterPromise;
};

export const getCampusHighlighter = async (
	language: string,
	themes?: readonly [string, string],
): Promise<CampusLoadedHighlighter | null> => {
	const resolvedLanguage = resolveShikiLanguage(language);
	if (!resolvedLanguage) {
		return null;
	}

	return getHighlighter(resolvedLanguage, normalizeShikiThemes(themes));
};

export const highlightCampusCode = (
	{ code, language, themes }: HighlighterOptions,
	callback?: HighlightCallback,
): CampusCodeHighlightResult | null => {
	const resolvedLanguage = resolveShikiLanguage(language);
	if (!resolvedLanguage) {
		return createRawHighlightResult(code);
	}

	const resolvedThemes = normalizeShikiThemes(themes);
	const tokensCacheKey = makeTokensCacheKey(code, resolvedLanguage, resolvedThemes);
	const cached = tokensCache.get(tokensCacheKey);
	if (cached) {
		return cached;
	}

	if (callback) {
		if (!subscribers.has(tokensCacheKey)) {
			subscribers.set(tokensCacheKey, new Set());
		}
		subscribers.get(tokensCacheKey)?.add(callback);
	}

	getHighlighter(resolvedLanguage, resolvedThemes)
		.then((highlighter) => {
			const result = highlighter.codeToTokens(code, {
				lang: resolvedLanguage,
				themes: {
					dark: resolvedThemes[1],
					light: resolvedThemes[0],
				},
			});

			const tokenized: CampusCodeHighlightResult = {
				bg: result.bg ?? "transparent",
				fg: result.fg ?? "inherit",
				rootStyle: result.rootStyle,
				tokens: result.tokens,
			};

			tokensCache.set(tokensCacheKey, tokenized);

			const activeSubscribers = subscribers.get(tokensCacheKey);
			if (activeSubscribers) {
				for (const subscriber of activeSubscribers) {
					subscriber(tokenized);
				}
				subscribers.delete(tokensCacheKey);
			}
		})
		.catch((error) => {
			console.error("[campus-chat] failed to highlight code", error);
			const rawResult = createRawHighlightResult(code);
			tokensCache.set(tokensCacheKey, rawResult);

			const activeSubscribers = subscribers.get(tokensCacheKey);
			if (activeSubscribers) {
				for (const subscriber of activeSubscribers) {
					subscriber(rawResult);
				}
				subscribers.delete(tokensCacheKey);
			}
		});

	return null;
};
