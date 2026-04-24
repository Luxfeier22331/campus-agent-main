from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from campus_supervisor_core_worker.bridge_server import BridgeServerSettings
from campus_supervisor_core_worker.bridge_server import main as bridge_server_main


class SupervisorApiBridgeServerTest(unittest.TestCase):
    def test_bridge_server_settings_read_host_and_port_from_env(self) -> None:
        env = os.environ | {
            "SUPERVISOR_CORE_WORKER_HOST": "0.0.0.0",
            "SUPERVISOR_CORE_WORKER_PORT": "18091",
        }
        with patch.dict(os.environ, env, clear=True):
            settings = BridgeServerSettings.from_env()

        self.assertEqual(settings.host, "0.0.0.0")
        self.assertEqual(settings.port, 18091)

    def test_main_loads_repo_env_before_serving(self) -> None:
        with (
            patch("campus_supervisor_core_worker.bridge_server.load_repo_env") as load_repo_env,
            patch("campus_supervisor_core_worker.bridge_server.serve") as serve,
        ):
            bridge_server_main()

        load_repo_env.assert_called_once_with()
        serve.assert_called_once_with()
