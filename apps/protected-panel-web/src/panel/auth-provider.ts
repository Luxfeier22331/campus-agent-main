import type { AuthProvider } from "react-admin";

import { fetchJson } from "./http";
import { PANEL_COPY } from "./panel-copy";
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
    if (error?.status === 401) {
      clearOverviewCache();
      throw error;
    }
  },
  async getIdentity() {
    const overview = await loadOverview();
    const operator = overview.operatorContext;

    if (!operator) {
      return {
        fullName: "受保护运维身份",
        id: "protected-operator",
      };
    }

    return {
      fullName: operator.displayName ?? operator.email ?? operator.subject,
      id: operator.operatorId,
    };
  },
  async login() {},
  async logout(params) {
    clearOverviewCache();

    if (params === null) {
      if (typeof window !== "undefined") {
        return new URL("/cdn-cgi/access/logout", window.location.origin).toString();
      }

      return "/cdn-cgi/access/logout";
    }

    return "/login";
  },
};
