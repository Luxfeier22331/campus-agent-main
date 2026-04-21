from __future__ import annotations

from campus_ingestion_core.official_web_projection_config import (
    default_official_web_projection_declarations_path,
    default_official_web_projection_routing_path,
    load_official_web_projection_declarations,
    load_official_web_projection_routing,
)
from campus_ingestion_core.official_web_projection_engine import (
    replay_official_web_source_truth_local,
)
from campus_ingestion_core.official_web_projection_shared import (
    OfficialWebProjectionDeclaration,
    OfficialWebProjectionDeclarationsConfig,
    OfficialWebProjectionReplayReport,
    OfficialWebProjectionRoute,
    OfficialWebProjectionRoutingConfig,
    OfficialWebProjectionValidationReport,
)
from campus_ingestion_core.official_web_projection_validation import (
    validate_official_web_projection_output,
)

__all__ = [
    "OfficialWebProjectionDeclaration",
    "OfficialWebProjectionDeclarationsConfig",
    "OfficialWebProjectionReplayReport",
    "OfficialWebProjectionRoute",
    "OfficialWebProjectionRoutingConfig",
    "OfficialWebProjectionValidationReport",
    "default_official_web_projection_declarations_path",
    "default_official_web_projection_routing_path",
    "load_official_web_projection_declarations",
    "load_official_web_projection_routing",
    "replay_official_web_source_truth_local",
    "validate_official_web_projection_output",
]
