import { describe, expect, it } from "vitest";
import packageManifestRaw from "../package.json?raw";
import workerSource from "../src/index.ts?raw";
import authTurnstileSource from "../src/platform/auth/turnstile.tsx?raw";
import appShellSource from "../src/platform/chat/app-shell.tsx?raw";
import compatModelsSource from "../src/platform/vendor-compat/lib/ai/models.ts?raw";
import compatConstantsSource from "../src/platform/vendor-compat/lib/constants.ts?raw";
import compatSchemaSource from "../src/platform/vendor-compat/lib/db/schema.ts?raw";
import compatTypesSource from "../src/platform/vendor-compat/lib/types.ts?raw";
import compatUtilsSource from "../src/platform/vendor-compat/lib/utils.ts?raw";
import tsconfigSource from "../tsconfig.json?raw";
import vendorArtifactActionsSource from "../vendor/vercel-ai-chatbot/artifacts/actions.ts?raw";
import vendorAiMessageSource from "../vendor/vercel-ai-chatbot/components/ai-elements/message.tsx?raw";
import vendorPromptInputSource from "../vendor/vercel-ai-chatbot/components/ai-elements/prompt-input.tsx?raw";
import vendorAiReasoningSource from "../vendor/vercel-ai-chatbot/components/ai-elements/reasoning.tsx?raw";
import vendorAppSidebarSource from "../vendor/vercel-ai-chatbot/components/chat/app-sidebar.tsx?raw";
import vendorChatHeaderSource from "../vendor/vercel-ai-chatbot/components/chat/chat-header.tsx?raw";
import vendorDataStreamHandlerSource from "../vendor/vercel-ai-chatbot/components/chat/data-stream-handler.tsx?raw";
import vendorGreetingSource from "../vendor/vercel-ai-chatbot/components/chat/greeting.tsx?raw";
import vendorMessageSource from "../vendor/vercel-ai-chatbot/components/chat/message.tsx?raw";
import vendorMessageEditorSource from "../vendor/vercel-ai-chatbot/components/chat/message-editor.tsx?raw";
import vendorMessagesSource from "../vendor/vercel-ai-chatbot/components/chat/messages.tsx?raw";
import vendorMultimodalInputSource from "../vendor/vercel-ai-chatbot/components/chat/multimodal-input.tsx?raw";
import vendorPreviewAttachmentSource from "../vendor/vercel-ai-chatbot/components/chat/preview-attachment.tsx?raw";
import vendorShellSource from "../vendor/vercel-ai-chatbot/components/chat/shell.tsx?raw";
import vendorSidebarUserNavSource from "../vendor/vercel-ai-chatbot/components/chat/sidebar-user-nav.tsx?raw";
import vendorSuggestedActionsSource from "../vendor/vercel-ai-chatbot/components/chat/suggested-actions.tsx?raw";
import vendorModelsSource from "../vendor/vercel-ai-chatbot/lib/ai/models.ts?raw";
import vendorConstantsSource from "../vendor/vercel-ai-chatbot/lib/constants.ts?raw";
import vendorSchemaSource from "../vendor/vercel-ai-chatbot/lib/db/schema.ts?raw";
import vendorTypesSource from "../vendor/vercel-ai-chatbot/lib/types.ts?raw";
import vendorUtilsSource from "../vendor/vercel-ai-chatbot/lib/utils.ts?raw";
import viteConfigSource from "../vite.config.ts?raw";
import liveSmokeWranglerConfig from "../wrangler.local-smoke.toml?raw";

const packageManifest = JSON.parse(packageManifestRaw) as {
	scripts?: Record<string, string | undefined>;
};

describe("chatbot vendor runtime parity", () => {
	it("binds the default @ alias to the vendor tree and exposes a dedicated @platform seam", () => {
		expect(viteConfigSource).toContain("find: /^@\\/hooks\\/use-active-chat$/");
		expect(viteConfigSource).toContain("find: /^next\\/image$/");
		expect(viteConfigSource).toContain("vendor-compat-resolver");
		expect(viteConfigSource).toContain("src/platform/vendor-compat/shiki.ts");
		expect(viteConfigSource).toContain("src/platform/vendor-compat/lib/db/queries.ts");
		expect(viteConfigSource).toContain("src/platform/vendor-compat/lib/ai/models.ts");
		expect(viteConfigSource).toContain("src/platform/vendor-compat/lib/constants.ts");
		expect(viteConfigSource).toContain("src/platform/vendor-compat/lib/db/schema.ts");
		expect(viteConfigSource).toContain("src/platform/vendor-compat/lib/editor/diff.ts");
		expect(viteConfigSource).toContain("src/platform/vendor-compat/lib/types.ts");
		expect(viteConfigSource).toContain("src/platform/vendor-compat/lib/utils.ts");
		expect(viteConfigSource).toContain('"vendor/vercel-ai-chatbot"');
		expect(viteConfigSource).toContain('"src/platform"');
		expect(tsconfigSource).toContain(
			'"@/lib/ai/models": ["src/platform/vendor-compat/lib/ai/models.ts"]',
		);
		expect(tsconfigSource).toContain(
			'"@/lib/constants": ["src/platform/vendor-compat/lib/constants.ts"]',
		);
		expect(tsconfigSource).toContain(
			'"@/lib/db/schema": ["src/platform/vendor-compat/lib/db/schema.ts"]',
		);
		expect(tsconfigSource).toContain(
			'"@/lib/db/queries": ["src/platform/vendor-compat/lib/db/queries.ts"]',
		);
		expect(tsconfigSource).toContain(
			'"@/lib/editor/diff": ["src/platform/vendor-compat/lib/editor/diff.ts"]',
		);
		expect(tsconfigSource).toContain('"@/lib/types": ["src/platform/vendor-compat/lib/types.ts"]');
		expect(tsconfigSource).toContain('"@/lib/utils": ["src/platform/vendor-compat/lib/utils.ts"]');
		expect(tsconfigSource).toContain('"@/*": ["vendor/vercel-ai-chatbot/*"]');
		expect(tsconfigSource).toContain('"@platform/*": ["src/platform/*"]');
	});

	it("mounts the platform chat shell through platform-owned runtime seams", () => {
		expect(appShellSource).toContain("@platform/chat/use-active-chat");
		expect(appShellSource).toContain("@platform/chat/runtime");
	});

	it("declares a canonical live-smoke dev path that boots app-api as an auxiliary worker", () => {
		expect(packageManifest.scripts?.["dev:live-smoke"]).toContain("PUBLIC_CHAT_LIVE_SMOKE=1");
		expect(packageManifest.scripts?.["dev:live-smoke"]).toContain("--host 127.0.0.1");
		expect(packageManifest.scripts?.dev).toContain("--port 27011");
		expect(packageManifest.scripts?.["dev:live-smoke"]).toContain("--port 27011");
		expect(packageManifest.scripts?.["dev:live-smoke"]).toContain("--strictPort");
		expect(viteConfigSource).toContain("PUBLIC_CHAT_LIVE_SMOKE");
		expect(viteConfigSource).toContain("liveSmokePublicChatConfigPath");
		expect(viteConfigSource).toContain("configPath: liveSmokePublicChatConfigPath");
		expect(viteConfigSource).toContain("auxiliaryWorkers");
		expect(viteConfigSource).toContain("../app-api/wrangler.local-smoke.toml");
		expect(viteConfigSource).toContain("inspectorPort: false");
		expect(liveSmokeWranglerConfig).toContain("[secrets]");
		expect(liveSmokeWranglerConfig).toContain("required = []");
		expect(liveSmokeWranglerConfig).toContain('APP_API_BASE_URL = "https://app-api.internal"');
		expect(liveSmokeWranglerConfig).toContain('PUBLIC_CHAT_HOSTNAME = "127.0.0.1:27011"');
		expect(liveSmokeWranglerConfig).toContain(
			'AUTH_TURNSTILE_SITE_KEY = "1x00000000000000000000AA"',
		);
		expect(liveSmokeWranglerConfig).toContain('AUTH_TURNSTILE_APPEARANCE = "interaction-only"');
		expect(liveSmokeWranglerConfig).toContain('AUTH_TURNSTILE_EXECUTION = "render"');
		expect(liveSmokeWranglerConfig).not.toContain("SENTRY_DSN");
	});

	it("hydrates app-api local env before booting the live-smoke auxiliary worker", () => {
		expect(viteConfigSource).toContain("process.loadEnvFile");
		expect(viteConfigSource).toContain("../app-api/.env");
		expect(viteConfigSource).toContain("liveSmokeSupervisorApiBaseUrl");
		expect(viteConfigSource).toContain("process.env.SUPERVISOR_API_BASE_URL");
		expect(viteConfigSource).toContain("http://127.0.0.1:27051");
	});

	it("keeps runtime vendor imports on donor specifiers and resolves them through exact compat seams", () => {
		expect(vendorShellSource).toContain("@/hooks/use-active-chat");
		expect(vendorShellSource).not.toContain("@platform/chat/use-active-chat");
		expect(vendorPreviewAttachmentSource).toContain('from "next/image"');
		expect(vendorPreviewAttachmentSource).not.toContain("@platform/ui/app-image");
		expect(vendorAppSidebarSource).toContain('from "next/link"');
		expect(vendorAppSidebarSource).toContain('from "next/navigation"');
		expect(vendorSidebarUserNavSource).toContain('from "next-auth/react"');
	});

	it("moves campus-domain greeting copy into the vendor greeting component", () => {
		expect(vendorGreetingSource).toContain("今天想确认什么校园信息？");
		expect(vendorGreetingSource).toContain("培养方案");
	});

	it("moves campus-domain composer placeholder into the vendor multimodal input", () => {
		expect(vendorMultimodalInputSource).toContain(
			"请输入你想了解的校园信息，例如培养方案、课程要求、学生政策或校园服务",
		);
	});

	it("moves campus-domain suggested actions into the constants compat seam", () => {
		expect(vendorSuggestedActionsSource).toContain("suggestions");
		expect(compatConstantsSource).toContain("法学民族班培养方案里大二下有什么课");
		expect(compatConstantsSource).toContain("哪些专业要上习概");
		expect(vendorConstantsSource).not.toContain("法学民族班培养方案里大二下有什么课");
		expect(vendorConstantsSource).not.toContain("哪些专业要上习概");
	});

	it("keeps the donor header layout while replacing donor marketing copy with repo-owned product copy", () => {
		expect(vendorChatHeaderSource).toContain("PenSquareIcon");
		expect(vendorChatHeaderSource).toContain('from "next/link"');
		expect(vendorChatHeaderSource).toContain('href="/"');
		expect(vendorChatHeaderSource).toContain("新建对话");
		expect(vendorChatHeaderSource).not.toContain("VisibilitySelector");
		expect(vendorChatHeaderSource).not.toContain("conversationTitle");
		expect(vendorChatHeaderSource).not.toContain("Deploy with Vercel");
		expect(vendorChatHeaderSource).not.toContain("VercelIcon");
	});

	it("keeps the donor multimodal composer chrome while closing unsupported controls", () => {
		expect(vendorMultimodalInputSource).toContain("PromptInputTools");
		expect(vendorMultimodalInputSource).toContain("PromptInputSubmit");
		expect(vendorMultimodalInputSource).toContain("SlashCommandMenu");
		expect(vendorMultimodalInputSource).not.toContain("ModelSelector");
		expect(vendorMultimodalInputSource).not.toContain("PaperclipIcon");
	});

	it("keeps the donor shell composition with artifact and edit wiring", () => {
		expect(vendorShellSource).toContain('import { Artifact } from "./artifact";');
		expect(vendorShellSource).toContain("DataStreamHandler");
		expect(vendorShellSource).toContain("submitEditedMessage");
		expect(vendorShellSource).toContain("setEditingMessage");
		expect(vendorShellSource).not.toContain("ArtifactPanel");
		expect(vendorShellSource).not.toContain("ArtifactPlaceholder");
		expect(vendorShellSource).not.toContain("shouldRenderArtifact");
		expect(vendorShellSource).not.toContain("lazy(async () =>");
		expect(vendorShellSource).not.toContain("<Suspense");
	});

	it("keeps the donor message list wiring instead of the simplified preview-only thread", () => {
		expect(vendorMessagesSource).toContain("addToolApprovalResponse");
		expect(vendorMessagesSource).toContain("setMessages");
		expect(vendorMessagesSource).toContain("regenerate");
		expect(vendorMessagesSource).toContain("useDataStream");
		expect(vendorMessagesSource).toContain("feedback");
		expect(vendorMessagesSource).not.toContain("vote=");
	});

	it("keeps the donor message chrome, actions, and tool renderers", () => {
		expect(vendorMessageSource).toContain("MessageActions");
		expect(vendorMessageSource).toContain("MessageReasoning");
		expect(vendorMessageSource).toContain("PreviewAttachment");
		expect(vendorMessageSource).toContain("ToolHeader");
		expect(vendorMessageSource).toContain("DocumentPreview");
	});

	it("routes donor message editing through a platform seam instead of reintroducing Next server actions", () => {
		expect(vendorMessageEditorSource).toContain("@/app/(chat)/actions");
		expect(vendorMessageEditorSource).not.toContain("@platform/chat/message-edits");
		expect(vendorMessageEditorSource).toContain("deleteTrailingMessages");
	});

	it("keeps donor artifact suggestion imports on db queries while runtime ownership moves behind an exact compat seam", () => {
		expect(vendorArtifactActionsSource).toContain("@/lib/db/queries");
		expect(vendorArtifactActionsSource).not.toContain("@platform/artifacts/suggestions");
		expect(vendorArtifactActionsSource).not.toContain('"use server"');
	});

	it("keeps donor artifact streaming ownership inside artifactDefinitions", () => {
		expect(vendorDataStreamHandlerSource).toContain("artifactDefinitions.find");
		expect(vendorDataStreamHandlerSource).toContain("artifactDefinition?.onStreamPart");
		expect(vendorDataStreamHandlerSource).not.toContain("applyArtifactStreamPart");
	});

	it("keeps donor attachment preview imports on next/image so image runtime stays behind exact compat seams", () => {
		expect(vendorPreviewAttachmentSource).toContain('from "next/image"');
	});

	it("keeps router ownership behind next/navigation compat instead of direct platform imports", () => {
		expect(vendorMultimodalInputSource).toContain('from "next/navigation"');
		expect(vendorMultimodalInputSource).not.toContain("@platform/router");
		expect(vendorSuggestedActionsSource).toContain('from "next/navigation"');
		expect(vendorSuggestedActionsSource).not.toContain("@platform/router");
	});

	it("keeps streamdown code plugin ownership behind an exact compat seam", () => {
		expect(vendorAiMessageSource).toContain('from "@streamdown/code"');
		expect(vendorAiMessageSource).not.toContain("@platform/chat/streamdown-code-plugin");
		expect(vendorAiReasoningSource).toContain('from "@streamdown/code"');
		expect(vendorAiReasoningSource).not.toContain("@platform/chat/streamdown-code-plugin");
	});

	it("moves vendor lib runtime truth behind exact compat seams while restoring donor lib sources", () => {
		expect(workerSource).not.toContain("./platform/vendor-compat/lib/ai/models");
		expect(workerSource).not.toContain("getAllGatewayModels");
		expect(workerSource).not.toContain("getCapabilities");
		expect(workerSource).not.toContain("../vendor/vercel-ai-chatbot/lib/ai/models");
		expect(vendorModelsSource).toContain("next: { revalidate: 86_400 }");
		expect(compatModelsSource).toContain('cache: "force-cache"');

		expect(vendorSchemaSource).toContain('from "drizzle-orm/pg-core"');
		expect(compatSchemaSource).toContain("export interface Chat {");
		expect(compatSchemaSource).not.toContain("pgTable");

		expect(vendorTypesSource).toContain("InferUITool");
		expect(vendorTypesSource).not.toContain("requestId?: string | null");
		expect(compatTypesSource).toContain("requestId?: string | null");
		expect(compatTypesSource).toContain(
			'kind?: "answer" | "clarification" | "error" | "no_answer" | "user"',
		);

		expect(vendorUtilsSource).toContain("const response = await fetch(url);");
		expect(vendorUtilsSource).not.toContain('credentials: "same-origin"');
		expect(compatUtilsSource).toContain('credentials: "same-origin"');
	});

	it("keeps hidden auth controls addressable while gating prompt attachments closed by default", () => {
		expect(authTurnstileSource).toContain('id="captchaToken"');
		expect(authTurnstileSource).toContain('name="captchaToken"');
		expect(vendorMultimodalInputSource).not.toContain('id="chat-attachment-input"');
		expect(vendorMultimodalInputSource).not.toContain('name="attachments"');
		expect(vendorMultimodalInputSource).toContain("attachmentsEnabled={false}");
		expect(vendorPromptInputSource).toContain("attachmentsEnabled?: boolean");
		expect(vendorPromptInputSource).toContain("attachmentsEnabled = false");
		expect(vendorPromptInputSource).toContain("attachmentsEnabled ? convertedFiles : []");
	});

	it("guards prompt draft persistence with tab-scoped session storage", () => {
		expect(vendorMultimodalInputSource).toContain("isDraftHydrated");
		expect(vendorMultimodalInputSource).toContain("campus-agent.public-chat.input.v1");
		expect(vendorMultimodalInputSource).toContain("CHAT_INPUT_DRAFT_TTL_MS");
		expect(vendorMultimodalInputSource).toContain("window.sessionStorage");
		expect(vendorMultimodalInputSource).toContain("writePromptDraft(input)");
		expect(vendorMultimodalInputSource).not.toContain("useLocalStorage");
		expect(vendorMultimodalInputSource).not.toContain("localStorageInput");
		expect(vendorMultimodalInputSource).not.toContain("setLocalStorageInput");
	});
});
