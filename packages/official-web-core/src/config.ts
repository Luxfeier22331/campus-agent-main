import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { OFFICIAL_WEB_REQUIRED_RUN_ARTIFACTS } from "./artifacts.ts";

export const OFFICIAL_WEB_SOURCE_CHANNEL = "official_web";
export const ALLOWED_PUBLIC_KINDS = [
  "content_site",
  "directory_site",
  "portal",
  "app_shell",
] as const;
export const ENABLED_PUBLIC_KINDS = [
  "content_site",
  "directory_site",
] as const;
export const ALLOWED_CREDENTIALS_MODES = ["public", "authenticated"] as const;
export const ALLOWED_DISCOVERY_METHODS = [
  "seed",
  "robots_sitemap",
  "configured_sitemap",
  "navigation",
  "manual_requeue",
] as const;
export const OFFICIAL_WEB_RUN_INTENTS = ["baseline", "hot", "repair"] as const;
export const OFFICIAL_WEB_PROJECTION_ACTIONS = ["emit_document", "manual_review"] as const;
const OFFICIAL_WEB_DECLARABLE_PAGE_FAMILIES = [
  "article_detail",
  "listing_page",
  "directory_page",
  "sitemap_navigation_page",
  "data_table_page",
  "gallery_page",
  "contact_widget_page",
  "structural_shell_page",
  "dynamic_shell_page",
  "generic_content_page",
] as const;
const OFFICIAL_WEB_SHELL_PAGE_FAMILIES = [
  "structural_shell_page",
  "dynamic_shell_page",
] as const;

export type OfficialWebPublicKind = (typeof ALLOWED_PUBLIC_KINDS)[number];
export type OfficialWebCredentialsMode = (typeof ALLOWED_CREDENTIALS_MODES)[number];
export type OfficialWebDiscoveryMethod = (typeof ALLOWED_DISCOVERY_METHODS)[number];
export type OfficialWebRunIntent = (typeof OFFICIAL_WEB_RUN_INTENTS)[number];
export type OfficialWebProjectionAction = (typeof OFFICIAL_WEB_PROJECTION_ACTIONS)[number];
export type OfficialWebDeclarablePageFamily = (typeof OFFICIAL_WEB_DECLARABLE_PAGE_FAMILIES)[number];

export interface OfficialWebSiteConfig {
  schemaVersion: string;
  configVersion: string;
  siteId: string;
  displayName: string;
  sourceChannel: string;
  entryHost: string;
  allowedHosts: string[];
  seedSetVersion: string;
  hostPolicyVersion: string;
  crawlPolicyVersion: string;
  projectionPolicyVersion: string;
  credentialsMode: OfficialWebCredentialsMode;
  userAgent: string;
  requestTimeoutMs: number;
  requestHandlerTimeoutMs: number;
  maxRequestRetries: number;
  maxRedirectHops: number;
}

export interface OfficialWebHostPolicy {
  host: string;
  publicKind: OfficialWebPublicKind;
  enabled: boolean;
  seedUrls: string[];
  allowedPathPrefixes: string[];
  deniedPathPatterns: string[];
  queryParamAllowlist: string[];
  maxDepth: number;
  maxPagesPerRun: number;
  maxConcurrency: number;
  minDelayMs: number;
  respectRobots: boolean;
  explicitSitemaps: string[];
  dynamicShellDiscovery: OfficialWebDynamicShellDiscoveryPolicy | null;
}

export interface OfficialWebDynamicShellDiscoveryPolicy {
  enabled: boolean;
  engine: "playwright";
  waitAfterLoadMs: number;
  networkObservationTimeoutMs: number;
  maxPromotedUrls: number;
  allowedRequestUrlPatterns: string[];
  ignoredRequestUrlPatterns: string[];
  promotedUrlPatterns: string[];
  waitForResponseUrlPatterns: string[];
  waitForSelectorPatterns: string[];
}

export interface OfficialWebHostPolicyDocument {
  schemaVersion: string;
  siteId: string;
  hostPolicyVersion: string;
  hosts: OfficialWebHostPolicy[];
}

export interface OfficialWebSeed {
  seedId: string;
  url: string;
  host: string;
  reason: string;
  discoveryMethod: OfficialWebDiscoveryMethod;
}

export interface OfficialWebSeedSet {
  schemaVersion: string;
  siteId: string;
  seedSetVersion: string;
  seeds: OfficialWebSeed[];
}

export interface OfficialWebCrawlPolicy {
  schemaVersion: string;
  siteId: string;
  crawlPolicyVersion: string;
  schemeAllowlist: string[];
  contentTypeAllowlist: string[];
  discoveryOrder: OfficialWebDiscoveryMethod[];
  defaultQueryPolicy: string;
  defaultQueryParamAllowlist: string[];
  defaultDeniedPathPatterns: string[];
  frontierIdentityKey: string;
  expandWithinSameHostnameOnly: boolean;
  crossHostExpansionRequiresAllowlist: boolean;
  allowCrossHostRedirectOnlyIfAllowlisted: boolean;
  respectRobotsByDefault: boolean;
  robots4xxBehavior: string;
  robots429Behavior: string;
  robots5xxBehavior: string;
  recordRedirectChain: boolean;
  useConditionalFetch: boolean;
  maxTotalPagesPerRun: number;
  maxTotalFailuresPerRun: number;
  maxRuntimeMinutes: number;
}

export interface OfficialWebCredentialsSchema {
  schemaVersion: string;
  siteId: string;
  credentialsMode: OfficialWebCredentialsMode;
  title: string;
  description: string;
  type: string;
  additionalProperties: boolean;
  properties: Record<string, unknown>;
  required: string[];
}

export interface OfficialWebProjectionDeclaration {
  declarationId: string;
  pageFamily: OfficialWebDeclarablePageFamily;
  targetCorpus: string;
  targetCollection: string;
  projectionFamily: string;
  documentKind: string;
  action: OfficialWebProjectionAction;
}

export interface OfficialWebProjectionDeclarations {
  schemaVersion: string;
  siteId: string;
  projectionPolicyVersion: string;
  declarations: OfficialWebProjectionDeclaration[];
}

export interface OfficialWebQcHostOverride {
  host: string;
  allowedReviewIssueCodes: string[];
  allowedReviewPageFamilies: OfficialWebDeclarablePageFamily[];
}

export interface OfficialWebQcPolicy {
  schemaVersion: string;
  siteId: string;
  qcPolicyVersion: string;
  allowedReviewIssueCodes: string[];
  allowedReviewPageFamilies: OfficialWebDeclarablePageFamily[];
  hostOverrides: OfficialWebQcHostOverride[];
}

export interface OfficialWebSchedulerLanePolicy {
  enabled: boolean;
  hostFilter: string[];
  maxPagesPerHost: number;
  maxTotalPages: number;
  notes: string;
  runIntent: OfficialWebRunIntent;
  cadenceMinutes: number;
}

export interface OfficialWebSchedulerPolicy {
  schemaVersion: string;
  siteId: string;
  schedulerPolicyVersion: string;
  timezone: string;
  lanes: OfficialWebSchedulerLanePolicy[];
}

export interface OfficialWebConfigPaths {
  siteId: string;
  siteRoot: string;
  sitePath: string;
  hostsPath: string;
  seedsPath: string;
  crawlPolicyPath: string;
  credentialsSchemaPath: string;
  projectionDeclarationsPath: string;
  schedulerPolicyPath: string;
  qcPolicyPath: string;
}

export interface OfficialWebConfigBundle {
  paths: OfficialWebConfigPaths;
  site: OfficialWebSiteConfig;
  hosts: OfficialWebHostPolicyDocument;
  seeds: OfficialWebSeedSet;
  crawlPolicy: OfficialWebCrawlPolicy;
  credentialsSchema: OfficialWebCredentialsSchema;
  projectionDeclarations: OfficialWebProjectionDeclarations;
  schedulerPolicy: OfficialWebSchedulerPolicy;
  qcPolicy: OfficialWebQcPolicy;
}

export interface OfficialWebPlannedHost {
  host: string;
  publicKind: OfficialWebPublicKind;
  maxDepth: number;
  maxPagesPerRun: number;
  maxConcurrency: number;
  minDelayMs: number;
}

export interface OfficialWebPlannedSeed {
  seedId: string;
  url: string;
  host: string;
  reason: string;
}

export interface OfficialWebCrawlPlan {
  siteId: string;
  crawlRunId: string;
  runIntent: OfficialWebRunIntent;
  generatedAt: string;
  configVersion: string;
  hostPolicyVersion: string;
  crawlPolicyVersion: string;
  schedulerPolicyVersion: string;
  seedSetVersion: string;
  credentialsMode: OfficialWebCredentialsMode;
  entryHost: string;
  enabledHosts: OfficialWebPlannedHost[];
  seeds: OfficialWebPlannedSeed[];
  discoveryOrder: OfficialWebDiscoveryMethod[];
  runLimits: {
    maxTotalPagesPerRun: number;
    maxTotalFailuresPerRun: number;
    maxRuntimeMinutes: number;
  };
  requiredArtifacts: string[];
}

export interface OfficialWebSchedulerPlan {
  generatedAt: string;
  schedulerPolicyVersion: string;
  siteId: string;
  timezone: string;
  lanes: Array<
    OfficialWebSchedulerLanePolicy & {
      schedulerRunKeyPattern: string;
      siteId: string;
    }
  >;
}

function looksLikeRepoRoot(path: string): boolean {
  return (
    existsSync(resolve(path, "pnpm-workspace.yaml")) &&
    existsSync(resolve(path, "configs", "sources", "official_web"))
  );
}

function findRepoRoot(start: string): string | null {
  let current = resolve(start);
  while (true) {
    if (looksLikeRepoRoot(current)) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function defaultRepoRoot(): string {
  const candidates = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
  for (const candidate of candidates) {
    const found = findRepoRoot(candidate);
    if (found) {
      return found;
    }
  }

  throw new Error("Unable to resolve campus-agent repo root from cwd or module path.");
}

export function defaultOfficialWebConfigRoot(repoRoot: string = defaultRepoRoot()): string {
  return resolve(repoRoot, "configs", "sources", "official_web");
}

export function resolveOfficialWebConfigPaths(
  siteId: string,
  options: { repoRoot?: string; configRoot?: string } = {},
): OfficialWebConfigPaths {
  const configRoot = options.configRoot ?? defaultOfficialWebConfigRoot(options.repoRoot);
  const siteRoot = resolve(configRoot, siteId);
  return {
    siteId,
    siteRoot,
    sitePath: resolve(siteRoot, "site.json"),
    hostsPath: resolve(siteRoot, "hosts.json"),
    seedsPath: resolve(siteRoot, "seeds.json"),
    crawlPolicyPath: resolve(siteRoot, "crawl-policy.json"),
    credentialsSchemaPath: resolve(siteRoot, "credentials.schema.json"),
    projectionDeclarationsPath: resolve(siteRoot, "projection-declarations.json"),
    schedulerPolicyPath: resolve(siteRoot, "scheduler-policy.json"),
    qcPolicyPath: resolve(siteRoot, "qc-policy.json"),
  };
}

export function loadOfficialWebConfig(
  siteId: string,
  options: { repoRoot?: string; configRoot?: string } = {},
): OfficialWebConfigBundle {
  const paths = resolveOfficialWebConfigPaths(siteId, options);
  const sitePayload = readJson(paths.sitePath);
  const hostsPayload = readJson(paths.hostsPath);
  const seedsPayload = readJson(paths.seedsPath);
  const crawlPolicyPayload = readJson(paths.crawlPolicyPath);
  const credentialsSchemaPayload = readJson(paths.credentialsSchemaPath);
  const projectionDeclarationsPayload = readJson(paths.projectionDeclarationsPath);
  const schedulerPolicyPayload = readJson(paths.schedulerPolicyPath);
  const qcPolicyPayload = readJson(paths.qcPolicyPath);

  const bundle: OfficialWebConfigBundle = {
    paths,
    site: {
      schemaVersion: asString(sitePayload.schema_version),
      configVersion: asString(sitePayload.config_version),
      siteId: asString(sitePayload.site_id),
      displayName: asString(sitePayload.display_name),
      sourceChannel: asString(sitePayload.source_channel),
      entryHost: asString(sitePayload.entry_host),
      allowedHosts: asStringArray(sitePayload.allowed_hosts),
      seedSetVersion: asString(sitePayload.seed_set_version),
      hostPolicyVersion: asString(sitePayload.host_policy_version),
      crawlPolicyVersion: asString(sitePayload.crawl_policy_version),
      projectionPolicyVersion: asString(sitePayload.projection_policy_version),
      credentialsMode: asCredentialsMode(sitePayload.credentials_mode),
      userAgent: asString(sitePayload.user_agent),
      requestTimeoutMs: asPositiveInt(sitePayload.request_timeout_ms, "request_timeout_ms"),
      requestHandlerTimeoutMs: asPositiveInt(
        sitePayload.request_handler_timeout_ms,
        "request_handler_timeout_ms",
      ),
      maxRequestRetries: asNonNegativeInt(sitePayload.max_request_retries, "max_request_retries"),
      maxRedirectHops: asPositiveInt(sitePayload.max_redirect_hops, "max_redirect_hops"),
    },
    hosts: {
      schemaVersion: asString(hostsPayload.schema_version),
      siteId: asString(hostsPayload.site_id),
      hostPolicyVersion: asString(hostsPayload.host_policy_version),
      hosts: asArray(hostsPayload.hosts).map((item) => ({
        host: asString(item.host),
        publicKind: asPublicKind(item.public_kind),
        enabled: Boolean(item.enabled),
        seedUrls: asStringArray(item.seed_urls),
        allowedPathPrefixes: asStringArray(item.allowed_path_prefixes),
        deniedPathPatterns: asStringArray(item.denied_path_patterns),
        queryParamAllowlist: asStringArray(item.query_param_allowlist),
        maxDepth: asNonNegativeInt(item.max_depth, "max_depth"),
        maxPagesPerRun: asNonNegativeInt(item.max_pages_per_run, "max_pages_per_run"),
        maxConcurrency: asPositiveInt(item.max_concurrency, "max_concurrency"),
        minDelayMs: asNonNegativeInt(item.min_delay_ms, "min_delay_ms"),
        respectRobots: Boolean(item.respect_robots),
        explicitSitemaps: asStringArray(item.explicit_sitemaps),
        dynamicShellDiscovery: asDynamicShellDiscoveryPolicy(item.dynamic_shell_discovery),
      })),
    },
    seeds: {
      schemaVersion: asString(seedsPayload.schema_version),
      siteId: asString(seedsPayload.site_id),
      seedSetVersion: asString(seedsPayload.seed_set_version),
      seeds: asArray(seedsPayload.seeds).map((item) => ({
        seedId: asString(item.seed_id),
        url: asString(item.url),
        host: asString(item.host),
        reason: asString(item.reason),
        discoveryMethod: (item.discovery_method == null
          ? "seed"
          : asDiscoveryMethod(item.discovery_method)) as OfficialWebDiscoveryMethod,
      })),
    },
    crawlPolicy: {
      schemaVersion: asString(crawlPolicyPayload.schema_version),
      siteId: asString(crawlPolicyPayload.site_id),
      crawlPolicyVersion: asString(crawlPolicyPayload.crawl_policy_version),
      schemeAllowlist: asStringArray(crawlPolicyPayload.scheme_allowlist),
      contentTypeAllowlist: asStringArray(crawlPolicyPayload.content_type_allowlist),
      discoveryOrder: asStringArray(crawlPolicyPayload.discovery_order).map(asDiscoveryMethod),
      defaultQueryPolicy: asString(crawlPolicyPayload.default_query_policy),
      defaultQueryParamAllowlist: asStringArray(crawlPolicyPayload.default_query_param_allowlist),
      defaultDeniedPathPatterns: asStringArray(crawlPolicyPayload.default_denied_path_patterns),
      frontierIdentityKey: asString(crawlPolicyPayload.frontier_identity_key),
      expandWithinSameHostnameOnly: Boolean(crawlPolicyPayload.expand_within_same_hostname_only),
      crossHostExpansionRequiresAllowlist: Boolean(
        crawlPolicyPayload.cross_host_expansion_requires_allowlist,
      ),
      allowCrossHostRedirectOnlyIfAllowlisted: Boolean(
        crawlPolicyPayload.allow_cross_host_redirect_only_if_allowlisted,
      ),
      respectRobotsByDefault: Boolean(crawlPolicyPayload.respect_robots_by_default),
      robots4xxBehavior: asString(crawlPolicyPayload.robots_4xx_behavior),
      robots429Behavior: asString(crawlPolicyPayload.robots_429_behavior),
      robots5xxBehavior: asString(crawlPolicyPayload.robots_5xx_behavior),
      recordRedirectChain: Boolean(crawlPolicyPayload.record_redirect_chain),
      useConditionalFetch: Boolean(crawlPolicyPayload.use_conditional_fetch),
      maxTotalPagesPerRun: asPositiveInt(
        crawlPolicyPayload.max_total_pages_per_run,
        "max_total_pages_per_run",
      ),
      maxTotalFailuresPerRun: asPositiveInt(
        crawlPolicyPayload.max_total_failures_per_run,
        "max_total_failures_per_run",
      ),
      maxRuntimeMinutes: asPositiveInt(
        crawlPolicyPayload.max_runtime_minutes,
        "max_runtime_minutes",
      ),
    },
    credentialsSchema: {
      schemaVersion: asString(credentialsSchemaPayload.schema_version),
      siteId: asString(credentialsSchemaPayload.site_id),
      credentialsMode: asCredentialsMode(credentialsSchemaPayload.credentials_mode),
      title: asString(credentialsSchemaPayload.title),
      description: asString(credentialsSchemaPayload.description),
      type: asString(credentialsSchemaPayload.type),
      additionalProperties: Boolean(credentialsSchemaPayload.additionalProperties),
      properties: asRecord(credentialsSchemaPayload.properties),
      required: asStringArray(credentialsSchemaPayload.required),
    },
    projectionDeclarations: {
      schemaVersion: asString(projectionDeclarationsPayload.schema_version),
      siteId: asString(projectionDeclarationsPayload.site_id),
      projectionPolicyVersion: asString(projectionDeclarationsPayload.projection_policy_version),
      declarations: asArray(projectionDeclarationsPayload.declarations).map((item) => ({
        declarationId: asString(item.declaration_id),
        pageFamily: asProjectionPageFamily(item.page_family),
        targetCorpus: asPathSegment(item.target_corpus, "projection.target_corpus"),
        targetCollection: asPathSegment(item.target_collection, "projection.target_collection"),
        projectionFamily: asPathSegment(item.projection_family, "projection.projection_family"),
        documentKind: asPathSegment(item.document_kind, "projection.document_kind"),
        action: asProjectionAction(item.action),
      })),
    },
    schedulerPolicy: {
      schemaVersion: asString(schedulerPolicyPayload.schema_version),
      siteId: asString(schedulerPolicyPayload.site_id),
      schedulerPolicyVersion: asString(schedulerPolicyPayload.scheduler_policy_version),
      timezone: asString(schedulerPolicyPayload.timezone),
      lanes: asArray(schedulerPolicyPayload.lanes).map((item) => ({
        enabled: Boolean(item.enabled),
        hostFilter: asStringArray(item.host_filter).map((host) => host.toLowerCase()),
        maxPagesPerHost: asPositiveInt(item.max_pages_per_host, "max_pages_per_host"),
        maxTotalPages: asPositiveInt(item.max_total_pages, "max_total_pages"),
        notes: asString(item.notes),
        runIntent: asRunIntent(item.run_intent),
        cadenceMinutes: asPositiveInt(item.cadence_minutes, "cadence_minutes"),
      })),
    },
    qcPolicy: {
      schemaVersion: asString(qcPolicyPayload.schema_version),
      siteId: asString(qcPolicyPayload.site_id),
      qcPolicyVersion: asString(qcPolicyPayload.qc_policy_version),
      allowedReviewIssueCodes: asStringArray(qcPolicyPayload.allowed_review_issue_codes),
      allowedReviewPageFamilies: asStringArray(qcPolicyPayload.allowed_review_page_families).map(
        asProjectionPageFamily,
      ),
      hostOverrides: asArray(qcPolicyPayload.host_overrides).map((item) => ({
        host: asString(item.host),
        allowedReviewIssueCodes: asStringArray(item.allowed_review_issue_codes),
        allowedReviewPageFamilies: asStringArray(item.allowed_review_page_families).map(
          asProjectionPageFamily,
        ),
      })),
    },
  };

  validateOfficialWebConfig(bundle);
  return bundle;
}

export function validateOfficialWebConfig(bundle: OfficialWebConfigBundle): void {
  assertNonEmpty(bundle.site.schemaVersion, "site.schemaVersion");
  assertNonEmpty(bundle.site.configVersion, "site.configVersion");
  assertNonEmpty(bundle.site.siteId, "site.siteId");
  assertNonEmpty(bundle.site.displayName, "site.displayName");
  if (bundle.site.sourceChannel !== OFFICIAL_WEB_SOURCE_CHANNEL) {
    throw new Error(`site.sourceChannel must equal ${OFFICIAL_WEB_SOURCE_CHANNEL}`);
  }
  validateHostName(bundle.site.entryHost, "site.entryHost");
  if (!bundle.site.allowedHosts.length) {
    throw new Error("site.allowedHosts must not be empty");
  }
  ensureUnique(bundle.site.allowedHosts, "site.allowedHosts");
  bundle.site.allowedHosts.forEach((host) => validateHostName(host, "site.allowedHosts"));
  if (!bundle.site.allowedHosts.includes(bundle.site.entryHost)) {
    throw new Error("site.entryHost must appear in site.allowedHosts");
  }

  if (bundle.hosts.siteId !== bundle.site.siteId) {
    throw new Error("hosts.siteId must match site.siteId");
  }
  if (bundle.hosts.hostPolicyVersion !== bundle.site.hostPolicyVersion) {
    throw new Error("hosts.hostPolicyVersion must match site.hostPolicyVersion");
  }
  if (!bundle.hosts.hosts.length) {
    throw new Error("hosts.hosts must not be empty");
  }
  ensureUnique(
    bundle.hosts.hosts.map((item) => item.host),
    "hosts.hosts[].host",
  );

  const enabledHosts = bundle.hosts.hosts.filter((item) => item.enabled);
  const enabledHostNames = enabledHosts.map((item) => item.host);
  ensureSameSet(bundle.site.allowedHosts, enabledHostNames, "site.allowedHosts");

  for (const host of bundle.hosts.hosts) {
    validateHostName(host.host, "hosts.host");
    if (host.enabled && !ENABLED_PUBLIC_KINDS.includes(host.publicKind as (typeof ENABLED_PUBLIC_KINDS)[number])) {
      throw new Error(`enabled host ${host.host} must be content_site or directory_site`);
    }
    if (!host.enabled && host.seedUrls.length > 0) {
      throw new Error(`disabled host ${host.host} must not define seedUrls`);
    }
    if (!host.respectRobots) {
      throw new Error(`host ${host.host} must keep respectRobots=true`);
    }
    if (host.enabled) {
      if (host.maxDepth <= 0) {
        throw new Error(`enabled host ${host.host} must have maxDepth > 0`);
      }
      if (host.maxPagesPerRun <= 0) {
        throw new Error(`enabled host ${host.host} must have maxPagesPerRun > 0`);
      }
      if (!host.allowedPathPrefixes.length) {
        throw new Error(`enabled host ${host.host} must define allowedPathPrefixes`);
      }
      for (const seedUrl of host.seedUrls) {
        validateSeedUrl(seedUrl, host.host, host.queryParamAllowlist);
      }
    }
    for (const sitemap of host.explicitSitemaps) {
      const parsed = new URL(sitemap);
      if (parsed.protocol !== "https:") {
        throw new Error(`explicit sitemap ${sitemap} must use https`);
      }
      if (parsed.hostname !== host.host) {
        throw new Error(`explicit sitemap ${sitemap} must stay on host ${host.host}`);
      }
    }
    if (host.dynamicShellDiscovery?.enabled) {
      if (host.dynamicShellDiscovery.waitAfterLoadMs <= 0) {
        throw new Error(`host ${host.host} dynamicShellDiscovery.waitAfterLoadMs must be > 0`);
      }
      if (host.dynamicShellDiscovery.networkObservationTimeoutMs <= 0) {
        throw new Error(
          `host ${host.host} dynamicShellDiscovery.networkObservationTimeoutMs must be > 0`,
        );
      }
      if (host.dynamicShellDiscovery.maxPromotedUrls <= 0) {
        throw new Error(`host ${host.host} dynamicShellDiscovery.maxPromotedUrls must be > 0`);
      }
      if (host.dynamicShellDiscovery.allowedRequestUrlPatterns.length === 0) {
        throw new Error(
          `host ${host.host} dynamicShellDiscovery.allowedRequestUrlPatterns must not be empty`,
        );
      }
      if (host.dynamicShellDiscovery.promotedUrlPatterns.length === 0) {
        throw new Error(
          `host ${host.host} dynamicShellDiscovery.promotedUrlPatterns must not be empty`,
        );
      }
      validateRegexList(
        host.dynamicShellDiscovery.allowedRequestUrlPatterns,
        `host ${host.host} dynamicShellDiscovery.allowedRequestUrlPatterns`,
      );
      validateRegexList(
        host.dynamicShellDiscovery.ignoredRequestUrlPatterns,
        `host ${host.host} dynamicShellDiscovery.ignoredRequestUrlPatterns`,
      );
      validateRegexList(
        host.dynamicShellDiscovery.promotedUrlPatterns,
        `host ${host.host} dynamicShellDiscovery.promotedUrlPatterns`,
      );
      validateRegexList(
        host.dynamicShellDiscovery.waitForResponseUrlPatterns,
        `host ${host.host} dynamicShellDiscovery.waitForResponseUrlPatterns`,
      );
    }
  }

  if (bundle.seeds.siteId !== bundle.site.siteId) {
    throw new Error("seeds.siteId must match site.siteId");
  }
  if (bundle.seeds.seedSetVersion !== bundle.site.seedSetVersion) {
    throw new Error("seeds.seedSetVersion must match site.seedSetVersion");
  }
  ensureUnique(
    bundle.seeds.seeds.map((seed) => seed.seedId),
    "seeds.seeds[].seedId",
  );
  ensureUnique(
    bundle.seeds.seeds.map((seed) => seed.url),
    "seeds.seeds[].url",
  );

  const hostIndex = new Map(bundle.hosts.hosts.map((item) => [item.host, item]));
  for (const seed of bundle.seeds.seeds) {
    assertNonEmpty(seed.seedId, "seed.seedId");
    assertNonEmpty(seed.reason, "seed.reason");
    validateHostName(seed.host, "seed.host");
    const host = hostIndex.get(seed.host);
    if (!host) {
      throw new Error(`seed ${seed.seedId} references unknown host ${seed.host}`);
    }
    if (!host.enabled) {
      throw new Error(`seed ${seed.seedId} references disabled host ${seed.host}`);
    }
    if (!host.seedUrls.includes(seed.url)) {
      throw new Error(`seed ${seed.seedId} is missing from host.seedUrls for ${seed.host}`);
    }
    validateSeedUrl(seed.url, seed.host, host.queryParamAllowlist);
  }

  for (const host of bundle.hosts.hosts) {
    const seedUrlsForHost = bundle.seeds.seeds
      .filter((seed) => seed.host === host.host)
      .map((seed) => seed.url);
    ensureSameSet(host.seedUrls, seedUrlsForHost, `host.seedUrls(${host.host})`);
  }

  if (bundle.crawlPolicy.siteId !== bundle.site.siteId) {
    throw new Error("crawlPolicy.siteId must match site.siteId");
  }
  if (bundle.crawlPolicy.crawlPolicyVersion !== bundle.site.crawlPolicyVersion) {
    throw new Error("crawlPolicy.crawlPolicyVersion must match site.crawlPolicyVersion");
  }
  if (!bundle.crawlPolicy.schemeAllowlist.includes("https")) {
    throw new Error("crawlPolicy must include https in schemeAllowlist");
  }
  if (!bundle.crawlPolicy.contentTypeAllowlist.includes("text/html")) {
    throw new Error("crawlPolicy must include text/html in contentTypeAllowlist");
  }
  if (bundle.crawlPolicy.defaultQueryPolicy !== "deny_all") {
    throw new Error("crawlPolicy.defaultQueryPolicy must stay deny_all in v1");
  }
  if (bundle.crawlPolicy.frontierIdentityKey !== "normalized_canonical_url") {
    throw new Error("crawlPolicy.frontierIdentityKey must be normalized_canonical_url");
  }
  if (!bundle.crawlPolicy.respectRobotsByDefault) {
    throw new Error("crawlPolicy.respectRobotsByDefault must be true");
  }
  if (!bundle.crawlPolicy.expandWithinSameHostnameOnly) {
    throw new Error("crawlPolicy.expandWithinSameHostnameOnly must be true");
  }
  if (!bundle.crawlPolicy.crossHostExpansionRequiresAllowlist) {
    throw new Error("crawlPolicy.crossHostExpansionRequiresAllowlist must be true");
  }

  if (bundle.credentialsSchema.siteId !== bundle.site.siteId) {
    throw new Error("credentialsSchema.siteId must match site.siteId");
  }
  if (bundle.credentialsSchema.credentialsMode !== bundle.site.credentialsMode) {
    throw new Error("credentialsSchema.credentialsMode must match site.credentialsMode");
  }
  if (bundle.credentialsSchema.type !== "object") {
    throw new Error("credentialsSchema.type must be object");
  }
  if (bundle.site.credentialsMode === "public") {
    if (Object.keys(bundle.credentialsSchema.properties).length > 0) {
      throw new Error("public credentials schema must not define properties");
    }
    if (bundle.credentialsSchema.required.length > 0) {
      throw new Error("public credentials schema must not define required fields");
    }
  }

  if (bundle.projectionDeclarations.siteId !== bundle.site.siteId) {
    throw new Error("projectionDeclarations.siteId must match site.siteId");
  }
  if (bundle.projectionDeclarations.projectionPolicyVersion !== bundle.site.projectionPolicyVersion) {
    throw new Error(
      "projectionDeclarations.projectionPolicyVersion must match site.projectionPolicyVersion",
    );
  }
  ensureUnique(
    bundle.projectionDeclarations.declarations.map((item) => item.declarationId),
    "projectionDeclarations.declarations[].declarationId",
  );
  ensureUnique(
    bundle.projectionDeclarations.declarations.map((item) => item.pageFamily),
    "projectionDeclarations.declarations[].pageFamily",
  );
  for (const declaration of bundle.projectionDeclarations.declarations) {
    if (
      OFFICIAL_WEB_SHELL_PAGE_FAMILIES.includes(
        declaration.pageFamily as (typeof OFFICIAL_WEB_SHELL_PAGE_FAMILIES)[number],
      ) &&
      declaration.action !== "manual_review"
    ) {
      throw new Error(
        `shell-family projection ${declaration.declarationId} must use action=manual_review`,
      );
    }
  }

  if (bundle.qcPolicy.siteId !== bundle.site.siteId) {
    throw new Error("qcPolicy.siteId must match site.siteId");
  }
  assertNonEmpty(bundle.qcPolicy.qcPolicyVersion, "qcPolicy.qcPolicyVersion");
  ensureUnique(bundle.qcPolicy.allowedReviewIssueCodes, "qcPolicy.allowedReviewIssueCodes");
  ensureUnique(bundle.qcPolicy.allowedReviewPageFamilies, "qcPolicy.allowedReviewPageFamilies");
  ensureUnique(
    bundle.qcPolicy.hostOverrides.map((item) => item.host),
    "qcPolicy.hostOverrides[].host",
  );
  for (const hostOverride of bundle.qcPolicy.hostOverrides) {
    validateHostName(hostOverride.host, "qcPolicy.hostOverrides[].host");
    if (!hostIndex.has(hostOverride.host)) {
      throw new Error(`qcPolicy.hostOverrides references unknown host ${hostOverride.host}`);
    }
    ensureUnique(
      hostOverride.allowedReviewIssueCodes,
      `qcPolicy.hostOverrides(${hostOverride.host}).allowedReviewIssueCodes`,
    );
    ensureUnique(
      hostOverride.allowedReviewPageFamilies,
      `qcPolicy.hostOverrides(${hostOverride.host}).allowedReviewPageFamilies`,
    );
  }

  if (bundle.schedulerPolicy.siteId !== bundle.site.siteId) {
    throw new Error("schedulerPolicy.siteId must match site.siteId");
  }
  assertNonEmpty(
    bundle.schedulerPolicy.schedulerPolicyVersion,
    "schedulerPolicy.schedulerPolicyVersion",
  );
  assertNonEmpty(bundle.schedulerPolicy.timezone, "schedulerPolicy.timezone");
  if (bundle.schedulerPolicy.lanes.length === 0) {
    throw new Error("schedulerPolicy.lanes must not be empty");
  }
  ensureSameSet(
    bundle.schedulerPolicy.lanes.map((lane) => lane.runIntent),
    [...OFFICIAL_WEB_RUN_INTENTS],
    "schedulerPolicy.lanes[].runIntent",
  );
  for (const lane of bundle.schedulerPolicy.lanes) {
    if (lane.notes.length === 0) {
      throw new Error(`scheduler lane ${lane.runIntent} must define notes`);
    }
    if (lane.maxTotalPages < lane.maxPagesPerHost) {
      throw new Error(
        `scheduler lane ${lane.runIntent} must keep maxTotalPages >= maxPagesPerHost`,
      );
    }
    for (const host of lane.hostFilter) {
      if (!bundle.site.allowedHosts.includes(host)) {
        throw new Error(`scheduler lane ${lane.runIntent} references unknown host ${host}`);
      }
    }
  }
}

export function buildCrawlRunId(siteId: string, now: Date = new Date()): string {
  return `${siteId}-${toCompactUtc(now)}`;
}

export function buildOfficialWebCrawlPlan(
  siteId: string,
  options: {
    repoRoot?: string;
    configRoot?: string;
    now?: Date;
    crawlRunId?: string;
    runIntent?: OfficialWebRunIntent;
  } = {},
): OfficialWebCrawlPlan {
  const bundle = loadOfficialWebConfig(siteId, options);
  const now = options.now ?? new Date();
  return {
    siteId: bundle.site.siteId,
    crawlRunId: options.crawlRunId ?? buildCrawlRunId(bundle.site.siteId, now),
    runIntent: options.runIntent == null ? "baseline" : asRunIntent(options.runIntent),
    generatedAt: now.toISOString(),
    configVersion: bundle.site.configVersion,
    hostPolicyVersion: bundle.site.hostPolicyVersion,
    crawlPolicyVersion: bundle.site.crawlPolicyVersion,
    schedulerPolicyVersion: bundle.schedulerPolicy.schedulerPolicyVersion,
    seedSetVersion: bundle.site.seedSetVersion,
    credentialsMode: bundle.site.credentialsMode,
    entryHost: bundle.site.entryHost,
    enabledHosts: bundle.hosts.hosts
      .filter((item) => item.enabled)
      .map((item) => ({
        host: item.host,
        publicKind: item.publicKind,
        maxDepth: item.maxDepth,
        maxPagesPerRun: item.maxPagesPerRun,
        maxConcurrency: item.maxConcurrency,
        minDelayMs: item.minDelayMs,
      })),
    seeds: bundle.seeds.seeds.map((seed) => ({
      seedId: seed.seedId,
      url: seed.url,
      host: seed.host,
      reason: seed.reason,
    })),
    discoveryOrder: bundle.crawlPolicy.discoveryOrder,
    runLimits: {
      maxTotalPagesPerRun: bundle.crawlPolicy.maxTotalPagesPerRun,
      maxTotalFailuresPerRun: bundle.crawlPolicy.maxTotalFailuresPerRun,
      maxRuntimeMinutes: bundle.crawlPolicy.maxRuntimeMinutes,
    },
    requiredArtifacts: [...OFFICIAL_WEB_REQUIRED_RUN_ARTIFACTS],
  };
}

export function buildOfficialWebSchedulerPlan(
  siteId: string,
  options: {
    repoRoot?: string;
    configRoot?: string;
    now?: Date;
  } = {},
): OfficialWebSchedulerPlan {
  const bundle = loadOfficialWebConfig(siteId, options);
  const now = options.now ?? new Date();

  return {
    generatedAt: now.toISOString(),
    schedulerPolicyVersion: bundle.schedulerPolicy.schedulerPolicyVersion,
    siteId: bundle.site.siteId,
    timezone: bundle.schedulerPolicy.timezone,
    lanes: bundle.schedulerPolicy.lanes.map((lane) => ({
      ...lane,
      schedulerRunKeyPattern: `${bundle.site.siteId}:${lane.runIntent}:{scheduled-at-iso}`,
      siteId: bundle.site.siteId,
    })),
  };
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asPositiveInt(value: unknown, fieldName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

function asNonNegativeInt(value: unknown, fieldName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return parsed;
}

function asPublicKind(value: unknown): OfficialWebPublicKind {
  const normalized = asString(value) as OfficialWebPublicKind;
  if (!ALLOWED_PUBLIC_KINDS.includes(normalized)) {
    throw new Error(`unsupported public kind: ${String(value)}`);
  }
  return normalized;
}

function asCredentialsMode(value: unknown): OfficialWebCredentialsMode {
  const normalized = asString(value) as OfficialWebCredentialsMode;
  if (!ALLOWED_CREDENTIALS_MODES.includes(normalized)) {
    throw new Error(`unsupported credentials mode: ${String(value)}`);
  }
  return normalized;
}

function asRunIntent(value: unknown): OfficialWebRunIntent {
  const normalized = asString(value) as OfficialWebRunIntent;
  if (!OFFICIAL_WEB_RUN_INTENTS.includes(normalized)) {
    throw new Error(`unsupported run intent: ${String(value)}`);
  }
  return normalized;
}

function asProjectionAction(value: unknown): OfficialWebProjectionAction {
  const normalized = asString(value) as OfficialWebProjectionAction;
  if (!OFFICIAL_WEB_PROJECTION_ACTIONS.includes(normalized)) {
    throw new Error(`unsupported official_web projection action: ${String(value)}`);
  }
  return normalized;
}

function asProjectionPageFamily(value: unknown): OfficialWebDeclarablePageFamily {
  const normalized = asString(value) as OfficialWebDeclarablePageFamily;
  if (!OFFICIAL_WEB_DECLARABLE_PAGE_FAMILIES.includes(normalized)) {
    throw new Error(`unsupported official_web projection page family: ${String(value)}`);
  }
  return normalized;
}

function asDiscoveryMethod(value: unknown): OfficialWebDiscoveryMethod {
  const normalized = asString(value) as OfficialWebDiscoveryMethod;
  if (!ALLOWED_DISCOVERY_METHODS.includes(normalized)) {
    throw new Error(`unsupported discovery method: ${String(value)}`);
  }
  return normalized;
}

function asDynamicShellDiscoveryPolicy(
  value: unknown,
): OfficialWebDynamicShellDiscoveryPolicy | null {
  if (value == null) {
    return null;
  }

  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return null;
  }

  const engine = asString(record.engine) as OfficialWebDynamicShellDiscoveryPolicy["engine"];
  if (engine !== "playwright") {
    throw new Error(`unsupported dynamic shell discovery engine: ${String(record.engine)}`);
  }

  return {
    enabled: Boolean(record.enabled),
    engine,
    waitAfterLoadMs: asPositiveInt(record.wait_after_load_ms, "wait_after_load_ms"),
    networkObservationTimeoutMs: asPositiveInt(
      record.network_observation_timeout_ms ?? record.wait_after_load_ms,
      "network_observation_timeout_ms",
    ),
    maxPromotedUrls: asPositiveInt(record.max_promoted_urls, "max_promoted_urls"),
    allowedRequestUrlPatterns: asStringArray(record.allowed_request_url_patterns),
    ignoredRequestUrlPatterns: asStringArray(record.ignored_request_url_patterns),
    promotedUrlPatterns: asStringArray(record.promoted_url_patterns),
    waitForResponseUrlPatterns: asStringArray(record.wait_for_response_url_patterns),
    waitForSelectorPatterns: asStringArray(record.wait_for_selector_patterns),
  };
}

function asPathSegment(value: unknown, fieldName: string): string {
  const normalized = asString(value);
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }
  if (normalized.includes("/")) {
    throw new Error(`${fieldName} must not contain slash`);
  }
  return normalized;
}

function assertNonEmpty(value: string, fieldName: string): void {
  if (!value) {
    throw new Error(`${fieldName} is required`);
  }
}

function ensureUnique(values: string[], fieldName: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${fieldName} must not contain duplicates`);
  }
}

function ensureSameSet(left: string[], right: string[], fieldName: string): void {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size !== rightSet.size) {
    throw new Error(`${fieldName} set mismatch`);
  }
  for (const item of leftSet) {
    if (!rightSet.has(item)) {
      throw new Error(`${fieldName} set mismatch`);
    }
  }
}

function validateRegexList(values: string[], fieldName: string): void {
  for (const value of values) {
    try {
      new RegExp(value, "i");
    } catch (error) {
      throw new Error(
        `${fieldName} contains invalid regex ${value}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function validateHostName(value: string, fieldName: string): void {
  assertNonEmpty(value, fieldName);
  if (value !== value.toLowerCase()) {
    throw new Error(`${fieldName} must be lowercase`);
  }
  if (value.includes("*") || value.includes("/") || value.includes(":")) {
    throw new Error(`${fieldName} must be a bare host name`);
  }
}

function validateSeedUrl(
  rawUrl: string,
  expectedHost: string,
  queryParamAllowlist: string[],
): void {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:") {
    throw new Error(`seed ${rawUrl} must use https`);
  }
  if (parsed.hostname !== expectedHost) {
    throw new Error(`seed ${rawUrl} must stay on host ${expectedHost}`);
  }
  if (parsed.hash) {
    throw new Error(`seed ${rawUrl} must not include a fragment`);
  }
  for (const name of parsed.searchParams.keys()) {
    if (!queryParamAllowlist.includes(name)) {
      throw new Error(`seed ${rawUrl} uses unapproved query parameter ${name}`);
    }
  }
}

function toCompactUtc(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}
