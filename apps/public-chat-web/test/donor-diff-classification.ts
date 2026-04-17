export const donorComparisonIgnoredPaths = [
  ".cursor/rules/ultracite.mdc",
  ".github/workflows/lint.yml",
  ".github/workflows/playwright.yml",
  ".vscode/extensions.json",
  ".vscode/settings.json",
] as const;

export const acceptedProductDiffPaths = [
  "artifacts/actions.ts",
  "components/chat/chat-header.tsx",
  "components/chat/greeting.tsx",
  "components/chat/message-editor.tsx",
  "components/chat/message.tsx",
  "components/chat/multimodal-input.tsx",
  "components/chat/shell.tsx",
  "components/chat/sidebar-history-item.tsx",
  "components/chat/sidebar-user-nav.tsx",
  "components/chat/suggested-actions.tsx",
] as const;

export const acceptedRuntimeCompatibilityDiffPaths = [
  "app/globals.css",
  "artifacts/text/client.tsx",
  "components/chat/document-preview.tsx",
  "components/chat/sidebar-history.tsx",
  "components/chat/toolbar.tsx",
  "next-env.d.ts",
] as const;

export const historicalDebtDiffPaths: readonly string[] = [];

export type ExactCompatSeam = {
  importerNeedle?: string;
  kind: "alias" | "importer-scoped-resolver";
  ownerPath: string;
  specifier: string;
  tsconfigNeedle?: string;
  viteNeedle: string;
};

export const exactCompatSeams: readonly ExactCompatSeam[] = [
  {
    kind: "alias",
    ownerPath: "src/platform/vendor-compat/next/link.tsx",
    specifier: "next/link",
    tsconfigNeedle: '"next/link": ["src/platform/vendor-compat/next/link.tsx"]',
    viteNeedle: 'find: /^next\\/link$/',
  },
  {
    kind: "alias",
    ownerPath: "src/platform/vendor-compat/next/navigation.ts",
    specifier: "next/navigation",
    tsconfigNeedle: '"next/navigation": ["src/platform/vendor-compat/next/navigation.ts"]',
    viteNeedle: 'find: /^next\\/navigation$/',
  },
  {
    kind: "alias",
    ownerPath: "src/platform/vendor-compat/next/image.tsx",
    specifier: "next/image",
    tsconfigNeedle: '"next/image": ["src/platform/vendor-compat/next/image.tsx"]',
    viteNeedle: 'find: /^next\\/image$/',
  },
  {
    kind: "alias",
    ownerPath: "src/platform/vendor-compat/next-auth/react.tsx",
    specifier: "next-auth/react",
    tsconfigNeedle: '"next-auth/react": ["src/platform/vendor-compat/next-auth/react.tsx"]',
    viteNeedle: 'find: /^next-auth\\/react$/',
  },
  {
    kind: "alias",
    ownerPath: "src/platform/vendor-compat/next-auth/index.ts",
    specifier: "next-auth",
    tsconfigNeedle: '"next-auth": ["src/platform/vendor-compat/next-auth/index.ts"]',
    viteNeedle: 'find: /^next-auth$/',
  },
  {
    kind: "alias",
    ownerPath: "src/platform/vendor-compat/streamdown/code.ts",
    specifier: "@streamdown/code",
    tsconfigNeedle: '"@streamdown/code": ["src/platform/vendor-compat/streamdown/code.ts"]',
    viteNeedle: 'find: /^@streamdown\\/code$/',
  },
  {
    kind: "alias",
    ownerPath: "src/platform/vendor-compat/app/chat-actions.ts",
    specifier: "@/app/(chat)/actions",
    tsconfigNeedle: '"@/app/(chat)/actions": ["src/platform/vendor-compat/app/chat-actions.ts"]',
    viteNeedle: 'find: /^@\\/app\\/\\(chat\\)\\/actions$/',
  },
  {
    kind: "alias",
    ownerPath: "src/platform/vendor-compat/hooks/use-active-chat.ts",
    specifier: "@/hooks/use-active-chat",
    tsconfigNeedle: '"@/hooks/use-active-chat": ["src/platform/vendor-compat/hooks/use-active-chat.ts"]',
    viteNeedle: 'find: /^@\\/hooks\\/use-active-chat$/',
  },
  {
    kind: "alias",
    ownerPath: "src/platform/vendor-compat/hooks/use-chat-visibility.ts",
    specifier: "@/hooks/use-chat-visibility",
    tsconfigNeedle: '"@/hooks/use-chat-visibility": ["src/platform/vendor-compat/hooks/use-chat-visibility.ts"]',
    viteNeedle: 'find: /^@\\/hooks\\/use-chat-visibility$/',
  },
  {
    kind: "alias",
    ownerPath: "src/platform/vendor-compat/lib/ai/models.ts",
    specifier: "@/lib/ai/models",
    tsconfigNeedle: '"@/lib/ai/models": ["src/platform/vendor-compat/lib/ai/models.ts"]',
    viteNeedle: 'find: /^@\\/lib\\/ai\\/models$/',
  },
  {
    kind: "alias",
    ownerPath: "src/platform/vendor-compat/lib/constants.ts",
    specifier: "@/lib/constants",
    tsconfigNeedle: '"@/lib/constants": ["src/platform/vendor-compat/lib/constants.ts"]',
    viteNeedle: 'find: /^@\\/lib\\/constants$/',
  },
  {
    kind: "alias",
    ownerPath: "src/platform/vendor-compat/lib/db/schema.ts",
    specifier: "@/lib/db/schema",
    tsconfigNeedle: '"@/lib/db/schema": ["src/platform/vendor-compat/lib/db/schema.ts"]',
    viteNeedle: 'find: /^@\\/lib\\/db\\/schema$/',
  },
  {
    kind: "importer-scoped-resolver",
    importerNeedle: "vendor/vercel-ai-chatbot/artifacts/actions.ts",
    ownerPath: "src/platform/vendor-compat/lib/db/queries.ts",
    specifier: "@/lib/db/queries",
    tsconfigNeedle: '"@/lib/db/queries": ["src/platform/vendor-compat/lib/db/queries.ts"]',
    viteNeedle: 'source === "@/lib/db/queries"',
  },
  {
    kind: "alias",
    ownerPath: "src/platform/vendor-compat/lib/editor/diff.ts",
    specifier: "@/lib/editor/diff",
    tsconfigNeedle: '"@/lib/editor/diff": ["src/platform/vendor-compat/lib/editor/diff.ts"]',
    viteNeedle: 'find: /^@\\/lib\\/editor\\/diff$/',
  },
  {
    kind: "alias",
    ownerPath: "src/platform/vendor-compat/lib/types.ts",
    specifier: "@/lib/types",
    tsconfigNeedle: '"@/lib/types": ["src/platform/vendor-compat/lib/types.ts"]',
    viteNeedle: 'find: /^@\\/lib\\/types$/',
  },
  {
    kind: "alias",
    ownerPath: "src/platform/vendor-compat/lib/utils.ts",
    specifier: "@/lib/utils",
    tsconfigNeedle: '"@/lib/utils": ["src/platform/vendor-compat/lib/utils.ts"]',
    viteNeedle: 'find: /^@\\/lib\\/utils$/',
  },
  {
    kind: "importer-scoped-resolver",
    importerNeedle: "vendor/vercel-ai-chatbot/components/ai-elements/code-block.tsx",
    ownerPath: "src/platform/vendor-compat/shiki.ts",
    specifier: "shiki",
    viteNeedle: 'source === "shiki"',
  },
] as const;

export const expectedVendorDiffPaths = [
  ...acceptedProductDiffPaths,
  ...acceptedRuntimeCompatibilityDiffPaths,
].sort();
