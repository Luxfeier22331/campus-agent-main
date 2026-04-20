import { describe, expect, it } from "vitest";

import forgotPasswordPageSource from "../src/login/forgot-password-page.tsx?raw";
import loginPageSource from "../src/login/page.tsx?raw";
import recoveryFormSource from "../src/login/recovery-form.tsx?raw";
import registerPageSource from "../src/login/register-page.tsx?raw";
import resetPasswordPageSource from "../src/login/reset-password-page.tsx?raw";
import authFormSource from "../src/platform/vendor-compat/components/chat/auth-form.tsx?raw";
import authLayoutCompatSource from "../src/platform/vendor-compat/app/auth-layout.tsx?raw";
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
    expect(loginPageSource).toContain("继续查看历史对话与提问记录");
    expect(loginPageSource).toContain('href="/forgot-password"');
    expect(loginPageSource).not.toContain('from "next-auth/react"');
    expect(loginPageSource).not.toContain("Campus Agent");
    expect(loginPageSource).not.toContain("Sign in to your account to continue");
    expect(loginPageSource).not.toContain('data-slot="auth-recovery-cta"');
    expect(loginPageSource).not.toContain("AuthTurnstileField");
    expect(loginPageSource).not.toContain('id="login-name"');

    expect(registerPageSource).toContain("useActionState");
    expect(registerPageSource).toContain('from "@/components/chat/auth-form"');
    expect(registerPageSource).toContain('from "@/components/chat/submit-button"');
    expect(registerPageSource).toContain('from "@/components/chat/toast"');
    expect(registerPageSource).toContain("AuthLayout");
    expect(registerPageSource).toContain("使用校园邮箱创建账号");
    expect(registerPageSource).not.toContain('from "next-auth/react"');
    expect(registerPageSource).not.toContain("Campus Agent");
    expect(registerPageSource).not.toContain("AuthTurnstileField");
  });

  it("exposes a dedicated register route for the donor auth flow", () => {
    expect(appRouterSource).toContain('path: "/login"');
    expect(appRouterSource).toContain('path: "/register"');
  });

  it("turns the login recovery CTA into a real recovery route entry", () => {
    expect(loginPageSource).toContain('href="/forgot-password"');
    expect(appRouterSource).toContain('path: "/forgot-password"');
    expect(appRouterSource).toContain('path: "/reset-password"');
  });

  it("keeps forgot/reset password inside the same public auth family", () => {
    expect(forgotPasswordPageSource).toContain("useActionState");
    expect(forgotPasswordPageSource).toContain("AuthLayout");
    expect(forgotPasswordPageSource).toContain('from "@/components/chat/submit-button"');
    expect(forgotPasswordPageSource).toContain("输入注册邮箱后，我们会发送重置邮件");
    expect(forgotPasswordPageSource).toContain("如果该邮箱已关联账号");
    expect(recoveryFormSource).toContain("AuthTurnstileField");
    expect(recoveryFormSource).toContain('action="request-password-reset"');
    expect(resetPasswordPageSource).toContain("useActionState");
    expect(resetPasswordPageSource).toContain("AuthLayout");
    expect(resetPasswordPageSource).toContain("PasswordRecoveryResetForm");
    expect(resetPasswordPageSource).not.toContain("AuthTurnstileField");
    expect(resetPasswordPageSource).toContain("设置完成后，请使用新密码重新登录");
    expect(resetPasswordPageSource).toContain("当前链接已失效");
    expect(recoveryFormSource).toContain("confirmPassword");
  });

  it("keeps Turnstile inside the login/register/recovery auth pages only", () => {
    expect(viteConfigSource).toContain('find: /^@\\/components\\/chat\\/auth-form$/');
    expect(tsconfigSource).toContain('"@/components/chat/auth-form"');
    expect(recoveryFormSource).toContain("AuthTurnstileField");
  });

  it("owns the auth layout through a repo-managed compat seam and removes the donor preview panel", () => {
    expect(viteConfigSource).toContain('find: /^@\\/app\\/\\(auth\\)\\/layout$/');
    expect(tsconfigSource).toContain('"@/app/(auth)/layout"');
    expect(authLayoutCompatSource).not.toContain("Preview");
    expect(authLayoutCompatSource).not.toContain("Powered by AI Gateway");
    expect(authLayoutCompatSource).toContain("账号服务");
    expect(authLayoutCompatSource).toContain("返回首页");
    expect(authLayoutCompatSource).not.toContain("认证过程仅在当前站点内完成");
  });

  it("localizes shared auth field copy through the repo-owned compat forms", () => {
    expect(authLayoutCompatSource).not.toContain("Secure account access");
    expect(authFormSource).toContain('autoComplete={passwordAutocomplete}');
    expect(authFormSource).toContain('"current-password"');
    expect(authFormSource).toContain('"new-password"');
    expect(recoveryFormSource).toContain("邮箱");
    expect(recoveryFormSource).toContain("新密码");
    expect(recoveryFormSource).toContain("确认密码");
    expect(recoveryFormSource).not.toContain("New password");
    expect(recoveryFormSource).not.toContain("Confirm password");
  });

  it("owns next/form through an exact compat alias for donor auth components", () => {
    expect(viteConfigSource).toContain('find: /^next\\/form$/');
    expect(tsconfigSource).toContain('"next/form"');
  });
});
