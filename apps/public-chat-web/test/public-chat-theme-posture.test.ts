import { describe, expect, it } from "vitest";

import appFrameSource from "../src/platform/chat/app-frame.tsx?raw";
import turnstileSource from "../src/platform/auth/turnstile.tsx?raw";
import multimodalInputSource from "../vendor/vercel-ai-chatbot/components/chat/multimodal-input.tsx?raw";
import sheetEditorSource from "../vendor/vercel-ai-chatbot/components/chat/sheet-editor.tsx?raw";
import sidebarUserNavSource from "../vendor/vercel-ai-chatbot/components/chat/sidebar-user-nav.tsx?raw";
import slashCommandsSource from "../vendor/vercel-ai-chatbot/components/chat/slash-commands.tsx?raw";

describe("public chat theme posture", () => {
  it("keeps the runtime shell fixed to light chrome instead of following system theme", () => {
    expect(appFrameSource).not.toContain("ThemeProvider");
    expect(appFrameSource).not.toContain('defaultTheme="system"');
    expect(appFrameSource).not.toContain("enableSystem");
    expect(appFrameSource).not.toContain('theme="system"');
    expect(appFrameSource).not.toContain("html.classList.contains(\"dark\")");
    expect(appFrameSource).toContain('theme="light"');
  });

  it("removes user-facing theme controls from the chat runtime", () => {
    expect(sidebarUserNavSource).not.toContain('from "next-themes"');
    expect(sidebarUserNavSource).not.toContain("user-nav-item-theme");
    expect(sidebarUserNavSource).not.toContain("Toggle dark");
    expect(sidebarUserNavSource).not.toContain("Toggle light");

    expect(multimodalInputSource).not.toContain('from "next-themes"');
    expect(multimodalInputSource).not.toContain('case "theme"');

    expect(slashCommandsSource).not.toContain("PaletteIcon");
    expect(slashCommandsSource).not.toContain('name: "theme"');
    expect(slashCommandsSource).not.toContain('action: "theme"');
  });

  it("uses fixed light integrations for runtime surfaces that previously followed theme state", () => {
    expect(turnstileSource).toContain('theme: "light"');
    expect(turnstileSource).not.toContain('theme: "auto"');

    expect(sheetEditorSource).not.toContain('from "next-themes"');
    expect(sheetEditorSource).toContain('className="rdg-light"');
    expect(sheetEditorSource).not.toContain("rdg-dark");
  });
});
