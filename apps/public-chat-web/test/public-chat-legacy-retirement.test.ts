import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("public chat legacy retirement", () => {
  it("does not keep legacy shell directories or duplicate auth clients in the app source tree", () => {
    expect(existsSync(new URL("../src/chatbot-shell", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../src/chatbot-donor", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../src/public-chat", import.meta.url))).toBe(false);
  });
});
