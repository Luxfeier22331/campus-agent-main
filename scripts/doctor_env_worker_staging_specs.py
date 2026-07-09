from __future__ import annotations

WORKER_STAGING_SURFACE_SPECS = {
    "worker-staging": {
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
    "worker-staging-app-api": {
        "providers": {},
        "required_settings": {},
        "optional_settings": {
            "staging_sentry_release": ("STAGING_SENTRY_RELEASE",),
        },
        "files": {},
    },
    "worker-staging-campus-web": {
        "providers": {},
        "required_settings": {
            "staging_campus_auth_turnstile_site_key": ("STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY",),
        },
        "optional_settings": {
            "staging_campus_auth_turnstile_appearance": (
                "STAGING_CAMPUS_AUTH_TURNSTILE_APPEARANCE",
            ),
            "staging_campus_auth_turnstile_execution": ("STAGING_CAMPUS_AUTH_TURNSTILE_EXECUTION",),
            "staging_sentry_release": ("STAGING_SENTRY_RELEASE",),
        },
        "files": {},
    },
    "worker-staging-operator-console-web": {
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
