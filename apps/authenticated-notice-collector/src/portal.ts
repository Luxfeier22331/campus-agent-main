import {
  chromium,
  request,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
} from "playwright";

import { ensureRuntimeDirs, resolveCollectorConfig, type CollectorConfig } from "./config";
import type { ApiRequestContextLike, DisposableApiContextLike } from "./types";

type PortalStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export interface BrowserLike {
  close(): Promise<void>;
  newContext(input: { storageState: string | PortalStorageState }): Promise<BrowserContextLike>;
}

export interface BrowserContextLike {
  newPage(): Promise<PageLike>;
  storageState(input?: { path?: string }): Promise<PortalStorageState>;
}

export interface PageLike {
  close?(): Promise<void>;
  goto(url: string, input: { waitUntil: "domcontentloaded" }): Promise<unknown>;
}

export interface CreateApiContextFromStorageStateDependencies {
  launchBrowser?: () => Promise<BrowserLike>;
  createRequestContext?: (input: {
    baseURL: string;
    extraHTTPHeaders: Record<string, string>;
    storageState: PortalStorageState;
  }) => Promise<ApiRequestContextLike & DisposableApiContextLike>;
}

export async function launchContextWithStoredAuth(
  config: CollectorConfig = resolveCollectorConfig(process.env),
  launchBrowser: () => Promise<BrowserLike> = defaultLaunchBrowser,
): Promise<{ browserContext: BrowserContextLike; close: () => Promise<void> }> {
  ensureRuntimeDirs(config);
  const browser = await launchBrowser();
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
  dependencies: CreateApiContextFromStorageStateDependencies = {},
): Promise<ApiRequestContextLike & DisposableApiContextLike> {
  ensureRuntimeDirs(config);
  const { browserContext, close } = await launchContextWithStoredAuth(
    config,
    dependencies.launchBrowser,
  );
  try {
    const page = await browserContext.newPage();
    try {
      // Visiting the portal once refreshes the host-scoped session cookie that
      // the notice API rejects when we reuse storage state directly.
      await page.goto(config.portalPageUrl, { waitUntil: "domcontentloaded" });
      const storageState = await browserContext.storageState({
        path: config.authStorageStatePath,
      });
      return await (dependencies.createRequestContext ?? defaultCreateRequestContext)({
        baseURL: config.portalBaseUrl,
        extraHTTPHeaders: buildPortalApiHeaders(config),
        storageState,
      });
    } finally {
      await page.close?.();
    }
  } finally {
    await close();
  }
}

function defaultLaunchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    channel: "chrome",
  });
}

function defaultCreateRequestContext(input: {
  baseURL: string;
  extraHTTPHeaders: Record<string, string>;
  storageState: PortalStorageState;
}): Promise<APIRequestContext> {
  return request.newContext(input);
}

function buildPortalApiHeaders(config: CollectorConfig): Record<string, string> {
  return {
    "x-requested-with": "XMLHttpRequest",
    accept: "application/json, text/plain, */*",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    referer: config.portalPageUrl.replace(/#.*$/, ""),
  };
}
