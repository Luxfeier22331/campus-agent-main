import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  OFFICIAL_WEB_PAGE_FAMILIES,
  OFFICIAL_WEB_QUALITY_AUDIT_ARTIFACT,
  loadOfficialWebConfig,
  type OfficialWebConfigBundle,
  type OfficialWebPageFamily,
  type OfficialWebQualityAuditDocument,
} from "./official-web-core.ts";

import { normalizeCliArgs } from "./cli.ts";
import { validateCollectorOutput, type CollectorValidationReport } from "./validate.ts";

export interface BuildCollectorQcReportInput {
  outputDirs: string[];
  repoRoot?: string;
  configRoot?: string;
  allowedReviewIssueCodes?: string[];
  allowedReviewPageFamilies?: OfficialWebPageFamily[];
}

export interface CollectorQcPageFinding {
  outputDir: string;
  siteId: string;
  crawlRunId: string;
  normalizedCanonicalUrl: string;
  pageFamily: OfficialWebPageFamily;
  issueCodes: string[];
}

export interface CollectorQcOutputReport {
  outputDir: string;
  validation: CollectorValidationReport;
  audit: {
    siteId: string;
    crawlRunId: string;
    totalPages: number;
    passPages: number;
    reviewPages: number;
    failPages: number;
    familyCounts: Record<OfficialWebPageFamily, number>;
    issueCounts: Record<string, number>;
  };
}

export interface CollectorQcReport {
  valid: boolean;
  thresholds: {
    allowedReviewIssueCodes: string[];
    allowedReviewPageFamilies: OfficialWebPageFamily[];
  };
  totals: {
    outputs: number;
    bundlePages: number;
    validationErrors: number;
    validationWarnings: number;
    passPages: number;
    reviewPages: number;
    failPages: number;
    unexpectedReviewPages: number;
  };
  familyCounts: Record<OfficialWebPageFamily, number>;
  issueCounts: Record<string, number>;
  outputs: CollectorQcOutputReport[];
  unexpectedReviewPages: CollectorQcPageFinding[];
  failPages: CollectorQcPageFinding[];
}

interface CollectorQcThresholds {
  allowedReviewIssueCodes: string[];
  allowedReviewPageFamilies: OfficialWebPageFamily[];
}

interface LoadedCollectorQcSitePolicy {
  siteId: string;
  allowedReviewIssueCodes: string[];
  allowedReviewPageFamilies: OfficialWebPageFamily[];
  hostOverrides: Map<
    string,
    {
      allowedReviewIssueCodes: string[];
      allowedReviewPageFamilies: OfficialWebPageFamily[];
    }
  >;
}

export async function buildCollectorQcReport(
  input: BuildCollectorQcReportInput,
): Promise<CollectorQcReport> {
  if (input.outputDirs.length === 0) {
    throw new Error("at least one output dir is required");
  }

  const cliThresholds = {
    allowedReviewIssueCodes: [...new Set(input.allowedReviewIssueCodes ?? [])].sort(),
    allowedReviewPageFamilies: [...new Set(input.allowedReviewPageFamilies ?? [])].sort(),
  } satisfies CollectorQcThresholds;
  const resolvedIssueCodes = new Set(cliThresholds.allowedReviewIssueCodes);
  const resolvedPageFamilies = new Set(cliThresholds.allowedReviewPageFamilies);
  const sitePolicies = new Map<string, LoadedCollectorQcSitePolicy>();

  const outputs: CollectorQcOutputReport[] = [];
  const unexpectedReviewPages: CollectorQcPageFinding[] = [];
  const failPages: CollectorQcPageFinding[] = [];
  const familyCounts = createEmptyFamilyCounts();
  const issueCounts: Record<string, number> = {};
  let bundlePages = 0;
  let validationErrors = 0;
  let validationWarnings = 0;
  let passPages = 0;
  let reviewPages = 0;
  let failPageCount = 0;

  for (const outputDir of input.outputDirs) {
    const validation = await validateCollectorOutput(outputDir);
    const audit = readQualityAudit(outputDir);
    const sitePolicy = loadCollectorQcSitePolicy(audit.siteId, input, sitePolicies);

    for (const code of sitePolicy.allowedReviewIssueCodes) {
      resolvedIssueCodes.add(code);
    }
    for (const family of sitePolicy.allowedReviewPageFamilies) {
      resolvedPageFamilies.add(family);
    }
    for (const override of sitePolicy.hostOverrides.values()) {
      for (const code of override.allowedReviewIssueCodes) {
        resolvedIssueCodes.add(code);
      }
      for (const family of override.allowedReviewPageFamilies) {
        resolvedPageFamilies.add(family);
      }
    }

    outputs.push({
      outputDir,
      validation,
      audit: {
        siteId: audit.siteId,
        crawlRunId: audit.crawlRunId,
        totalPages: audit.summary.totalPages,
        passPages: audit.summary.passPages,
        reviewPages: audit.summary.reviewPages,
        failPages: audit.summary.failPages,
        familyCounts: audit.summary.familyCounts,
        issueCounts: audit.summary.issueCounts,
      },
    });

    bundlePages += validation.counts.bundlePages;
    validationErrors += validation.counts.errors;
    validationWarnings += validation.counts.warnings;
    passPages += audit.summary.passPages;
    reviewPages += audit.summary.reviewPages;
    failPageCount += audit.summary.failPages;

    for (const family of OFFICIAL_WEB_PAGE_FAMILIES) {
      familyCounts[family] += audit.summary.familyCounts[family] ?? 0;
    }

    for (const [code, count] of Object.entries(audit.summary.issueCounts)) {
      issueCounts[code] = (issueCounts[code] ?? 0) + count;
    }

    for (const page of audit.pages) {
      if (page.status === "fail") {
        failPages.push({
          outputDir,
          siteId: audit.siteId,
          crawlRunId: audit.crawlRunId,
          normalizedCanonicalUrl: page.normalizedCanonicalUrl,
          pageFamily: page.pageFamily,
          issueCodes: page.issues.map((item) => item.code),
        });
        continue;
      }

      if (page.status !== "review") {
        continue;
      }

      if (
        isAllowedReviewPage(
          page,
          mergeQcThresholds(cliThresholds, resolveSiteThresholdsForPage(sitePolicy, page.host)),
        )
      ) {
        continue;
      }

      unexpectedReviewPages.push({
        outputDir,
        siteId: audit.siteId,
        crawlRunId: audit.crawlRunId,
        normalizedCanonicalUrl: page.normalizedCanonicalUrl,
        pageFamily: page.pageFamily,
        issueCodes: page.issues.map((item) => item.code),
      });
    }
  }

  const thresholds = {
    allowedReviewIssueCodes: [...resolvedIssueCodes].sort(),
    allowedReviewPageFamilies: [...resolvedPageFamilies].sort(),
  } satisfies CollectorQcThresholds;

  return {
    valid:
      validationErrors === 0 && failPages.length === 0 && unexpectedReviewPages.length === 0,
    thresholds,
    totals: {
      outputs: outputs.length,
      bundlePages,
      validationErrors,
      validationWarnings,
      passPages,
      reviewPages,
      failPages: failPageCount,
      unexpectedReviewPages: unexpectedReviewPages.length,
    },
    familyCounts,
    issueCounts,
    outputs,
    unexpectedReviewPages,
    failPages,
  };
}

export async function qcReportMain(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args: normalizeCliArgs(argv),
    options: {
      "repo-root": { type: "string" },
      "config-root": { type: "string" },
      "output-dir": { type: "string", multiple: true },
      "allow-review-code": { type: "string", multiple: true },
      "allow-review-family": { type: "string", multiple: true },
      json: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const outputDirs = values["output-dir"];
  if (!outputDirs || outputDirs.length === 0) {
    throw new Error("at least one --output-dir is required");
  }

  const report = await buildCollectorQcReport({
    outputDirs,
    repoRoot: values["repo-root"],
    configRoot: values["config-root"],
    allowedReviewIssueCodes: values["allow-review-code"],
    allowedReviewPageFamilies: parseAllowedReviewFamilies(values["allow-review-family"]),
  });

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printQcReport(report);
  }

  if (!report.valid) {
    process.exitCode = 1;
  }
}

function readQualityAudit(outputDir: string): OfficialWebQualityAuditDocument {
  const auditPath = resolve(outputDir, OFFICIAL_WEB_QUALITY_AUDIT_ARTIFACT);
  if (!existsSync(auditPath)) {
    throw new Error(`missing quality audit: ${auditPath}`);
  }

  return JSON.parse(readFileSync(auditPath, "utf-8")) as OfficialWebQualityAuditDocument;
}

function parseAllowedReviewFamilies(values: string[] | undefined): OfficialWebPageFamily[] | undefined {
  if (!values) {
    return undefined;
  }

  return values.map((value) => {
    if (!OFFICIAL_WEB_PAGE_FAMILIES.includes(value as OfficialWebPageFamily)) {
      throw new Error(`unknown review family: ${value}`);
    }
    return value as OfficialWebPageFamily;
  });
}

function isAllowedReviewPage(
  page: OfficialWebQualityAuditDocument["pages"][number],
  thresholds: CollectorQcThresholds,
): boolean {
  if (!thresholds.allowedReviewPageFamilies.includes(page.pageFamily)) {
    return false;
  }

  return (
    page.issues.length > 0 &&
    page.issues.every((item) => thresholds.allowedReviewIssueCodes.includes(item.code))
  );
}

function loadCollectorQcSitePolicy(
  siteId: string,
  options: Pick<BuildCollectorQcReportInput, "repoRoot" | "configRoot">,
  cache: Map<string, LoadedCollectorQcSitePolicy>,
): LoadedCollectorQcSitePolicy {
  const cached = cache.get(siteId);
  if (cached) {
    return cached;
  }

  const bundle = loadOfficialWebConfig(siteId, {
    repoRoot: options.repoRoot,
    configRoot: options.configRoot,
  });
  const policy = normalizeCollectorQcSitePolicy(bundle);
  cache.set(siteId, policy);
  return policy;
}

function normalizeCollectorQcSitePolicy(bundle: OfficialWebConfigBundle): LoadedCollectorQcSitePolicy {
  return {
    siteId: bundle.site.siteId,
    allowedReviewIssueCodes: [...bundle.qcPolicy.allowedReviewIssueCodes].sort(),
    allowedReviewPageFamilies: [...bundle.qcPolicy.allowedReviewPageFamilies].sort(),
    hostOverrides: new Map(
      bundle.qcPolicy.hostOverrides.map((override) => [
        override.host,
        {
          allowedReviewIssueCodes: [...override.allowedReviewIssueCodes].sort(),
          allowedReviewPageFamilies: [...override.allowedReviewPageFamilies].sort(),
        },
      ]),
    ),
  };
}

function resolveSiteThresholdsForPage(
  policy: LoadedCollectorQcSitePolicy,
  host: string,
): CollectorQcThresholds {
  const hostOverride = policy.hostOverrides.get(host);
  return {
    allowedReviewIssueCodes: [
      ...new Set([
        ...policy.allowedReviewIssueCodes,
        ...(hostOverride?.allowedReviewIssueCodes ?? []),
      ]),
    ].sort(),
    allowedReviewPageFamilies: [
      ...new Set([
        ...policy.allowedReviewPageFamilies,
        ...(hostOverride?.allowedReviewPageFamilies ?? []),
      ]),
    ].sort(),
  };
}

function mergeQcThresholds(
  left: CollectorQcThresholds,
  right: CollectorQcThresholds,
): CollectorQcThresholds {
  return {
    allowedReviewIssueCodes: [...new Set([...left.allowedReviewIssueCodes, ...right.allowedReviewIssueCodes])].sort(),
    allowedReviewPageFamilies: [
      ...new Set([...left.allowedReviewPageFamilies, ...right.allowedReviewPageFamilies]),
    ].sort(),
  };
}

function createEmptyFamilyCounts(): Record<OfficialWebPageFamily, number> {
  return OFFICIAL_WEB_PAGE_FAMILIES.reduce<Record<OfficialWebPageFamily, number>>((result, family) => {
    result[family] = 0;
    return result;
  }, {} as Record<OfficialWebPageFamily, number>);
}

function printQcReport(report: CollectorQcReport): void {
  console.log(`official-web collector qc gate: ${report.valid ? "PASS" : "FAIL"}`);
  console.log(`outputs: ${report.totals.outputs}`);
  console.log(`bundlePages: ${report.totals.bundlePages}`);
  console.log(`validationErrors: ${report.totals.validationErrors}`);
  console.log(`validationWarnings: ${report.totals.validationWarnings}`);
  console.log(`passPages: ${report.totals.passPages}`);
  console.log(`reviewPages: ${report.totals.reviewPages}`);
  console.log(`failPages: ${report.totals.failPages}`);
  console.log(`unexpectedReviewPages: ${report.totals.unexpectedReviewPages}`);

  if (report.thresholds.allowedReviewIssueCodes.length > 0) {
    console.log(`allowedReviewIssueCodes: ${report.thresholds.allowedReviewIssueCodes.join(", ")}`);
  }
  if (report.thresholds.allowedReviewPageFamilies.length > 0) {
    console.log(`allowedReviewPageFamilies: ${report.thresholds.allowedReviewPageFamilies.join(", ")}`);
  }

  for (const page of report.failPages) {
    console.log(
      `[fail-page] ${page.outputDir} ${page.pageFamily} ${page.normalizedCanonicalUrl} ${page.issueCodes.join(",")}`,
    );
  }

  for (const page of report.unexpectedReviewPages) {
    console.log(
      `[unexpected-review] ${page.outputDir} ${page.pageFamily} ${page.normalizedCanonicalUrl} ${page.issueCodes.join(",")}`,
    );
  }
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  void qcReportMain();
}
