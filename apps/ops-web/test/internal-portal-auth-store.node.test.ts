// @vitest-environment node

import { ApiException, type V1Secret } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";

import {
	createKubernetesInternalPortalAuthStore,
	type InternalPortalAuthStoreUnavailableError,
	parseInternalPortalCredential,
} from "../src/server/internal-portal-auth-store";

describe("internal portal auth store", () => {
	it("accepts a raw TGC or one TGC inside a Cookie header", () => {
		expect(parseInternalPortalCredential("TGT-current-ticket")).toBe("TGT-current-ticket");
		expect(
			parseInternalPortalCredential(
				"Path=/; nginx=proxy; SSO_TGC=TGT-current-ticket; Path=/; JSESSIONID=session",
			),
		).toBe("TGT-current-ticket");
	});

	it("rejects ambiguous and malformed credential input", () => {
		expect(() => parseInternalPortalCredential("SSO_TGC=TGT-one; SSO_TGC=TGT-two")).toThrow(
			"multiple SSO_TGC",
		);
		expect(() => parseInternalPortalCredential("SSO_TGC=bad,value")).toThrow("invalid characters");
		expect(() => parseInternalPortalCredential("   ")).toThrow("empty");
	});

	it("reads status and patches only the fixed Secret", async () => {
		const secret: V1Secret = {
			data: { existing: "ZXhpc3Rpbmc=" },
			metadata: { annotations: { existing: "annotation" } },
		};
		const readNamespacedSecret = vi.fn().mockResolvedValue(secret);
		const patchNamespacedSecret = vi.fn().mockResolvedValue({
			data: { sso_tgc: "VEdULW5ldw==" },
			metadata: {
				annotations: {
					"campus-agent.io/portal-auth-updated-at": "2026-07-15T12:00:00.000Z",
					"campus-agent.io/portal-auth-updated-by": "ops@example.test",
				},
			},
		});
		const store = createKubernetesInternalPortalAuthStore({
			api: { patchNamespacedSecret, readNamespacedSecret },
			namespace: "campus-agent-staging",
		});

		await expect(store.getStatus()).resolves.toEqual({
			configured: false,
			updatedAt: null,
			updatedBy: null,
		});
		await expect(
			store.replaceCredential({
				credential: "TGT-new",
				updatedAt: "2026-07-15T12:00:00.000Z",
				updatedBy: "ops@example.test",
			}),
		).resolves.toEqual({
			configured: true,
			updatedAt: "2026-07-15T12:00:00.000Z",
			updatedBy: "ops@example.test",
		});
		expect(readNamespacedSecret).toHaveBeenCalledWith({
			name: "source-collector-internal-portal-auth",
			namespace: "campus-agent-staging",
		});
		expect(patchNamespacedSecret).toHaveBeenCalledWith({
			body: [
				{ op: "add", path: "/data/sso_tgc", value: "VEdULW5ldw==" },
				{
					op: "add",
					path: "/metadata/annotations/campus-agent.io~1portal-auth-updated-at",
					value: "2026-07-15T12:00:00.000Z",
				},
				{
					op: "add",
					path: "/metadata/annotations/campus-agent.io~1portal-auth-updated-by",
					value: "ops@example.test",
				},
			],
			fieldManager: "ops-web",
			name: "source-collector-internal-portal-auth",
			namespace: "campus-agent-staging",
		});
	});

	it("treats a missing Secret as unconfigured but refuses to create it", async () => {
		const missing = new ApiException(404, "not found", {}, {});
		const store = createKubernetesInternalPortalAuthStore({
			api: {
				patchNamespacedSecret: vi.fn(),
				readNamespacedSecret: vi.fn().mockRejectedValue(missing),
			},
			namespace: "campus-agent-staging",
		});

		await expect(store.getStatus()).resolves.toEqual({
			configured: false,
			updatedAt: null,
			updatedBy: null,
		});
		await expect(
			store.replaceCredential({
				credential: "TGT-new",
				updatedAt: "2026-07-15T12:00:00.000Z",
				updatedBy: "ops@example.test",
			}),
		).rejects.toMatchObject({
			reasonCode: "SECRET_NOT_INITIALIZED",
		} satisfies Partial<InternalPortalAuthStoreUnavailableError>);
	});
});
