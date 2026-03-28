// @vitest-environment node

import { describe, expect, it } from "vitest";

import { mapOperatorHeadersToPrincipal } from "../src/modules/auth/principal";

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
        snapshot: {
          source: "trusted_operator_bridge",
        },
        userId: "operator-001",
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
