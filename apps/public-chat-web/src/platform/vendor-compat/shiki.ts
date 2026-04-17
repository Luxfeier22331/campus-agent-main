import type { ThemedToken, TokensResult } from "shiki";
import type { BundledLanguage } from "shiki/langs";
import type { BundledTheme } from "shiki/themes";

import {
  createRawHighlightResult,
  getCampusHighlighter,
  resolveShikiLanguage,
} from "@platform/chat/shiki-runtime";

export type { BundledLanguage, BundledTheme, ThemedToken, TokensResult };

export type HighlighterGeneric<Language extends string, Theme extends string> = {
  codeToTokens: (
    code: string,
    options: {
      lang: Language;
      themes: {
        dark: Theme;
        light: Theme;
      };
    },
  ) => TokensResult;
  getLoadedLanguages: () => Language[];
};

type CodeToTokensOptions = {
  lang: BundledLanguage;
  themes: {
    dark: BundledTheme;
    light: BundledTheme;
  };
};

function resolveHighlightedTokens(
  highlighter: Awaited<ReturnType<typeof getCampusHighlighter>>,
  resolvedLanguage: string,
  code: string,
  options: CodeToTokensOptions,
): TokensResult {
  if (!highlighter) {
    return createRawHighlightResult(code) as TokensResult;
  }

  const result = highlighter.codeToTokens(code, {
    lang: resolvedLanguage,
    themes: options.themes,
  });

  return {
    bg: result.bg ?? "transparent",
    fg: result.fg ?? "inherit",
    rootStyle: result.rootStyle,
    tokens: result.tokens,
  } as TokensResult;
}

export async function createHighlighter({
  langs,
  themes,
}: {
  langs: BundledLanguage[];
  themes: BundledTheme[];
}): Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> {
  const configuredThemes = [
    themes[0] ?? ("github-light" as BundledTheme),
    themes[1] ?? ("github-dark" as BundledTheme),
  ] as const satisfies readonly [BundledTheme, BundledTheme];

  const highlighters = new Map<
    BundledLanguage,
    {
      highlighter: Awaited<ReturnType<typeof getCampusHighlighter>>;
      resolvedLanguage: string;
    }
  >();

  for (const language of langs) {
    const resolvedLanguage = resolveShikiLanguage(language);
    if (!resolvedLanguage) {
      continue;
    }

    const highlighter = await getCampusHighlighter(language, configuredThemes);
    highlighters.set(language, {
      highlighter,
      resolvedLanguage,
    });
  }

  return {
    codeToTokens(code: string, options: CodeToTokensOptions) {
      const entry = highlighters.get(options.lang);
      if (!entry) {
        return createRawHighlightResult(code) as TokensResult;
      }

      return resolveHighlightedTokens(
        entry.highlighter,
        entry.resolvedLanguage,
        code,
        options,
      );
    },
    getLoadedLanguages() {
      return [...highlighters.keys()];
    },
  };
}
