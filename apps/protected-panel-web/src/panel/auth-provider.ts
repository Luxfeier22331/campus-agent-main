import type { AuthProvider } from "react-admin";

import { fetchJson } from "./http";
import { PANEL_COPY } from "./panel-copy";
import {
	normalizeOverviewRecord,
	type PanelOverviewRecord,
	type RawPanelOverviewResponse,
} from "./types";

let cachedOverviewPromise: Promise<PanelOverviewRecord> | null = null;
const LOGOUT_ERROR_CODES = new Set([
	"operator_identity_required",
	"session_expired",
	"session_required",
	"unauthorized",
]);

async function loadOverview(force = false): Promise<PanelOverviewRecord> {
	if (!cachedOverviewPromise || force) {
		cachedOverviewPromise =
			fetchJson<RawPanelOverviewResponse>("/api/overview").then(normalizeOverviewRecord);
	}

	return cachedOverviewPromise;
}

function clearOverviewCache() {
	cachedOverviewPromise = null;
}

function readErrorStatus(error: unknown): number | null {
	if (!error || typeof error !== "object" || !("status" in error)) {
		return null;
	}

	const status = error.status;
	return typeof status === "number" ? status : null;
}

function readErrorCode(error: unknown): string | null {
	if (!error || typeof error !== "object" || !("body" in error)) {
		return null;
	}

	const body = error.body;
	if (!body || typeof body !== "object" || !("error" in body)) {
		return null;
	}

	const errorEnvelope = body.error;
	if (!errorEnvelope || typeof errorEnvelope !== "object" || !("code" in errorEnvelope)) {
		return null;
	}

	return typeof errorEnvelope.code === "string" ? errorEnvelope.code : null;
}

function shouldPropagateAuthError(error: unknown): boolean {
	const status = readErrorStatus(error);
	if (status !== 401 && status !== 403) {
		return false;
	}

	const code = readErrorCode(error);
	if (!code) {
		return true;
	}

	return LOGOUT_ERROR_CODES.has(code);
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
		if (shouldPropagateAuthError(error)) {
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
