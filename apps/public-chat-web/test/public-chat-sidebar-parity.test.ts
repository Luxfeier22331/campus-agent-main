import { describe, expect, it } from "vitest";

import authClientSource from "../src/platform/auth/client.ts?raw";
import appSidebarSource from "../vendor/vercel-ai-chatbot/components/chat/app-sidebar.tsx?raw";
import sidebarHistorySource from "../vendor/vercel-ai-chatbot/components/chat/sidebar-history.tsx?raw";
import sidebarHistoryItemSource from "../vendor/vercel-ai-chatbot/components/chat/sidebar-history-item.tsx?raw";
import sidebarUserNavSource from "../vendor/vercel-ai-chatbot/components/chat/sidebar-user-nav.tsx?raw";

describe("public chat sidebar parity", () => {
  it("keeps logo, new-chat, and delete-current navigation anchored to the repo chat home route", () => {
    expect(appSidebarSource).toContain('<AppLink href="/chat"');
    expect(appSidebarSource).toContain('void router.push("/chat")');
    expect(appSidebarSource).toContain('void router.replace("/chat")');

    expect(sidebarHistorySource).toContain('const activeChatId = useConversationRouteId()');
    expect(sidebarHistorySource).toContain('void router.replace("/chat")');
    expect(sidebarHistoryItemSource).toContain('<AppLink href={`/chat/${chat.id}`}');
  });

  it("delegates authenticated sign-out redirect to the platform auth seam instead of mutating session locally", () => {
    expect(sidebarUserNavSource).toContain('void signOutChatSession({ redirectTo: "/login" })');
    expect(sidebarUserNavSource).not.toContain("setSessionUnauthenticated()");
    expect(sidebarUserNavSource).not.toContain('await router.replace("/login")');

    expect(authClientSource).toContain("redirectTo?: string");
    expect(authClientSource).toContain("authClient.signOut({");
    expect(authClientSource).toContain("fetchOptions:");
    expect(authClientSource).toContain("window.location.assign(redirectTo)");
  });

  it("keeps the platform-side rail seams limited to route and auth mapping", () => {
    expect(appSidebarSource).not.toContain('toast({');
    expect(sidebarHistorySource).not.toContain("Unable to");
    expect(sidebarHistoryItemSource).not.toContain("useChatVisibility");
    expect(sidebarHistoryItemSource).not.toContain("<span>Share</span>");
    expect(sidebarUserNavSource).not.toContain("Unable to sign out right now.");
  });
});
