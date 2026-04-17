import { admitOfficialWebUrl } from "./official-web-core.ts";
import type {
  OfficialWebConfigBundle,
  OfficialWebDynamicShellDiscoveryPolicy,
  OfficialWebHostPolicy,
} from "./official-web-core.ts";

import type { CollectedPageArtifact } from "./page-artifacts.ts";

export type { OfficialWebDynamicShellDiscoveryPolicy } from "./official-web-core.ts";

export interface DynamicShellNetworkCapture {
  url: string;
  status: number | null;
  contentType: string | null;
  bodyText: string | null;
}

export interface OfficialWebDynamicShellDiscovererInput {
  bundle: OfficialWebConfigBundle;
  hostPolicy: OfficialWebHostPolicy;
  page: CollectedPageArtifact;
}

export interface OfficialWebDynamicShellDiscoveryAudit {
  sourceUrl: string;
  host: string;
  wait: {
    waitAfterLoadMs: number;
    networkObservationTimeoutMs: number;
    matchedResponseUrl: string | null;
    matchedSelector: string | null;
    usedNetworkIdleFallback: boolean;
    usedFixedDelayFallback: boolean;
  };
  captures: Array<{
    url: string;
    status: number | null;
    contentType: string | null;
    ignored: boolean;
    allowed: boolean;
  }>;
  extractedUrls: string[];
  resolvedUrls: string[];
  admissions: Array<{
    url: string;
    admitted: boolean;
    normalizedUrl: string | null;
    reason: string;
    host: string | null;
  }>;
  promotedUrls: string[];
}

export interface OfficialWebDynamicShellDiscoveryResult {
  promotedUrls: string[];
  audit: OfficialWebDynamicShellDiscoveryAudit;
}

export type OfficialWebDynamicShellDiscovererOutput =
  | string[]
  | OfficialWebDynamicShellDiscoveryResult;

export type OfficialWebDynamicShellDiscoverer = (
  input: OfficialWebDynamicShellDiscovererInput,
) => Promise<OfficialWebDynamicShellDiscovererOutput>;

export function extractPromotedUrlsFromNetworkCaptures(input: {
  baseUrl: string;
  captures: DynamicShellNetworkCapture[];
  policy: OfficialWebDynamicShellDiscoveryPolicy;
}): string[] {
  const allowedRequestMatchers = compilePatterns(input.policy.allowedRequestUrlPatterns);
  const ignoredRequestMatchers = compilePatterns(input.policy.ignoredRequestUrlPatterns);
  const promotedMatchers = compilePatterns(input.policy.promotedUrlPatterns);
  const promotedUrls = new Set<string>();

  for (const capture of input.captures) {
    if (matchesAny(capture.url, ignoredRequestMatchers)) {
      continue;
    }
    if (allowedRequestMatchers.length > 0 && !matchesAny(capture.url, allowedRequestMatchers)) {
      continue;
    }

    for (const rawValue of collectCandidateStrings(capture)) {
      const resolvedUrl = resolveCandidateUrl(rawValue, input.baseUrl);
      if (!resolvedUrl || !matchesAny(resolvedUrl, promotedMatchers)) {
        continue;
      }
      promotedUrls.add(resolvedUrl);
      if (promotedUrls.size >= input.policy.maxPromotedUrls) {
        return [...promotedUrls];
      }
    }
  }

  return [...promotedUrls];
}

export async function discoverDynamicShellPromotedUrls(
  input: OfficialWebDynamicShellDiscovererInput,
): Promise<OfficialWebDynamicShellDiscoveryResult> {
  const policy = input.hostPolicy.dynamicShellDiscovery;
  if (!policy?.enabled) {
    return {
      promotedUrls: [],
      audit: {
        sourceUrl: input.page.pageManifest.finalUrl,
        host: input.hostPolicy.host,
        wait: {
          waitAfterLoadMs: 0,
          networkObservationTimeoutMs: 0,
          matchedResponseUrl: null,
          matchedSelector: null,
          usedNetworkIdleFallback: false,
          usedFixedDelayFallback: false,
        },
        captures: [],
        extractedUrls: [],
        resolvedUrls: [],
        admissions: [],
        promotedUrls: [],
      },
    };
  }

  const captureResult = await captureDynamicShellNetwork({
    policy,
    url: input.page.pageManifest.finalUrl,
  });
  const captures = captureResult.captures;
  const extractedUrls = extractPromotedUrlsFromNetworkCaptures({
    baseUrl: input.page.pageManifest.finalUrl,
    captures,
    policy,
  });
  const resolvedUrls = await resolvePromotedUrlsWithHtmlRedirects({
    urls: extractedUrls,
    userAgent: input.bundle.site.userAgent,
  });
  const promotedUrls = new Set<string>();
  const admissions: OfficialWebDynamicShellDiscoveryAudit["admissions"] = [];

  for (const url of resolvedUrls) {
    const admission = admitOfficialWebUrl(input.bundle, {
      url,
      discoveryMethod: "manual_requeue",
    });
    admissions.push({
      url,
      admitted: admission.admitted,
      normalizedUrl: admission.normalizedUrl,
      reason: admission.reason,
      host: admission.host,
    });
    if (!admission.admitted || admission.normalizedUrl == null) {
      continue;
    }

    const admittedHost = new URL(admission.normalizedUrl).hostname.toLowerCase();
    if (admittedHost !== input.hostPolicy.host) {
      continue;
    }

    promotedUrls.add(admission.normalizedUrl);
    if (promotedUrls.size >= policy.maxPromotedUrls) {
      break;
    }
  }

  return {
    promotedUrls: [...promotedUrls],
    audit: {
      sourceUrl: input.page.pageManifest.finalUrl,
      host: input.hostPolicy.host,
      wait: captureResult.wait,
      captures: captures.map((capture) => ({
        url: capture.url,
        status: capture.status,
        contentType: capture.contentType,
        ignored: matchesAny(capture.url, compilePatterns(policy.ignoredRequestUrlPatterns)),
        allowed:
          policy.allowedRequestUrlPatterns.length === 0 ||
          matchesAny(capture.url, compilePatterns(policy.allowedRequestUrlPatterns)),
      })),
      extractedUrls,
      resolvedUrls,
      admissions,
      promotedUrls: [...promotedUrls],
    },
  };
}

export async function resolvePromotedUrlsWithHtmlRedirects(input: {
  urls: string[];
  userAgent: string;
  fetchImpl?: typeof fetch;
}): Promise<string[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const resolved = new Set<string>();

  for (const url of input.urls) {
    const redirectTarget = await maybeResolveHtmlRedirectTarget({
      url,
      userAgent: input.userAgent,
      fetchImpl,
    });
    resolved.add(redirectTarget ?? url);
  }

  return [...resolved];
}

async function captureDynamicShellNetwork(input: {
  policy: OfficialWebDynamicShellDiscoveryPolicy;
  url: string;
}): Promise<{
  captures: DynamicShellNetworkCapture[];
  wait: OfficialWebDynamicShellDiscoveryAudit["wait"];
}> {
  const moduleName = "playwright";
  const playwright = await import(moduleName);
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  const captures: DynamicShellNetworkCapture[] = [];
  const pendingCaptures: Array<Promise<void>> = [];
  const responseWaitPromise = waitForAnyResponse({
    page,
    patterns: compilePatterns(input.policy.waitForResponseUrlPatterns),
    timeoutMs: input.policy.networkObservationTimeoutMs,
  });
  const selectorWaitPromise = waitForAnySelector({
    page,
    selectors: input.policy.waitForSelectorPatterns,
    timeoutMs: input.policy.networkObservationTimeoutMs,
  });
  let matchedResponseUrl: string | null = null;
  let matchedSelector: string | null = null;
  let usedNetworkIdleFallback = false;
  let usedFixedDelayFallback = false;

  page.on("response", (response: {
    url(): string;
    status(): number;
    headers(): Record<string, string>;
    text(): Promise<string>;
  }) => {
    pendingCaptures.push(
      (async () => {
        const url = response.url();
        const contentType = normalizeHeaderValue(response.headers()["content-type"]);
        const status = response.status();
        if (status >= 400 || !isTextLikeContentType(contentType)) {
          return;
        }

        try {
          captures.push({
            url,
            status,
            contentType,
            bodyText: await response.text(),
          });
        } catch {
          captures.push({
            url,
            status,
            contentType,
            bodyText: null,
          });
        }
      })(),
    );
  });

  try {
    await page.goto(input.url, { waitUntil: "load" });
    [matchedResponseUrl, matchedSelector] = await Promise.all([responseWaitPromise, selectorWaitPromise]);
    if (matchedResponseUrl == null && matchedSelector == null) {
      usedNetworkIdleFallback = true;
      try {
        await page.waitForLoadState("networkidle", {
          timeout: Math.max(250, Math.min(5_000, input.policy.waitAfterLoadMs)),
        });
      } catch {
        // Some shell pages never reach a quiet network state. Fall back to fixed wait.
      }
      usedFixedDelayFallback = true;
      await page.waitForTimeout(input.policy.waitAfterLoadMs);
    } else {
      try {
        await page.waitForLoadState("networkidle", {
          timeout: input.policy.networkObservationTimeoutMs,
        });
      } catch {
        usedFixedDelayFallback = true;
        await page.waitForTimeout(input.policy.waitAfterLoadMs);
      }
    }
    await drainPendingCaptures(pendingCaptures);
  } finally {
    await page.close();
    await browser.close();
  }

  return {
    captures,
    wait: {
      waitAfterLoadMs: input.policy.waitAfterLoadMs,
      networkObservationTimeoutMs: input.policy.networkObservationTimeoutMs,
      matchedResponseUrl,
      matchedSelector,
      usedNetworkIdleFallback,
      usedFixedDelayFallback,
    },
  };
}

function collectCandidateStrings(capture: DynamicShellNetworkCapture): string[] {
  const values = new Set<string>();
  values.add(capture.url);

  if (!capture.bodyText) {
    return [...values];
  }

  for (const value of extractUrlLikeStrings(capture.bodyText)) {
    values.add(value);
  }

  if (capture.contentType?.includes("json")) {
    for (const value of extractJsonStringValues(capture.bodyText)) {
      values.add(value);
    }
  }

  return [...values];
}

function extractJsonStringValues(raw: string): string[] {
  try {
    return [...walkJsonStringValues(JSON.parse(raw))];
  } catch {
    return [];
  }
}

function* walkJsonStringValues(value: unknown): Generator<string> {
  if (typeof value === "string") {
    yield value;
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        yield* walkJsonStringValues(JSON.parse(trimmed));
      } catch {
        // Ignore nested string values that are not JSON payloads.
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      yield* walkJsonStringValues(item);
    }
    return;
  }

  if (typeof value === "object" && value != null) {
    for (const item of Object.values(value)) {
      yield* walkJsonStringValues(item);
    }
  }
}

function extractUrlLikeStrings(value: string): string[] {
  const matches = value.match(
    /(https?:\/\/[^\s"'<>\\]+|\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+)/g,
  );
  return matches ?? [];
}

function resolveCandidateUrl(candidate: string, baseUrl: string): string | null {
  const trimmed = decodeUrlLikeValue(candidate);
  if (!trimmed || trimmed.startsWith("javascript:") || trimmed.startsWith("data:")) {
    return null;
  }

  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

function isTextLikeContentType(value: string | null): boolean {
  if (!value) {
    return false;
  }

  return (
    value.includes("json") ||
    value.includes("html") ||
    value.includes("text/") ||
    value.includes("javascript")
  );
}

function normalizeHeaderValue(value: string | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  return value.toLowerCase();
}

async function maybeResolveHtmlRedirectTarget(input: {
  url: string;
  userAgent: string;
  fetchImpl: typeof fetch;
}): Promise<string | null> {
  if (!/\/engine2\/general-rest\/.+\/(?:proxy-detail-url|outer-proxy-detail-url)/i.test(input.url)) {
    return null;
  }

  const response = await input.fetchImpl(input.url, {
    headers: {
      "user-agent": input.userAgent,
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  const bodyText = await response.text();
  const redirectTarget = extractHtmlRedirectTarget(bodyText, input.url);
  return redirectTarget;
}

function extractHtmlRedirectTarget(bodyText: string, baseUrl: string): string | null {
  const locationMatch = bodyText.match(
    /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
  );
  const metaRefreshMatch = bodyText.match(
    /http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'>]+)["']/i,
  );
  const candidate = locationMatch?.[1] ?? metaRefreshMatch?.[1] ?? null;
  if (!candidate) {
    return null;
  }
  return resolveCandidateUrl(candidate, baseUrl);
}

function decodeUrlLikeValue(value: string): string {
  return value
    .trim()
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/&amp;/gi, "&");
}

function compilePatterns(values: string[]): RegExp[] {
  return values.map((value) => new RegExp(value, "i"));
}

function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

async function drainPendingCaptures(pendingCaptures: Array<Promise<void>>): Promise<void> {
  let snapshotSize = -1;
  while (snapshotSize !== pendingCaptures.length) {
    snapshotSize = pendingCaptures.length;
    await Promise.allSettled([...pendingCaptures]);
  }
}

async function waitForAnyResponse(input: {
  page: {
    waitForResponse(
      urlOrPredicate: string | RegExp | ((response: { url(): string }) => boolean | Promise<boolean>),
      options?: { timeout?: number },
    ): Promise<{ url(): string }>;
  };
  patterns: RegExp[];
  timeoutMs: number;
}): Promise<string | null> {
  if (input.patterns.length === 0) {
    return null;
  }

  try {
    const matched = await Promise.any(
      input.patterns.map((pattern) =>
        input.page
          .waitForResponse((response) => pattern.test(response.url()), {
            timeout: input.timeoutMs,
          })
          .then((response) => response.url()),
      ),
    );
    return matched;
  } catch {
    return null;
  }
}

async function waitForAnySelector(input: {
  page: {
    waitForSelector(
      selector: string,
      options?: { timeout?: number; state?: "attached" | "detached" | "visible" | "hidden" },
    ): Promise<unknown>;
  };
  selectors: string[];
  timeoutMs: number;
}): Promise<string | null> {
  if (input.selectors.length === 0) {
    return null;
  }

  try {
    const matched = await Promise.any(
      input.selectors.map((selector) =>
        input.page
          .waitForSelector(selector, {
            timeout: input.timeoutMs,
            state: "attached",
          })
          .then(() => selector),
      ),
    );
    return matched;
  } catch {
    return null;
  }
}
