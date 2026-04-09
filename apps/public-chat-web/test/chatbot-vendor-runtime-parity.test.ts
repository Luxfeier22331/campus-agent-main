import { describe, expect, it } from "vitest";

import appShellSource from "../src/platform/chat/app-shell.tsx?raw";
import viteConfigSource from "../vite.config.ts?raw";
import tsconfigSource from "../tsconfig.json?raw";
import vendorGreetingSource from "../vendor/vercel-ai-chatbot/components/chat/greeting.tsx?raw";
import vendorMultimodalInputSource from "../vendor/vercel-ai-chatbot/components/chat/multimodal-input.tsx?raw";
import vendorSuggestedActionsSource from "../vendor/vercel-ai-chatbot/components/chat/suggested-actions.tsx?raw";
import vendorShellSource from "../vendor/vercel-ai-chatbot/components/chat/shell.tsx?raw";
import vendorConstantsSource from "../vendor/vercel-ai-chatbot/lib/constants.ts?raw";

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
});
