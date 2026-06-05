from __future__ import annotations

UNIVERSITY_COLLECTION_PREFLIGHT_SCHEMA_VERSION = "official_web_university_collection_preflight.v1"
UNIVERSITY_COLLECTION_RUN_SCHEMA_VERSION = "official_web_university_collection_run.v1"
UNIVERSITY_COLLECTION_COMPARE_SCHEMA_VERSION = "official_web_university_collection_compare.v1"
UNIVERSITY_COLLECTION_ALERT_SCHEMA_VERSION = "official_web_university_collection_alert_summary.v1"
LEGACY_UNIVERSITY_LANE_PREFIX = "university-core-"
CURRENT_UNIVERSITY_LANE_IDS = frozenset(("consumer-candidate-hot", "consumer-stable-baseline"))
UNIVERSITY_ALLOWED_HOST_GROUPS = frozenset({"university_core", "university_support"})
UNIVERSITY_REQUIRED_PAGE_FAMILIES = frozenset(
    {
        "article_detail",
        "listing_page",
        "directory_page",
        "sitemap_navigation_page",
        "data_table_page",
        "gallery_page",
        "contact_widget_page",
        "structural_shell_page",
        "dynamic_shell_page",
        "generic_content_page",
    }
)
