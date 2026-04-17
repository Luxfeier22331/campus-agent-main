import fs from "node:fs";

import type { NoticeTypeConfig, NoticeTypePolicySnapshot } from "./types";

export function loadNoticeTypes(noticeTypesPath: string): NoticeTypeConfig[] {
  const raw = fs.readFileSync(noticeTypesPath, "utf-8");
  return validateNoticeTypes(JSON.parse(raw) as NoticeTypeConfig[]);
}

export function getEnabledNoticeTypes(noticeTypes: NoticeTypeConfig[]): NoticeTypeConfig[] {
  return noticeTypes.filter((item) => item.enabled);
}

export function buildNoticeTypePolicySnapshot(
  noticeTypes: NoticeTypeConfig[],
): NoticeTypePolicySnapshot[] {
  return noticeTypes.map((item) => ({
    type: item.type,
    name: item.name,
    enabled: item.enabled,
    incremental: {
      pages: item.incrementalPages,
      page_size: item.incrementalPageSize,
    },
    backfill: {
      pages: item.backfillPages,
      page_size: item.backfillPageSize,
    },
  }));
}

function validateNoticeTypes(noticeTypes: NoticeTypeConfig[]): NoticeTypeConfig[] {
  const seen = new Set<string>();
  for (const item of noticeTypes) {
    const type = String(item.type || "").trim();
    if (!type) {
      throw new Error("notice type id is required");
    }
    if (seen.has(type)) {
      throw new Error(`duplicated notice type: ${type}`);
    }
    seen.add(type);
    if (!String(item.name || "").trim()) {
      throw new Error(`notice type name is required for ${type}`);
    }
    for (const [fieldName, value] of [
      ["incrementalPages", item.incrementalPages],
      ["incrementalPageSize", item.incrementalPageSize],
      ["backfillPages", item.backfillPages],
      ["backfillPageSize", item.backfillPageSize],
    ] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${fieldName} must be positive for ${type}`);
      }
    }
  }
  return noticeTypes;
}
