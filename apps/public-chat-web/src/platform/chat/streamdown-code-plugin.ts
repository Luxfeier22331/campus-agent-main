import type { BundledTheme } from "shiki";
import type { CodeHighlighterPlugin } from "streamdown";

import {
	type CampusCodeHighlightResult,
	DEFAULT_SHIKI_THEMES,
	getSupportedShikiLanguages,
	highlightCampusCode,
	normalizeShikiThemes,
	supportsShikiLanguage,
} from "./shiki-runtime";

type StreamdownHighlightResult = Exclude<ReturnType<CodeHighlighterPlugin["highlight"]>, null>;
type StreamdownHighlightCallback = NonNullable<Parameters<CodeHighlighterPlugin["highlight"]>[1]>;

export interface CodePluginOptions {
	themes?: [BundledTheme, BundledTheme];
}

function toStreamdownHighlightResult(result: CampusCodeHighlightResult): StreamdownHighlightResult {
	return result as unknown as StreamdownHighlightResult;
}

export const createCodePlugin = (options: CodePluginOptions = {}): CodeHighlighterPlugin => {
	const themes = normalizeShikiThemes(options.themes ?? DEFAULT_SHIKI_THEMES) as [
		BundledTheme,
		BundledTheme,
	];

	return {
		getSupportedLanguages: () =>
			getSupportedShikiLanguages() as ReturnType<CodeHighlighterPlugin["getSupportedLanguages"]>,
		getThemes: () => themes,
		highlight: ({ code, language, themes: incomingThemes }, callback) => {
			const result = highlightCampusCode(
				{
					code,
					language,
					themes: incomingThemes,
				},
				callback
					? (campusResult) => {
							(callback as StreamdownHighlightCallback)(toStreamdownHighlightResult(campusResult));
						}
					: undefined,
			);
			return result ? toStreamdownHighlightResult(result) : null;
		},
		name: "shiki",
		supportsLanguage: (language) => supportsShikiLanguage(language),
		type: "code-highlighter",
	};
};

export const code = createCodePlugin();
