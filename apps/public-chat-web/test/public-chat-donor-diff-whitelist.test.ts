import { describe, expect, it } from "vitest";

import useActiveChatSource from "../src/platform/chat/use-active-chat.tsx?raw";
import artifactsActionsSource from "../vendor/vercel-ai-chatbot/artifacts/actions.ts?raw";
import chatHeaderSource from "../vendor/vercel-ai-chatbot/components/chat/chat-header.tsx?raw";
import messageEditorSource from "../vendor/vercel-ai-chatbot/components/chat/message-editor.tsx?raw";
import previewAttachmentSource from "../vendor/vercel-ai-chatbot/components/chat/preview-attachment.tsx?raw";
import sidebarHistoryItemSource from "../vendor/vercel-ai-chatbot/components/chat/sidebar-history-item.tsx?raw";

describe("public chat donor diff whitelist", () => {
  it("keeps chat sharing off the launch path because campus mode is private-only", () => {
    expect(useActiveChatSource).toContain('visibilityType: "private"');

    expect(chatHeaderSource).not.toContain("VisibilitySelector");
    expect(chatHeaderSource).not.toContain("selectedVisibilityType");

    expect(sidebarHistoryItemSource).not.toContain("useChatVisibility");
    expect(sidebarHistoryItemSource).not.toContain("ShareIcon");
    expect(sidebarHistoryItemSource).not.toContain("<span>Share</span>");
    expect(sidebarHistoryItemSource).not.toContain("<span>Public</span>");
  });

  it("limits donor-visible diffs to accepted platform seams", () => {
    expect(chatHeaderSource).toContain('from "next/link"');
    expect(chatHeaderSource).not.toContain("VisibilitySelector");

    expect(previewAttachmentSource).toContain('from "next/image"');
    expect(previewAttachmentSource).not.toContain("@platform/ui/app-image");

    expect(artifactsActionsSource).toContain("@/lib/db/queries");
    expect(artifactsActionsSource).not.toContain("@platform/artifacts/suggestions");
    expect(artifactsActionsSource).not.toContain('"use server"');

    expect(messageEditorSource).toContain('@/app/(chat)/actions');
    expect(messageEditorSource).not.toContain("@platform/chat/message-edits");
  });
});
