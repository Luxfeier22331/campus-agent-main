import { chromium, request, type APIRequestContext, type BrowserContext } from "playwright";

import { ensureRuntimeDirs, resolveCollectorConfig, type CollectorConfig } from "./config";

export async function launchContextWithStoredAuth(
  config: CollectorConfig = resolveCollectorConfig(process.env),
): Promise<{ browserContext: BrowserContext; close: () => Promise<void> }> {
  ensureRuntimeDirs(config);
  const browser = await chromium.launch({
    headless: true,
    channel: "chrome",
  });
  const browserContext = await browser.newContext({
    storageState: config.authStorageStatePath,
  });
  return {
    browserContext,
    close: async () => {
      await browser.close();
    },
  };
}

export async function createApiContextFromStorageState(
  config: CollectorConfig = resolveCollectorConfig(process.env),
): Promise<APIRequestContext> {
  ensureRuntimeDirs(config);
  return request.newContext({
    baseURL: config.portalBaseUrl,
    storageState: config.authStorageStatePath,
    extraHTTPHeaders: {
      "x-requested-with": "XMLHttpRequest",
      accept: "application/json, text/plain, */*",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      referer: config.portalPageUrl.replace(/#.*$/, ""),
    },
  });
}
