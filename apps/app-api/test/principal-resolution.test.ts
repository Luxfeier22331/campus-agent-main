// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/modules/auth/auth", () => ({
  getAppAuth: vi.fn(),
}));

import {
  mapSessionToAppPrincipal,
  mapOperatorHeadersToPrincipal,
  mapSessionToPublicUserPrincipal,
  resolveOfficialWebCollectorPrincipal,
  resolveRequestPrincipal,
} from "../src/modules/auth/principal";
import { getAppAuth } from "../src/modules/auth/auth";

const mockedGetAppAuth = vi.mocked(getAppAuth);

describe("operator bridge principal resolution", () => {
  it("does not trust operator headers without a matching internal shared secret", () => {
    const request = new Request("https://app-api.internal/api/operator/requests", {
      headers: {
        "x-app-operator-email": "ops@example.com",
        "x-app-operator-groups": "panel,ops",
      },
    });

    expect(
      mapOperatorHeadersToPrincipal(request, {
        APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
        APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
      }),
    ).toBeNull();
  });

  it("resolves an operator principal only when allowlist and internal auth both match", () => {
    const request = new Request("https://app-api.internal/api/operator/requests", {
      headers: {
        "x-app-internal-auth": "trusted-secret",
        "x-app-operator-email": "ops@example.com",
        "x-app-operator-groups": "panel,ops",
        "x-app-operator-id": "operator-001",
        "x-app-operator-name": "Ops Team",
      },
    });

    expect(
      mapOperatorHeadersToPrincipal(request, {
        APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
        APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
      }),
    ).toMatchObject({
      actor: {
        groups: ["panel", "ops"],
        principalId: "operator-001",
        userId: "operator-001",
      },
      authorization: {
        entitlementGroups: [],
        principalId: "operator-001",
        retrievalFilter: {
          aclGroups: [],
          campusScope: null,
          entitlementGroups: [],
          policyProjectionVersion: "phase1-authorization-projection-v1",
          visibilityLevel: "public",
          visibilityScope: null,
        },
        visibilityScope: null,
      },
      permissions: {
        chat: false,
        operator: true,
      },
      principal: {
        displayName: "Ops Team",
        email: "ops@example.com",
        principalId: "operator-001",
        type: "operator",
      },
      session: null,
    });
  });
});

describe("public user principal projection", () => {
  it("does not auto-promote a signed-in public user into campus entitlements", () => {
    expect(
      mapSessionToPublicUserPrincipal({
        session: {
          expiresAt: "2026-03-29T08:00:00.000Z",
          id: "sess_01HQ",
        },
        user: {
          email: "student@example.edu",
          id: "user_01HQ",
          name: "Jane Doe",
        },
      }),
    ).toMatchObject({
      actor: {
        campusScope: null,
        groups: ["public_chat_users"],
        principalId: "user_01HQ",
        roles: ["public_user"],
        userId: "user_01HQ",
      },
      authorization: {
        entitlementGroups: [],
        principalId: "user_01HQ",
        retrievalFilter: {
          aclGroups: [],
          campusScope: null,
          entitlementGroups: [],
          policyProjectionVersion: "phase1-authorization-projection-v1",
          visibilityLevel: "public",
          visibilityScope: null,
        },
        visibilityScope: null,
      },
      principal: {
        type: "public_user",
      },
    });
  });

  it("maps explicit campus identity claims into a campus student principal with an entitlement snapshot", () => {
    expect(
      mapSessionToAppPrincipal(
        {
          session: {
            expiresAt: "2026-03-29T08:00:00.000Z",
            id: "sess_01HQ",
          },
          user: {
            email: "student@example.edu",
            id: "user_01HQ",
            name: "Jane Doe",
          },
        },
        {
          actorGroups: ["campus_members", "students"],
          actorRoles: ["campus_member", "student"],
          applicabilityScope: "undergraduate",
          departments: ["philosophy"],
          entitlementGroups: ["campus_members", "students"],
          entitlementSnapshotId: "entitlements-2026-04-02",
          principalType: "student",
          visibilityScope: "north",
        },
      ),
    ).toMatchObject({
      actor: {
        campusScope: "north",
        departments: ["philosophy"],
        groups: ["campus_members", "students"],
        principalId: "user_01HQ",
        roles: ["campus_member", "student"],
        userId: "user_01HQ",
      },
      authorization: {
        applicabilityScope: "undergraduate",
        entitlementGroups: ["campus_members", "students"],
        entitlementSnapshotId: "entitlements-2026-04-02",
        principalId: "user_01HQ",
        retrievalFilter: {
          aclGroups: [],
          campusScope: null,
          entitlementGroups: ["campus_members", "students"],
          policyProjectionVersion: "phase1-authorization-projection-v1",
          visibilityLevel: "public",
          visibilityScope: "north",
        },
        visibilityScope: "north",
      },
      principal: {
        type: "student",
      },
    });
  });
});

describe("request principal resolution", () => {
  beforeEach(() => {
    mockedGetAppAuth.mockReset();
  });

  it("ignores campus identity headers without a matching internal shared secret", async () => {
    mockedGetAppAuth.mockResolvedValue({
      api: {
        getSession: vi.fn().mockResolvedValue({
          session: {
            expiresAt: "2026-03-29T08:00:00.000Z",
            id: "sess_01HQ",
          },
          user: {
            email: "student@example.edu",
            id: "user_01HQ",
            name: "Jane Doe",
          },
        }),
      },
    } as never);

    const principal = await resolveRequestPrincipal(
      new Request("https://app-api.internal/api/chat/requests", {
        headers: {
          "x-app-campus-entitlement-groups": "campus_members,students",
          "x-app-campus-entitlement-snapshot-id": "entitlements-2026-04-02",
          "x-app-campus-principal-type": "student",
          "x-app-campus-visibility-scope": "north",
        },
      }),
      {
        APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
      },
    );

    expect(principal).toMatchObject({
      principal: {
        type: "public_user",
      },
      authorization: {
        entitlementGroups: [],
        entitlementSnapshotId: "",
        visibilityScope: null,
      },
    });
  });

  it("projects campus identity headers only for trusted internal requests", async () => {
    mockedGetAppAuth.mockResolvedValue({
      api: {
        getSession: vi.fn().mockResolvedValue({
          session: {
            expiresAt: "2026-03-29T08:00:00.000Z",
            id: "sess_01HQ",
          },
          user: {
            email: "student@example.edu",
            id: "user_01HQ",
            name: "Jane Doe",
          },
        }),
      },
    } as never);

    const principal = await resolveRequestPrincipal(
      new Request("https://app-api.internal/api/chat/requests", {
        headers: {
          "x-app-campus-actor-groups": "campus_members,students",
          "x-app-campus-actor-roles": "campus_member,student",
          "x-app-campus-applicability-scope": "undergraduate",
          "x-app-campus-departments": "philosophy",
          "x-app-campus-entitlement-groups": "campus_members,students",
          "x-app-campus-entitlement-snapshot-id": "entitlements-2026-04-02",
          "x-app-campus-principal-type": "student",
          "x-app-campus-visibility-scope": "north",
          "x-app-internal-auth": "trusted-secret",
        },
      }),
      {
        APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
      },
    );

    expect(principal).toMatchObject({
      actor: {
        campusScope: "north",
        departments: ["philosophy"],
        groups: ["campus_members", "students"],
        roles: ["campus_member", "student"],
      },
      authorization: {
        applicabilityScope: "undergraduate",
        entitlementGroups: ["campus_members", "students"],
        entitlementSnapshotId: "entitlements-2026-04-02",
        visibilityScope: "north",
      },
      principal: {
        type: "student",
      },
    });
  });
});

describe("official web collector principal resolution", () => {
  it("does not trust missing or invalid bearer tokens", async () => {
    const missing = await resolveOfficialWebCollectorPrincipal(
      new Request("https://app-api.internal/api/official-web/runs"),
      {},
    );
    const invalid = await resolveOfficialWebCollectorPrincipal(
      new Request("https://app-api.internal/api/official-web/runs", {
        headers: {
          authorization: "Bearer invalid-token",
        },
      }),
      {
        APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN: "trusted-collector-token",
      },
    );

    expect(missing).toBeNull();
    expect(invalid).toBeNull();
  });

  it("resolves the collector service principal only when the configured bearer token matches", async () => {
    const principal = await resolveOfficialWebCollectorPrincipal(
      new Request("https://app-api.internal/api/official-web/runs", {
        headers: {
          authorization: "Bearer trusted-collector-token",
        },
      }),
      {
        APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN: "trusted-collector-token",
      },
    );

    expect(principal).toEqual({
      kind: "service",
      serviceClass: "official_web_collector",
      serviceId: "official-web-collector",
    });
  });
});
