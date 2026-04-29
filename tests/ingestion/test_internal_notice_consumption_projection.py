from __future__ import annotations

from tests.ingestion.internal_notice_consumption_projection_core_suite import (
    InternalNoticeConsumptionProjectionCoreTest,
)
from tests.ingestion.internal_notice_consumption_projection_multimodal_suite import (
    InternalNoticeConsumptionProjectionMultimodalTest,
)
from tests.ingestion.internal_notice_consumption_projection_routing_suite import (
    InternalNoticeConsumptionProjectionRoutingTest,
)
from tests.ingestion.internal_notice_consumption_projection_status_suite import (
    InternalNoticeConsumptionProjectionStatusTest,
)
from tests.ingestion.internal_notice_consumption_projection_store_suite import (
    NoticeConsumptionProjectionPostgresStoreTest,
)

__all__ = [
    "InternalNoticeConsumptionProjectionCoreTest",
    "InternalNoticeConsumptionProjectionMultimodalTest",
    "InternalNoticeConsumptionProjectionRoutingTest",
    "InternalNoticeConsumptionProjectionStatusTest",
    "NoticeConsumptionProjectionPostgresStoreTest",
]
