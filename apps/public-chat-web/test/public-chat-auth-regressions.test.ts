import { describe, expect, it } from "vitest";

import loginPageSource from "../src/login/page.tsx?raw";
import nextAuthCompatSource from "../src/platform/vendor-compat/next-auth/react.tsx?raw";
import sidebarUserNavSource from "../vendor/vercel-ai-chatbot/components/chat/sidebar-user-nav.tsx?raw";

describe("public chat auth regressions", () => {
  it("keeps the active sidebar user-nav in the vendor runtime tree", () => {
    expect(sidebarUserNavSource).toContain('from "next/navigation"');
    expect(sidebarUserNavSource).toContain('from "next-auth/react"');
    expect(nextAuthCompatSource).toContain("signOutChatSession");
    expect(nextAuthCompatSource).toContain("ChatbotShellRuntimeContext");
  });

  it("renders stable login field identifiers for browser autofill and accessibility tooling", () => {
    expect(loginPageSource).toContain('id="login-email"');
    expect(loginPageSource).toContain('name="email"');
    expect(loginPageSource).toContain('id="login-name"');
    expect(loginPageSource).toContain('name="name"');
    expect(loginPageSource).toContain('id="login-password"');
    expect(loginPageSource).toContain('name="password"');
  });
});
