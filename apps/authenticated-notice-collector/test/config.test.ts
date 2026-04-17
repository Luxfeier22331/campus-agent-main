import { describe, expect, it } from "vitest";

import { applyCollectorNoProxyEnv, resolveCollectorConfig } from "../src/config";

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

  it("appends muc portal hosts into no_proxy and preserves existing entries", () => {
    const env = {
      NO_PROXY: "localhost,127.0.0.1",
    } as NodeJS.ProcessEnv;

    applyCollectorNoProxyEnv(env);

    expect(env.NO_PROXY).toBe(
      "localhost,127.0.0.1,muc.edu.cn,.muc.edu.cn,my.muc.edu.cn,ca.muc.edu.cn",
    );
    expect(env.no_proxy).toBe(env.NO_PROXY);
  });

  it("does not duplicate muc portal hosts when no_proxy already contains them", () => {
    const env = {
      no_proxy: "localhost,.muc.edu.cn,my.muc.edu.cn",
    } as NodeJS.ProcessEnv;

    applyCollectorNoProxyEnv(env);

    expect(env.NO_PROXY).toBe(
      "localhost,.muc.edu.cn,my.muc.edu.cn,muc.edu.cn,ca.muc.edu.cn",
    );
    expect(env.no_proxy).toBe(env.NO_PROXY);
  });
});
