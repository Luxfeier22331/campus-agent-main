from __future__ import annotations

import unittest

from campus_protected_internal_panel import create_app
from campus_protected_internal_panel.settings import ProtectedPanelSettings


class ProtectedInternalPanelTest(unittest.TestCase):
    def test_shell_exposes_only_health_readiness_and_fail_closed_root(self) -> None:
        app = create_app()

        self.assertEqual(
            {route.path for route in app.routes},
            {"/", "/healthz", "/readyz"},
        )

    def test_root_route_stays_fail_closed_until_outer_protection_exists(self) -> None:
        app = create_app(
            settings=ProtectedPanelSettings(
                runtime_api_base_url="http://127.0.0.1:8000",
                protected_hostname="panel.internal.example",
            )
        )

        response = app.handle("GET", "/")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            response.json_body["error"]["code"],
            "protected_surface_required",
        )
        self.assertEqual(
            response.json_body["runtime_api_base_url"],
            "http://127.0.0.1:8000",
        )
        self.assertEqual(
            response.json_body["protected_hostname"],
            "panel.internal.example",
        )

    def test_health_and_ready_routes_report_shell_runtime_shape(self) -> None:
        app = create_app(
            settings=ProtectedPanelSettings(
                app_name="campus-agent-v2-protected-panel",
                runtime_api_base_url="http://127.0.0.1:8000",
                protected_hostname="panel.internal.example",
                protection_envelope="cloudflare-access",
            )
        )

        health = app.handle("GET", "/healthz")
        ready = app.handle("GET", "/readyz")

        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json_body["surface"], "protected-internal-panel")
        self.assertEqual(health.json_body["app_name"], "campus-agent-v2-protected-panel")
        self.assertEqual(ready.status_code, 200)
        self.assertEqual(ready.json_body["runtime_api_base_url"], "http://127.0.0.1:8000")
        self.assertEqual(ready.json_body["protected_hostname"], "panel.internal.example")
        self.assertEqual(ready.json_body["protection_envelope"], "cloudflare-access")


if __name__ == "__main__":
    unittest.main()
