import type { AuthProvider } from "react-admin";

import { fetchJson } from "./http";
import { normalizeOverviewRecord, type PanelOverviewRecord, type RawPanelOverviewResponse } from "./types";

let cachedOverviewPromise: Promise<PanelOverviewRecord> | null = null;

async function loadOverview(force = false): Promise<PanelOverviewRecord> {
  if (!cachedOverviewPromise || force) {
    cachedOverviewPromise = fetchJson<RawPanelOverviewResponse>("/api/overview").then(
      normalizeOverviewRecord,
    );
  }

  return cachedOverviewPromise;
}

function clearOverviewCache() {
  cachedOverviewPromise = null;
}

export const protectedPanelAuthProvider: AuthProvider = {
  async canAccess() {
    return true;
  },
  async checkAuth() {
    try {
      await loadOverview();
    } catch (error) {
      clearOverviewCache();
      throw error;
    }
  },
  async checkError(error) {
    if (error?.status === 401 || error?.status === 403) {
      clearOverviewCache();
      throw error;
    }
  },
  async getIdentity() {
    const overview = await loadOverview();
    const operator = overview.operatorContext;

    if (!operator) {
      return {
        fullName: "Protected Operator",
        id: "protected-operator",
      };
    }

    return {
      fullName: operator.displayName ?? operator.email ?? operator.subject,
      id: operator.operatorId,
    };
  },
  async login() {},
  async logout() {
    clearOverviewCache();
    if (typeof window !== "undefined") {
      window.location.assign("/cdn-cgi/access/logout");
    }
  },
};
