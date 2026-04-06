import { describe, expect, it } from "vitest";

import chatbotComposerSource from "../src/chatbot-shell/components/chatbot-composer.tsx?raw";
import chatbotEmptyStateSource from "../src/chatbot-shell/components/chatbot-empty-state.tsx?raw";
import chatbotSidebarSource from "../src/chatbot-shell/components/chatbot-sidebar.tsx?raw";
import chatbotShellSource from "../src/chatbot-shell/shell-page.tsx?raw";
import publicChatAppSource from "../src/public-chat/app.tsx?raw";

describe("public chat debug seam removal", () => {
  it("does not keep the temporary /chat/replatform-preview seam or preview-only shell branches", () => {
    expect(publicChatAppSource).not.toContain("/chat/replatform-preview");
    expect(publicChatAppSource).not.toContain("ChatbotShellPreviewPage");
    expect(publicChatAppSource).not.toContain("preview-page");

    expect(chatbotShellSource).not.toContain("preview ?? false");
    expect(chatbotShellSource).not.toContain("preview ?");
    expect(chatbotShellSource).not.toContain("Debug seam");

    expect(chatbotSidebarSource).not.toContain("preview");
    expect(chatbotSidebarSource).not.toContain("Preserved seam");
    expect(chatbotEmptyStateSource).not.toContain("preview");
    expect(chatbotComposerSource).not.toContain("Preview composer");
    expect(chatbotComposerSource).not.toContain("chatbot-preview-composer");
  });
});
