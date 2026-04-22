import type { BundledLanguage, BundledTheme } from "shiki";

import {
	type CampusCodeHighlightResult,
	DEFAULT_SHIKI_THEMES,
	getSupportedShikiLanguages,
	highlightCampusCode,
	normalizeShikiThemes,
	supportsShikiLanguage,
} from "./shiki-runtime";

export type HighlightResult = CampusCodeHighlightResult;

export type HighlightOptions = {
	code: string;
	language: BundledLanguage;
	themes: [string, string];
};

export type CodePluginOptions = {
	themes?: [BundledTheme, BundledTheme];
};

export type CodeHighlighterPlugin = {
	getSupportedLanguages: () => BundledLanguage[];
	getThemes: () => [BundledTheme, BundledTheme];
	highlight: (
		options: HighlightOptions,
		callback?: (result: HighlightResult) => void,
	) => HighlightResult | null;
	name: "shiki";
	supportsLanguage: (language: BundledLanguage) => boolean;
	type: "code-highlighter";
};

export const createCodePlugin = (options: CodePluginOptions = {}): CodeHighlighterPlugin => {
	const themes = normalizeShikiThemes(options.themes ?? DEFAULT_SHIKI_THEMES) as [
		BundledTheme,
		BundledTheme,
	];

	return {
		getSupportedLanguages: () => getSupportedShikiLanguages() as BundledLanguage[],
		getThemes: () => themes,
		highlight: ({ code, language, themes: incomingThemes }, callback) =>
			highlightCampusCode(
				{
					code,
					language,
					themes: incomingThemes,
				},
				callback,
			),
		name: "shiki",
		supportsLanguage: (language) => supportsShikiLanguage(language),
		type: "code-highlighter",
	};
};

export const code = createCodePlugin();
