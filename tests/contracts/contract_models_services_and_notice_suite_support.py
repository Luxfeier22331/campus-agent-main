# ruff: noqa: F403
from __future__ import annotations

from pathlib import Path

from tests.contracts.contract_models_test_support import *

VPN_GROUPED_PROCEDURE_FIXTURE_PATH = Path(
    "tests/fixtures/service_guide_vpn_grouped_procedure_result.json"
)

__all__ = [name for name in globals() if not name.startswith("__")]
