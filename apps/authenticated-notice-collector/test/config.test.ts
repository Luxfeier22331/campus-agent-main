import { describe, expect, it } from "vitest";

import { resolveCollectorConfig } from "../src/config";

describe("authenticated notice collector config", () => {
  it("uses repo-local runtime defaults and authenticated portal semantics", () => {
    const config = resolveCollectorConfig({});

    expect(config.portalBaseUrl).toBe("https://my.muc.edu.cn");
    expect(config.portalPageUrl).toBe("https://my.muc.edu.cn/page/11#/");
    expect(config.sourceHomeUrl).toBe("https://my.muc.edu.cn");
    expect(config.siteId).toBe("muc_internal_portal");
    expect(config.noticeTypesPath.endsWith("apps/authenticated-notice-collector/config/notice-types.json")).toBe(true);
    expect(config.exportsDir.endsWith("apps/authenticated-notice-collector/runtime/exports")).toBe(true);
    expect(config.requestMaxRetries).toBe(3);
    expect(config.authStorageStatePath.endsWith("apps/authenticated-notice-collector/runtime/auth/storageState.json")).toBe(true);
  });

  it("accepts explicit overrides from env-like input", () => {
    const config = resolveCollectorConfig({
      AUTHENTICATED_NOTICE_AUTH_CHECK_NOTICE_TYPE: "6",
      AUTHENTICATED_NOTICE_BASE_URL: "https://portal.example.edu",
      AUTHENTICATED_NOTICE_PAGE_URL: "https://portal.example.edu/page/99#/",
      AUTHENTICATED_NOTICE_REQUEST_MAX_RETRIES: "5",
      AUTHENTICATED_NOTICE_RUNTIME_DIR: "/tmp/collector-runtime",
    });

    expect(config.portalBaseUrl).toBe("https://portal.example.edu");
    expect(config.portalPageUrl).toBe("https://portal.example.edu/page/99#/");
    expect(config.requestMaxRetries).toBe(5);
    expect(config.authCheckNoticeType).toBe("6");
    expect(config.authStorageStatePath).toBe("/tmp/collector-runtime/auth/storageState.json");
  });
});
