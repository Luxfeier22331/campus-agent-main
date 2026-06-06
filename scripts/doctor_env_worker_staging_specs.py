from __future__ import annotations

WORKER_STAGING_SURFACE_SPECS = {
    "worker-staging": {
        "providers": {},
        "required_settings": {
            "staging_access_policy_aud": ("STAGING_ACCESS_POLICY_AUD",),
            "staging_access_team_domain": ("STAGING_ACCESS_TEAM_DOMAIN",),
            "staging_execution_control_base_url": ("STAGING_EXECUTION_CONTROL_BASE_URL",),
        },
        "optional_settings": {
            "staging_app_api_database_sslmode": ("STAGING_APP_API_DATABASE_SSLMODE",),
            "staging_app_api_operator_database_url": ("STAGING_APP_API_OPERATOR_DATABASE_URL",),
            "staging_sentry_release": ("STAGING_SENTRY_RELEASE",),
        },
        "files": {},
    },
    "worker-staging-app-api": {
        "providers": {},
        "required_settings": {
            "staging_execution_control_base_url": ("STAGING_EXECUTION_CONTROL_BASE_URL",),
        },
        "optional_settings": {
            "staging_app_api_database_sslmode": ("STAGING_APP_API_DATABASE_SSLMODE",),
            "staging_app_api_operator_database_url": ("STAGING_APP_API_OPERATOR_DATABASE_URL",),
            "staging_sentry_release": ("STAGING_SENTRY_RELEASE",),
        },
        "files": {},
    },
    "worker-staging-public-chat-web": {
        "providers": {},
        "required_settings": {},
        "optional_settings": {
            "staging_sentry_release": ("STAGING_SENTRY_RELEASE",),
        },
        "files": {},
    },
    "worker-staging-hub-web": {
        "providers": {},
        "required_settings": {
            "staging_hub_auth_turnstile_site_key": ("STAGING_HUB_AUTH_TURNSTILE_SITE_KEY",),
        },
        "optional_settings": {
            "staging_hub_auth_turnstile_appearance": ("STAGING_HUB_AUTH_TURNSTILE_APPEARANCE",),
            "staging_hub_auth_turnstile_execution": ("STAGING_HUB_AUTH_TURNSTILE_EXECUTION",),
            "staging_sentry_release": ("STAGING_SENTRY_RELEASE",),
        },
        "files": {},
    },
    "worker-staging-protected-panel-web": {
        "providers": {},
        "required_settings": {
            "staging_access_policy_aud": ("STAGING_ACCESS_POLICY_AUD",),
            "staging_access_team_domain": ("STAGING_ACCESS_TEAM_DOMAIN",),
        },
        "optional_settings": {
            "staging_sentry_release": ("STAGING_SENTRY_RELEASE",),
        },
        "files": {},
    },
}
