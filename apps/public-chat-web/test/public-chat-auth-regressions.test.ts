import { describe, expect, it } from "vitest";

import loginPageSource from "../src/login/page.tsx?raw";
import registerPageSource from "../src/login/register-page.tsx?raw";
import appRouterSource from "../src/routes/app-router.tsx?raw";
import nextAuthCompatSource from "../src/platform/vendor-compat/next-auth/react.tsx?raw";
import sidebarUserNavSource from "../vendor/vercel-ai-chatbot/components/chat/sidebar-user-nav.tsx?raw";
import tsconfigSource from "../tsconfig.json?raw";
import viteConfigSource from "../vite.config.ts?raw";

describe("public chat auth regressions", () => {
  it("keeps the active sidebar user-nav in the vendor runtime tree", () => {
    expect(sidebarUserNavSource).toContain('from "next/navigation"');
    expect(sidebarUserNavSource).toContain('from "next-auth/react"');
    expect(nextAuthCompatSource).toContain("signOutChatSession");
    expect(nextAuthCompatSource).toContain("ChatbotShellRuntimeContext");
  });

  it("uses the donor auth shell on login and register instead of the retired repo-owned mode switch", () => {
    expect(loginPageSource).toContain("useActionState");
    expect(loginPageSource).toContain('from "@/components/chat/auth-form"');
    expect(loginPageSource).toContain('from "@/components/chat/submit-button"');
    expect(loginPageSource).toContain('from "@/components/chat/toast"');
    expect(loginPageSource).toContain("AuthLayout");
    expect(loginPageSource).not.toContain("Public campus chat");
    expect(loginPageSource).not.toContain("Create your chat account");
    expect(loginPageSource).not.toContain('id="login-name"');

    expect(registerPageSource).toContain("useActionState");
    expect(registerPageSource).toContain('from "@/components/chat/auth-form"');
    expect(registerPageSource).toContain('from "@/components/chat/submit-button"');
    expect(registerPageSource).toContain('from "@/components/chat/toast"');
    expect(registerPageSource).toContain("AuthLayout");
  });

  it("exposes a dedicated register route for the donor auth flow", () => {
    expect(appRouterSource).toContain('path: "/login"');
    expect(appRouterSource).toContain('path: "/register"');
  });

  it("owns next/form through an exact compat alias for donor auth components", () => {
    expect(viteConfigSource).toContain('find: /^next\\/form$/');
    expect(tsconfigSource).toContain('"next/form"');
  });
});
