import { describe, expect, it } from "vitest";

import appShellSource from "../src/platform/chat/app-shell.tsx?raw";
import packageManifestRaw from "../package.json?raw";
import viteConfigSource from "../vite.config.ts?raw";
import vendorChatHeaderSource from "../vendor/vercel-ai-chatbot/components/chat/chat-header.tsx?raw";
import vendorMessageSource from "../vendor/vercel-ai-chatbot/components/chat/message.tsx?raw";
import vendorMessageEditorSource from "../vendor/vercel-ai-chatbot/components/chat/message-editor.tsx?raw";
import vendorMessagesSource from "../vendor/vercel-ai-chatbot/components/chat/messages.tsx?raw";
import tsconfigSource from "../tsconfig.json?raw";
import vendorGreetingSource from "../vendor/vercel-ai-chatbot/components/chat/greeting.tsx?raw";
import vendorArtifactActionsSource from "../vendor/vercel-ai-chatbot/artifacts/actions.ts?raw";
import vendorDataStreamHandlerSource from "../vendor/vercel-ai-chatbot/components/chat/data-stream-handler.tsx?raw";
import vendorMultimodalInputSource from "../vendor/vercel-ai-chatbot/components/chat/multimodal-input.tsx?raw";
import vendorPreviewAttachmentSource from "../vendor/vercel-ai-chatbot/components/chat/preview-attachment.tsx?raw";
import vendorSuggestedActionsSource from "../vendor/vercel-ai-chatbot/components/chat/suggested-actions.tsx?raw";
import vendorShellSource from "../vendor/vercel-ai-chatbot/components/chat/shell.tsx?raw";
import vendorConstantsSource from "../vendor/vercel-ai-chatbot/lib/constants.ts?raw";

const packageManifest = JSON.parse(packageManifestRaw) as {
  scripts?: Record<string, string | undefined>;
};

describe("chatbot vendor runtime parity", () => {
  it("binds the default @ alias to the vendor tree and exposes a dedicated @platform seam", () => {
    expect(viteConfigSource).toContain('"@": path.resolve(__dirname, "vendor/vercel-ai-chatbot")');
    expect(viteConfigSource).toContain('"@platform": path.resolve(__dirname, "src/platform")');
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
    expect(packageManifest.scripts?.["dev:live-smoke"]).toContain("--port 5173");
    expect(packageManifest.scripts?.["dev:live-smoke"]).toContain("--strictPort");
    expect(viteConfigSource).toContain("PUBLIC_CHAT_LIVE_SMOKE");
    expect(viteConfigSource).toContain("auxiliaryWorkers");
    expect(viteConfigSource).toContain("../app-api/wrangler.local-smoke.toml");
    expect(viteConfigSource).toContain("inspectorPort: false");
  });

  it("hydrates app-api local env before booting the live-smoke auxiliary worker", () => {
    expect(viteConfigSource).toContain("process.loadEnvFile");
    expect(viteConfigSource).toContain("../app-api/.env");
  });

  it("patches the vendor shell to consume platform-owned chat state instead of local donor hooks", () => {
    expect(vendorShellSource).toContain("@platform/chat/use-active-chat");
    expect(vendorShellSource).not.toContain("@/hooks/use-active-chat");
  });

  it("moves campus-domain greeting copy into the vendor greeting component", () => {
    expect(vendorGreetingSource).toContain("今天想确认什么校园信息？");
    expect(vendorGreetingSource).toContain("培养方案");
  });

  it("moves campus-domain composer placeholder into the vendor multimodal input", () => {
    expect(vendorMultimodalInputSource).toContain(
      "Ask about curriculum plans, required courses, policies, or campus services...",
    );
  });

  it("moves campus-domain suggested actions into the vendor-owned suggestion sources", () => {
    expect(vendorSuggestedActionsSource).toContain("suggestions");
    expect(vendorConstantsSource).toContain("法学民族班培养方案里大二下有什么课");
    expect(vendorConstantsSource).toContain("哪些专业要上习概");
  });

  it("keeps the donor chat header chrome while taking unsupported sharing controls off the launch path", () => {
    expect(vendorChatHeaderSource).toContain("VercelIcon");
    expect(vendorChatHeaderSource).toContain("AppLink");
    expect(vendorChatHeaderSource).toContain("Deploy with Vercel");
    expect(vendorChatHeaderSource).not.toContain("VisibilitySelector");
    expect(vendorChatHeaderSource).not.toContain("conversationTitle");
    expect(vendorChatHeaderSource).not.toContain("新对话");
  });

  it("keeps the donor multimodal composer chrome instead of the reduced local composer", () => {
    expect(vendorMultimodalInputSource).toContain("ModelSelector");
    expect(vendorMultimodalInputSource).toContain("PromptInputTools");
    expect(vendorMultimodalInputSource).toContain("PaperclipIcon");
    expect(vendorMultimodalInputSource).toContain("SlashCommandMenu");
    expect(vendorMultimodalInputSource).toContain("PreviewAttachment");
  });

  it("keeps the donor shell composition with artifact and edit wiring", () => {
    expect(vendorShellSource).toContain('import { Artifact } from "./artifact";');
    expect(vendorShellSource).toContain("DataStreamHandler");
    expect(vendorShellSource).toContain("submitEditedMessage");
    expect(vendorShellSource).toContain("setEditingMessage");
    expect(vendorShellSource).not.toContain("ArtifactPanel");
    expect(vendorShellSource).not.toContain("ArtifactPlaceholder");
    expect(vendorShellSource).not.toContain("shouldRenderArtifact");
    expect(vendorShellSource).not.toContain('lazy(async () =>');
    expect(vendorShellSource).not.toContain("<Suspense");
  });

  it("keeps the donor message list wiring instead of the simplified preview-only thread", () => {
    expect(vendorMessagesSource).toContain("addToolApprovalResponse");
    expect(vendorMessagesSource).toContain("setMessages");
    expect(vendorMessagesSource).toContain("regenerate");
    expect(vendorMessagesSource).toContain("useDataStream");
    expect(vendorMessagesSource).toContain("vote");
  });

  it("keeps the donor message chrome, actions, and tool renderers", () => {
    expect(vendorMessageSource).toContain("MessageActions");
    expect(vendorMessageSource).toContain("MessageReasoning");
    expect(vendorMessageSource).toContain("PreviewAttachment");
    expect(vendorMessageSource).toContain("ToolHeader");
    expect(vendorMessageSource).toContain("DocumentPreview");
  });

  it("routes donor message editing through a platform seam instead of reintroducing Next server actions", () => {
    expect(vendorMessageEditorSource).toContain("@platform/chat/message-edits");
    expect(vendorMessageEditorSource).not.toContain('@/app/(chat)/actions');
    expect(vendorMessageEditorSource).toContain("deleteTrailingMessages");
  });

  it("routes donor artifact suggestion loading through a platform seam instead of server-only db actions", () => {
    expect(vendorArtifactActionsSource).toContain("@platform/artifacts/suggestions");
    expect(vendorArtifactActionsSource).not.toContain("@/lib/db/queries");
    expect(vendorArtifactActionsSource).not.toContain('"use server"');
  });

  it("keeps donor artifact streaming ownership inside artifactDefinitions", () => {
    expect(vendorDataStreamHandlerSource).toContain("artifactDefinitions.find");
    expect(vendorDataStreamHandlerSource).toContain("artifactDefinition?.onStreamPart");
    expect(vendorDataStreamHandlerSource).not.toContain("applyArtifactStreamPart");
  });

  it("routes donor attachment previews through a platform image seam instead of next/image", () => {
    expect(vendorPreviewAttachmentSource).toContain("@platform/ui/app-image");
    expect(vendorPreviewAttachmentSource).not.toContain('from "next/image"');
  });
});
