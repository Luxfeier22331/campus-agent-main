--
-- PostgreSQL database dump
--


-- Dumped from database version 16.14 (Debian 16.14-1.pgdg13+1)
-- Dumped by pg_dump version 16.14 (Debian 16.14-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: app_auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA app_auth;


--
-- Name: campus_docs_serving; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA campus_docs_serving;


--
-- Name: campus_groups; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA campus_groups;


--
-- Name: chat; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA chat;


--
-- Name: dining; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA dining;


--


--
-- Name: execution_control; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA execution_control;


--
-- Name: internal_portal; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA internal_portal;


--
-- Name: model_config; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA model_config;


--
-- Name: notices; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA notices;


--
-- Name: profile; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA profile;


--
-- Name: runtime; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA runtime;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE app_auth.account (
    id text NOT NULL,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" text NOT NULL,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamp with time zone,
    "refreshTokenExpiresAt" timestamp with time zone,
    scope text,
    password text,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    issuer text NOT NULL
);


--
-- Name: account_admin_event; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE app_auth.account_admin_event (
    action text NOT NULL,
    actor_id text NOT NULL,
    error_code text,
    event_id text NOT NULL,
    idempotency_key text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    outcome text NOT NULL,
    reason text,
    request_fingerprint text NOT NULL,
    target_user_id text,
    CONSTRAINT account_admin_event_outcome_check CHECK ((outcome = ANY (ARRAY['started'::text, 'succeeded'::text, 'failed'::text, 'indeterminate'::text])))
);


--
-- Name: email_access_grant; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE app_auth.email_access_grant (
    id text NOT NULL,
    email text NOT NULL,
    kind text NOT NULL,
    environment text NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    user_id text,
    claim_expires_at timestamp with time zone NOT NULL,
    access_expires_at timestamp with time zone,
    created_by text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    claimed_at timestamp with time zone,
    revoked_by text,
    revoked_at timestamp with time zone,
    last_invitation_sent_at timestamp with time zone,
    CONSTRAINT email_access_grant_environment_check CHECK ((environment = ANY (ARRAY['development'::text, 'test'::text, 'staging'::text, 'production'::text]))),
    CONSTRAINT email_access_grant_kind_check CHECK ((kind = ANY (ARRAY['invitation'::text, 'test'::text]))),
    CONSTRAINT email_access_grant_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'active'::text, 'revoked'::text, 'expired'::text]))),
    CONSTRAINT email_access_grant_state_shape_check CHECK ((((state = 'pending'::text) AND (user_id IS NULL) AND (claimed_at IS NULL) AND (revoked_at IS NULL)) OR ((state = 'active'::text) AND (user_id IS NOT NULL) AND (claimed_at IS NOT NULL) AND (revoked_at IS NULL)) OR ((state = 'revoked'::text) AND (revoked_at IS NOT NULL)) OR (state = 'expired'::text))),
    CONSTRAINT email_access_grant_test_boundary_check CHECK (((kind <> 'test'::text) OR ((environment <> 'production'::text) AND (access_expires_at IS NOT NULL))))
);


--
-- Name: email_access_grant_event; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE app_auth.email_access_grant_event (
    id text NOT NULL,
    grant_id text NOT NULL,
    action text NOT NULL,
    actor_id text NOT NULL,
    idempotency_key text,
    payload_hash text,
    outcome text NOT NULL,
    error_code text,
    occurred_at timestamp with time zone NOT NULL,
    CONSTRAINT email_access_grant_event_action_check CHECK ((action = ANY (ARRAY['created'::text, 'invitation_sent'::text, 'claimed'::text, 'revoked'::text, 'expired'::text]))),
    CONSTRAINT email_access_grant_event_outcome_check CHECK ((outcome = ANY (ARRAY['started'::text, 'succeeded'::text, 'failed'::text])))
);


--
-- Name: jwks; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE app_auth.jwks (
    id text NOT NULL,
    "publicKey" text NOT NULL,
    "privateKey" text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "expiresAt" timestamp with time zone,
    alg text,
    crv text
);


--
-- Name: oauthAccessToken; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE app_auth."oauthAccessToken" (
    id text NOT NULL,
    token text NOT NULL,
    "clientId" text NOT NULL,
    "sessionId" text,
    "userId" text,
    "referenceId" text,
    "refreshId" text,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    scopes jsonb NOT NULL,
    "authorizationCodeId" text,
    resources jsonb,
    "requestedUserInfoClaims" jsonb,
    revoked timestamp with time zone,
    confirmation jsonb
);


--
-- Name: oauthClient; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE app_auth."oauthClient" (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "clientSecret" text,
    disabled boolean DEFAULT false,
    "skipConsent" boolean,
    "enableEndSession" boolean,
    "subjectType" text,
    scopes jsonb,
    "userId" text,
    "createdAt" timestamp with time zone,
    "updatedAt" timestamp with time zone,
    name text,
    uri text,
    icon text,
    contacts jsonb,
    tos text,
    policy text,
    "softwareId" text,
    "softwareVersion" text,
    "softwareStatement" text,
    "redirectUris" jsonb NOT NULL,
    "postLogoutRedirectUris" jsonb,
    "tokenEndpointAuthMethod" text,
    "grantTypes" jsonb,
    "responseTypes" jsonb,
    public boolean,
    type text,
    "requirePKCE" boolean,
    "referenceId" text,
    metadata jsonb,
    "clientDiscoveryId" text,
    "clientCredentialsScopes" jsonb DEFAULT '[]'::jsonb,
    "backchannelLogoutUri" text,
    "backchannelLogoutSessionRequired" boolean,
    "applicationType" text,
    jwks text,
    "jwksUri" text,
    "dpopBoundAccessTokens" boolean DEFAULT false
);


--
-- Name: oauthClientAssertion; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE app_auth."oauthClientAssertion" (
    id text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL
);


--
-- Name: oauthClientResource; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE app_auth."oauthClientResource" (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "resourceId" text NOT NULL,
    metadata jsonb,
    "createdAt" timestamp with time zone
);


--
-- Name: oauthConsent; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE app_auth."oauthConsent" (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "userId" text,
    "referenceId" text,
    scopes jsonb NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    resources jsonb,
    "requestedUserInfoClaims" jsonb
);


--
-- Name: oauthRefreshToken; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE app_auth."oauthRefreshToken" (
    id text NOT NULL,
    token text NOT NULL,
    "clientId" text NOT NULL,
    "sessionId" text,
    "userId" text NOT NULL,
    "referenceId" text,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    revoked timestamp with time zone,
    "authTime" timestamp with time zone,
    scopes jsonb NOT NULL,
    "authorizationCodeId" text,
    resources jsonb,
    "requestedUserInfoClaims" jsonb,
    "rotatedAt" timestamp with time zone,
    "rotationReplayResponse" text,
    "rotationReplayExpiresAt" timestamp with time zone,
    confirmation jsonb
);


--
-- Name: oauthResource; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE app_auth."oauthResource" (
    id text NOT NULL,
    identifier text NOT NULL,
    name text NOT NULL,
    "accessTokenTtl" integer,
    "refreshTokenTtl" integer,
    "signingAlgorithm" text,
    "signingKeyId" text,
    "allowedScopes" jsonb,
    "customClaims" jsonb,
    "dpopBoundAccessTokensRequired" boolean DEFAULT false,
    disabled boolean DEFAULT false,
    "createdAt" timestamp with time zone,
    "updatedAt" timestamp with time zone,
    "policyVersion" integer DEFAULT 1,
    metadata jsonb
);


--
-- Name: rateLimit; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE app_auth."rateLimit" (
    key text NOT NULL,
    count integer NOT NULL,
    "lastRequest" bigint NOT NULL,
    id text NOT NULL
);


--
-- Name: session; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE app_auth.session (
    id text NOT NULL,
    token text NOT NULL,
    "userId" text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "impersonatedBy" text,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


--
-- Name: user; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE app_auth."user" (
    "banExpires" timestamp with time zone,
    "banReason" text,
    banned boolean DEFAULT false NOT NULL,
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    "emailVerified" boolean DEFAULT false NOT NULL,
    image text,
    "passwordChangeRequired" boolean DEFAULT false NOT NULL,
    role text DEFAULT 'user'::text,
    "temporaryPasswordExpiresAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


--
-- Name: verification; Type: TABLE; Schema: app_auth; Owner: -
--

CREATE TABLE app_auth.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


--
-- Name: current_index; Type: TABLE; Schema: campus_docs_serving; Owner: -
--

CREATE TABLE campus_docs_serving.current_index (
    singleton boolean DEFAULT true NOT NULL,
    collection text NOT NULL,
    CONSTRAINT current_index_collection_check CHECK ((collection ~ '^campus_docs_[a-f0-9]{64}$'::text)),
    CONSTRAINT current_index_singleton_check CHECK (singleton)
);


--
-- Name: groups; Type: TABLE; Schema: campus_groups; Owner: -
--

CREATE TABLE campus_groups.groups (
    id text NOT NULL,
    join_url text,
    name text NOT NULL,
    "position" integer NOT NULL,
    qq_group_number text,
    section_id text NOT NULL,
    summary text NOT NULL,
    tags text[] NOT NULL,
    CONSTRAINT campus_groups_groups_position_check CHECK (("position" >= 0))
);


--
-- Name: sections; Type: TABLE; Schema: campus_groups; Owner: -
--

CREATE TABLE campus_groups.sections (
    id text NOT NULL,
    name text NOT NULL,
    "position" integer NOT NULL,
    CONSTRAINT campus_groups_sections_position_check CHECK (("position" >= 0))
);


--
-- Name: conversations; Type: TABLE; Schema: chat; Owner: -
--

CREATE TABLE chat.conversations (
    id text NOT NULL,
    owner_user_id text NOT NULL,
    title text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    archived_at timestamp with time zone,
    pinned_at timestamp with time zone,
    deleted_at timestamp with time zone,
    title_updated_at timestamp with time zone,
    active_branch_id text DEFAULT 'branch_active'::text NOT NULL,
    active_message_id text,
    active_request_id text,
    active_turn_sequence integer DEFAULT 0 NOT NULL
);


--
-- Name: message_feedback; Type: TABLE; Schema: chat; Owner: -
--

CREATE TABLE chat.message_feedback (
    feedback_id text NOT NULL,
    owner_user_id text NOT NULL,
    conversation_id text NOT NULL,
    message_id text NOT NULL,
    request_id text NOT NULL,
    vote text NOT NULL,
    reason_codes_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: messages; Type: TABLE; Schema: chat; Owner: -
--

CREATE TABLE chat.messages (
    id text NOT NULL,
    conversation_id text NOT NULL,
    role text NOT NULL,
    kind text,
    text text NOT NULL,
    structured_parts_json jsonb,
    created_at timestamp with time zone NOT NULL,
    request_id text,
    retryable boolean,
    parent_message_id text,
    branch_id text DEFAULT 'branch_active'::text NOT NULL,
    turn_sequence integer DEFAULT 0 NOT NULL,
    is_active_branch_head boolean DEFAULT false NOT NULL
);


--
-- Name: session_slots; Type: TABLE; Schema: chat; Owner: -
--

CREATE TABLE chat.session_slots (
    conversation_id text NOT NULL,
    name text NOT NULL,
    value text NOT NULL,
    confirmed boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: turn_dispatches; Type: TABLE; Schema: chat; Owner: -
--

CREATE TABLE chat.turn_dispatches (
    request_id text NOT NULL,
    conversation_id text NOT NULL,
    user_message_id text NOT NULL,
    turn_sequence integer NOT NULL,
    surface text NOT NULL,
    owner_user_id text NOT NULL,
    actor_user_id text NOT NULL,
    principal_snapshot_json jsonb NOT NULL,
    idempotency_key text,
    request_fingerprint_sha256 text,
    safety_identifier text,
    status text NOT NULL,
    error_code text,
    created_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone NOT NULL,
    assistant_message_id text NOT NULL,
    finalization_fingerprint text,
    execution_input_json text,
    execution_input_sha256 text,
    memory_recall_enabled boolean,
    memory_append_enabled boolean,
    memory_owner_generation bigint,
    memory_owner_sequence bigint,
    CONSTRAINT chat_turn_dispatches_execution_input_pair_check CHECK (((execution_input_json IS NULL) = (execution_input_sha256 IS NULL))),
    CONSTRAINT chat_turn_dispatches_input_lifecycle_check CHECK ((((status = 'accepted'::text) AND ((execution_input_json IS NOT NULL) AND (execution_input_sha256 IS NOT NULL))) OR ((status = ANY (ARRAY['completed'::text, 'error'::text, 'approval_required'::text, 'rejected'::text, 'cancelled'::text])) AND (((execution_input_json IS NULL) AND (execution_input_sha256 IS NULL)) OR ((execution_input_json IS NOT NULL) AND (execution_input_sha256 IS NOT NULL))))))
);


--
-- Name: map_draft; Type: TABLE; Schema: dining; Owner: -
--

CREATE TABLE dining.map_draft (
    bundle_json jsonb NOT NULL,
    fingerprint text NOT NULL,
    revision integer NOT NULL,
    scope text NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    updated_by text NOT NULL,
    CONSTRAINT dining_map_draft_fingerprint_check CHECK ((fingerprint ~ '^sha256:[0-9a-f]{64}$'::text)),
    CONSTRAINT dining_map_draft_revision_check CHECK ((revision > 0)),
    CONSTRAINT dining_map_draft_scope_check CHECK ((scope = 'global'::text))
);


--
-- Name: map_publication; Type: TABLE; Schema: dining; Owner: -
--

CREATE TABLE dining.map_publication (
    release_id text NOT NULL,
    scope text NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    updated_by text NOT NULL,
    CONSTRAINT dining_map_publication_scope_check CHECK ((scope = 'global'::text))
);


--
-- Name: map_releases; Type: TABLE; Schema: dining; Owner: -
--

CREATE TABLE dining.map_releases (
    bundle_json jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    created_by text NOT NULL,
    draft_revision integer NOT NULL,
    kind text NOT NULL,
    public_payload_json jsonb NOT NULL,
    release_id text NOT NULL,
    restored_from_release_id text,
    snapshot_hash text NOT NULL,
    CONSTRAINT dining_map_releases_kind_check CHECK ((kind = ANY (ARRAY['publish'::text, 'restore'::text]))),
    CONSTRAINT dining_map_releases_revision_check CHECK ((draft_revision > 0)),
    CONSTRAINT dining_map_releases_snapshot_hash_check CHECK ((snapshot_hash ~ '^sha256:[0-9a-f]{64}$'::text))
);


--
-- Name: menu_items; Type: TABLE; Schema: dining; Owner: -
--

CREATE TABLE dining.menu_items (
    archived_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    created_by text NOT NULL,
    menu_item_id text NOT NULL,
    name text NOT NULL,
    price_text text,
    sort_order integer NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    updated_by text NOT NULL,
    window_id text NOT NULL,
    CONSTRAINT dining_menu_items_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 80))),
    CONSTRAINT dining_menu_items_price_check CHECK (((price_text IS NULL) OR ((length(btrim(price_text)) >= 1) AND (length(btrim(price_text)) <= 40)))),
    CONSTRAINT dining_menu_items_sort_order_check CHECK ((sort_order >= 0))
);


--
-- Name: review_edits; Type: TABLE; Schema: dining; Owner: -
--

CREATE TABLE dining.review_edits (
    edit_id text NOT NULL,
    edited_at timestamp with time zone NOT NULL,
    edited_by text NOT NULL,
    next_body text NOT NULL,
    previous_body text NOT NULL,
    review_id text NOT NULL
);


--
-- Name: review_reports; Type: TABLE; Schema: dining; Owner: -
--

CREATE TABLE dining.review_reports (
    created_at timestamp with time zone NOT NULL,
    details text,
    reason text NOT NULL,
    report_id text NOT NULL,
    reporter_user_id text NOT NULL,
    resolution text,
    resolved_at timestamp with time zone,
    resolved_by text,
    review_id text NOT NULL,
    CONSTRAINT dining_review_reports_details_check CHECK (((details IS NULL) OR (length(details) <= 300))),
    CONSTRAINT dining_review_reports_reason_check CHECK ((reason = ANY (ARRAY['spam'::text, 'inappropriate'::text, 'privacy'::text, 'other'::text]))),
    CONSTRAINT dining_review_reports_resolution_check CHECK (((resolution IS NULL) OR (resolution = ANY (ARRAY['keep'::text, 'hide'::text])))),
    CONSTRAINT dining_review_reports_resolution_state_check CHECK ((((resolution IS NULL) AND (resolved_at IS NULL) AND (resolved_by IS NULL)) OR ((resolution IS NOT NULL) AND (resolved_at IS NOT NULL) AND (resolved_by IS NOT NULL))))
);


--
-- Name: reviews; Type: TABLE; Schema: dining; Owner: -
--

CREATE TABLE dining.reviews (
    anonymous boolean NOT NULL,
    author_display_name text NOT NULL,
    author_id text NOT NULL,
    author_kind text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by text,
    edited_at timestamp with time zone,
    hidden_at timestamp with time zone,
    hidden_by text,
    idempotency_key text NOT NULL,
    menu_item_id text NOT NULL,
    review_id text NOT NULL,
    submission_date date NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    updated_by text NOT NULL,
    CONSTRAINT dining_reviews_author_kind_check CHECK ((author_kind = ANY (ARRAY['member'::text, 'operator'::text]))),
    CONSTRAINT dining_reviews_body_check CHECK (((length(btrim(body)) >= 1) AND (length(btrim(body)) <= 500)))
);


--
-- Name: agent_invocation_receipts; Type: TABLE; Schema: execution_control; Owner: -
--

CREATE TABLE execution_control.agent_invocation_receipts (
    invocation_id text NOT NULL,
    input_sha256 text NOT NULL,
    state text NOT NULL,
    output_json jsonb,
    output_sha256 text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone NOT NULL,
    request_id text NOT NULL
);


--
-- Name: agent_run_cancellations; Type: TABLE; Schema: execution_control; Owner: -
--

CREATE TABLE execution_control.agent_run_cancellations (
    workflow_id text NOT NULL,
    reason text NOT NULL,
    state text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone NOT NULL,
    lease_token text DEFAULT ''::text NOT NULL,
    lease_until timestamp with time zone,
    last_error_code text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    request_id text NOT NULL
);


--
-- Name: agent_run_events; Type: TABLE; Schema: execution_control; Owner: -
--

CREATE TABLE execution_control.agent_run_events (
    event_id text NOT NULL,
    conversation_id text NOT NULL,
    sequence bigint NOT NULL,
    event_type text NOT NULL,
    visibility text NOT NULL,
    payload_schema_version text NOT NULL,
    payload_json jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    request_id text NOT NULL
);


--
-- Name: agent_run_steps; Type: TABLE; Schema: execution_control; Owner: -
--

CREATE TABLE execution_control.agent_run_steps (
    step_id text NOT NULL,
    conversation_id text NOT NULL,
    step_kind text NOT NULL,
    tool text DEFAULT ''::text NOT NULL,
    parent_step_id text DEFAULT ''::text NOT NULL,
    status text NOT NULL,
    activity_attempt integer DEFAULT 0 NOT NULL,
    task_queue text DEFAULT ''::text NOT NULL,
    worker_id text DEFAULT ''::text NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone NOT NULL,
    payload_schema_version text NOT NULL,
    sanitized_payload_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    request_id text NOT NULL
);


--
-- Name: agent_runs; Type: TABLE; Schema: execution_control; Owner: -
--

CREATE TABLE execution_control.agent_runs (
    conversation_id text NOT NULL,
    request_id text NOT NULL,
    owner_user_id text NOT NULL,
    surface text NOT NULL,
    task_queue text NOT NULL,
    status text NOT NULL,
    terminal_reason text DEFAULT ''::text NOT NULL,
    fail_close_reason text DEFAULT ''::text NOT NULL,
    retryable boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone NOT NULL,
    queued_at timestamp with time zone,
    admitted_at timestamp with time zone,
    started_at timestamp with time zone,
    streaming_started_at timestamp with time zone,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone NOT NULL,
    runtime_versions_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    final_response_ref text DEFAULT ''::text NOT NULL,
    request_fingerprint_sha256 text DEFAULT ''::text NOT NULL,
    metadata_json jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: agent_step_attempts; Type: TABLE; Schema: execution_control; Owner: -
--

CREATE TABLE execution_control.agent_step_attempts (
    attempt_id text NOT NULL,
    step_id text NOT NULL,
    attempt integer NOT NULL,
    status text NOT NULL,
    task_queue text DEFAULT ''::text NOT NULL,
    worker_id text DEFAULT ''::text NOT NULL,
    workflow_id text DEFAULT ''::text NOT NULL,
    temporal_run_id text DEFAULT ''::text NOT NULL,
    activity_id text DEFAULT ''::text NOT NULL,
    activity_type text DEFAULT ''::text NOT NULL,
    activity_attempt integer DEFAULT 0 NOT NULL,
    scheduled_at timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    schedule_to_start_ms bigint DEFAULT 0 NOT NULL,
    duration_ms bigint DEFAULT 0 NOT NULL,
    provider_request_ref text DEFAULT ''::text NOT NULL,
    provider_response_id text DEFAULT ''::text NOT NULL,
    model_provider text DEFAULT ''::text NOT NULL,
    model_name text DEFAULT ''::text NOT NULL,
    model_request_count bigint DEFAULT 0 NOT NULL,
    input_tokens bigint DEFAULT 0 NOT NULL,
    output_tokens bigint DEFAULT 0 NOT NULL,
    cached_input_tokens bigint DEFAULT 0 NOT NULL,
    usage_observed boolean DEFAULT false NOT NULL,
    cancel_outcome text DEFAULT ''::text NOT NULL,
    timeout_outcome text DEFAULT ''::text NOT NULL,
    late_completion_outcome text DEFAULT 'not_late'::text NOT NULL,
    fail_close_reason text DEFAULT ''::text NOT NULL,
    terminal_reason text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    payload_schema_version text NOT NULL,
    sanitized_payload_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    request_id text NOT NULL
);


--
-- Name: agent_step_results; Type: TABLE; Schema: execution_control; Owner: -
--

CREATE TABLE execution_control.agent_step_results (
    result_id text NOT NULL,
    step_id text NOT NULL,
    attempt_id text DEFAULT ''::text NOT NULL,
    status text NOT NULL,
    result_kind text NOT NULL,
    projection_ref text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    payload_schema_version text NOT NULL,
    sanitized_payload_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    request_id text NOT NULL
);


--
-- Name: agent_workflow_starts; Type: TABLE; Schema: execution_control; Owner: -
--

CREATE TABLE execution_control.agent_workflow_starts (
    workflow_id text NOT NULL,
    payload_sha256 text NOT NULL,
    task_queue text NOT NULL,
    workflow_input_json jsonb NOT NULL,
    state text NOT NULL,
    temporal_run_id text DEFAULT ''::text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    dispatch_attempted boolean DEFAULT false NOT NULL,
    next_attempt_at timestamp with time zone NOT NULL,
    lease_token text DEFAULT ''::text NOT NULL,
    lease_until timestamp with time zone,
    last_error_code text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    request_id text NOT NULL
);


--
-- Name: conversation_run_locks; Type: TABLE; Schema: execution_control; Owner: -
--

CREATE TABLE execution_control.conversation_run_locks (
    conversation_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    request_id text NOT NULL
);


--
-- Name: owner_deletion_fences; Type: TABLE; Schema: execution_control; Owner: -
--

CREATE TABLE execution_control.owner_deletion_fences (
    owner_user_id text NOT NULL,
    state text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT owner_deletion_fences_state_check CHECK ((state = ANY (ARRAY['draining'::text, 'deleted'::text])))
);


--
-- Name: personal_memory_call_leases; Type: TABLE; Schema: execution_control; Owner: -
--

CREATE TABLE execution_control.personal_memory_call_leases (
    call_id text NOT NULL,
    owner_scope_hash text NOT NULL,
    generation bigint NOT NULL,
    owner_sequence bigint NOT NULL,
    subject_scope_hash text NOT NULL,
    operation_kind text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: personal_memory_command_receipts; Type: TABLE; Schema: execution_control; Owner: -
--

CREATE TABLE execution_control.personal_memory_command_receipts (
    command_id text NOT NULL,
    owner_scope_hash text NOT NULL,
    generation bigint NOT NULL,
    sequence bigint NOT NULL,
    kind text NOT NULL,
    status text NOT NULL,
    error_code text DEFAULT ''::text NOT NULL,
    lease_expires_at timestamp with time zone,
    result_fingerprint text DEFAULT ''::text NOT NULL,
    subject_scope_hash text NOT NULL,
    supersession_scope text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    terminal_at timestamp with time zone
);


--
-- Name: personal_memory_owner_fences; Type: TABLE; Schema: execution_control; Owner: -
--

CREATE TABLE execution_control.personal_memory_owner_fences (
    owner_scope_hash text NOT NULL,
    generation bigint NOT NULL,
    lifecycle_state text NOT NULL,
    last_owner_sequence bigint NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: automation_tokens; Type: TABLE; Schema: internal_portal; Owner: -
--

CREATE TABLE internal_portal.automation_tokens (
    token_id text NOT NULL,
    name text NOT NULL,
    token_value text NOT NULL,
    token_hash text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT internal_portal_automation_tokens_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT internal_portal_automation_tokens_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 80))),
    CONSTRAINT internal_portal_automation_tokens_value_check CHECK ((length(token_value) > 0))
);


--
-- Name: credentials; Type: TABLE; Schema: internal_portal; Owner: -
--

CREATE TABLE internal_portal.credentials (
    credential_id text NOT NULL,
    name text NOT NULL,
    sso_tgc text NOT NULL,
    version integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    last_attempt_at timestamp with time zone,
    last_successful_at timestamp with time zone,
    last_outcome text,
    CONSTRAINT internal_portal_credentials_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 80))),
    CONSTRAINT internal_portal_credentials_outcome_check CHECK (((last_outcome IS NULL) OR (last_outcome = ANY (ARRAY['valid'::text, 'credential_rejected'::text, 'check_failed'::text])))),
    CONSTRAINT internal_portal_credentials_sso_tgc_check CHECK ((length(sso_tgc) > 0)),
    CONSTRAINT internal_portal_credentials_version_check CHECK ((version > 0))
);


--
-- Name: model_configs; Type: TABLE; Schema: model_config; Owner: -
--

CREATE TABLE model_config.model_configs (
    name text NOT NULL,
    provider text NOT NULL,
    api_protocol text NOT NULL,
    base_url text NOT NULL,
    model text NOT NULL,
    encrypted_api_key bytea NOT NULL,
    validation_status text NOT NULL,
    validation_error_code text DEFAULT ''::text NOT NULL,
    validation_message text DEFAULT ''::text NOT NULL,
    validation_observed_dimensions integer,
    validated_at timestamp with time zone NOT NULL,
    validated_by text NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    updated_by text NOT NULL,
    CONSTRAINT model_configs_name_check CHECK ((name = ANY (ARRAY['primary_agent'::text, 'campus_docs_embedding'::text, 'campus_docs_reranker'::text, 'notice_classification'::text]))),
    CONSTRAINT model_configs_validation_status_check CHECK ((validation_status = ANY (ARRAY['passed'::text, 'failed'::text])))
);


--
-- Name: categories; Type: TABLE; Schema: notices; Owner: -
--

CREATE TABLE notices.categories (
    category text NOT NULL
);


--
-- Name: notice_assets; Type: TABLE; Schema: notices; Owner: -
--

CREATE TABLE notices.notice_assets (
    notice_id bigint NOT NULL,
    asset_kind text NOT NULL,
    ordinal integer NOT NULL,
    original_name text,
    content_type text NOT NULL,
    byte_size bigint NOT NULL,
    content_sha256 text NOT NULL,
    portal_annex_id text,
    CONSTRAINT notice_assets_asset_kind_check CHECK ((asset_kind = ANY (ARRAY['image'::text, 'attachment'::text]))),
    CONSTRAINT notice_assets_byte_size_check CHECK ((byte_size >= 0)),
    CONSTRAINT notice_assets_content_sha256_check CHECK ((content_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT notice_assets_content_type_check CHECK ((content_type <> ''::text)),
    CONSTRAINT notice_assets_ordinal_check CHECK ((ordinal >= 0))
);


--
-- Name: notice_types; Type: TABLE; Schema: notices; Owner: -
--

CREATE TABLE notices.notice_types (
    notice_type integer NOT NULL,
    name text NOT NULL,
    CONSTRAINT notice_types_name_check CHECK ((name <> ''::text))
);


--
-- Name: notices; Type: TABLE; Schema: notices; Owner: -
--

CREATE TABLE notices.notices (
    notice_id bigint NOT NULL,
    notice_type integer NOT NULL,
    organization_id text,
    title text NOT NULL,
    released_at timestamp with time zone NOT NULL,
    is_external boolean NOT NULL,
    external_url text,
    content_html text,
    content_text text,
    category text,
    is_published boolean DEFAULT false NOT NULL,
    CONSTRAINT notices_check CHECK (((is_external AND (external_url IS NOT NULL)) OR ((NOT is_external) AND (external_url IS NULL)))),
    CONSTRAINT notices_external_content_check CHECK (((NOT is_external) OR ((content_html IS NULL) AND (content_text IS NULL)))),
    CONSTRAINT notices_published_category_check CHECK (((NOT is_published) OR (category IS NOT NULL))),
    CONSTRAINT notices_title_check CHECK ((title <> ''::text))
);


--
-- Name: organizations; Type: TABLE; Schema: notices; Owner: -
--

CREATE TABLE notices.organizations (
    organization_id text NOT NULL,
    name text NOT NULL,
    CONSTRAINT organizations_name_check CHECK ((name <> ''::text))
);


--
-- Name: account_deletion_requests; Type: TABLE; Schema: profile; Owner: -
--

CREATE TABLE profile.account_deletion_requests (
    attempt_count integer DEFAULT 0 NOT NULL,
    last_attempt_at timestamp with time zone,
    request_id text NOT NULL,
    owner_user_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    last_error_code text,
    lease_expires_at timestamp with time zone,
    lease_token text,
    next_attempt_at timestamp with time zone NOT NULL,
    requested_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT profile_account_deletion_lease_shape_check CHECK ((((lease_token IS NULL) AND (lease_expires_at IS NULL)) OR ((lease_token IS NOT NULL) AND (lease_expires_at IS NOT NULL) AND (status = 'pending'::text)))),
    CONSTRAINT profile_account_deletion_owner_status_check CHECK ((((status = 'pending'::text) AND (owner_user_id IS NOT NULL)) OR ((status = 'completed'::text) AND (owner_user_id IS NULL)))),
    CONSTRAINT profile_account_deletion_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text])))
);


--
-- Name: memory_command_sources; Type: TABLE; Schema: profile; Owner: -
--

CREATE TABLE profile.memory_command_sources (
    command_id text NOT NULL,
    source_message_id text NOT NULL
);


--
-- Name: memory_commands; Type: TABLE; Schema: profile; Owner: -
--

CREATE TABLE profile.memory_commands (
    command_id text NOT NULL,
    owner_user_id text NOT NULL,
    owner_generation bigint NOT NULL,
    owner_sequence bigint NOT NULL,
    command_kind text NOT NULL,
    supersession_scope text NOT NULL,
    subject_id text,
    subject_revision bigint,
    accepted_item_key text,
    accepted_item_value text,
    accepted_lifecycle_state text NOT NULL,
    source_updated_at timestamp with time zone NOT NULL,
    status text DEFAULT 'pending_admission'::text NOT NULL,
    admitted_at timestamp with time zone,
    last_error_code text,
    result_fingerprint text,
    reported_result_status text,
    idempotency_key_hash text NOT NULL,
    request_fingerprint text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    processed_at timestamp with time zone,
    CONSTRAINT profile_memory_commands_item_snapshot_pair_check CHECK (((accepted_item_key IS NULL) = (accepted_item_value IS NULL))),
    CONSTRAINT profile_memory_commands_lifecycle_snapshot_check CHECK ((accepted_lifecycle_state = ANY (ARRAY['active'::text, 'paused'::text, 'erasing'::text, 'erased'::text]))),
    CONSTRAINT profile_memory_commands_reported_result_status_check CHECK (((reported_result_status IS NULL) OR (reported_result_status = ANY (ARRAY['succeeded'::text, 'failed'::text])))),
    CONSTRAINT profile_memory_commands_supersession_scope_check CHECK (((length(supersession_scope) >= 1) AND (length(supersession_scope) <= 300)))
);


--
-- Name: memory_items; Type: TABLE; Schema: profile; Owner: -
--

CREATE TABLE profile.memory_items (
    item_id text NOT NULL,
    owner_user_id text NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    owner_generation bigint DEFAULT 1 NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    desired_state text DEFAULT 'present'::text NOT NULL,
    sync_status text DEFAULT 'pending'::text NOT NULL,
    sync_error_code text
);


--
-- Name: memory_settings; Type: TABLE; Schema: profile; Owner: -
--

CREATE TABLE profile.memory_settings (
    owner_user_id text NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    lifecycle_state text DEFAULT 'active'::text NOT NULL,
    sync_status text DEFAULT 'synced'::text NOT NULL,
    generation bigint DEFAULT 1 NOT NULL,
    command_sequence bigint DEFAULT 0 NOT NULL,
    erase_requested_at timestamp with time zone,
    erased_at timestamp with time zone
);


--
-- Name: personal_memory_call_leases; Type: VIEW; Schema: runtime; Owner: -
--

CREATE VIEW runtime.personal_memory_call_leases AS
 SELECT call_id,
    owner_scope_hash,
    generation,
    owner_sequence,
    subject_scope_hash,
    operation_kind,
    expires_at,
    created_at
   FROM execution_control.personal_memory_call_leases
 OFFSET 0;


--
-- Name: personal_memory_command_receipts; Type: VIEW; Schema: runtime; Owner: -
--

CREATE VIEW runtime.personal_memory_command_receipts AS
 SELECT command_id,
    owner_scope_hash,
    generation,
    sequence,
    kind,
    status,
    error_code,
    lease_expires_at,
    result_fingerprint,
    subject_scope_hash,
    supersession_scope,
    created_at,
    updated_at,
    terminal_at
   FROM execution_control.personal_memory_command_receipts
 OFFSET 0;


--
-- Name: personal_memory_owner_fences; Type: VIEW; Schema: runtime; Owner: -
--

CREATE VIEW runtime.personal_memory_owner_fences AS
 SELECT owner_scope_hash,
    generation,
    lifecycle_state,
    last_owner_sequence,
    updated_at
   FROM execution_control.personal_memory_owner_fences
 OFFSET 0;


--
-- Name: request_observability_fact; Type: TABLE; Schema: runtime; Owner: -
--

CREATE TABLE runtime.request_observability_fact (
    request_id text NOT NULL,
    safety_identifier text,
    conversation_id text NOT NULL,
    surface text NOT NULL,
    principal_type text NOT NULL,
    entitlement_snapshot_id text,
    policy_reason text,
    status text NOT NULL,
    error_code text,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    duration_ms integer,
    acl_decision text,
    acl_anomaly_code text,
    fail_closed boolean,
    stage_timing_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    model_provider text,
    model_name text,
    measured_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: account_admin_event account_admin_event_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth.account_admin_event
    ADD CONSTRAINT account_admin_event_pkey PRIMARY KEY (event_id);


--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);


--
-- Name: email_access_grant_event email_access_grant_event_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth.email_access_grant_event
    ADD CONSTRAINT email_access_grant_event_pkey PRIMARY KEY (id);


--
-- Name: email_access_grant email_access_grant_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth.email_access_grant
    ADD CONSTRAINT email_access_grant_pkey PRIMARY KEY (id);


--
-- Name: jwks jwks_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth.jwks
    ADD CONSTRAINT jwks_pkey PRIMARY KEY (id);


--
-- Name: oauthAccessToken oauthAccessToken_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."oauthAccessToken"
    ADD CONSTRAINT "oauthAccessToken_pkey" PRIMARY KEY (id);


--
-- Name: oauthClientAssertion oauthClientAssertion_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."oauthClientAssertion"
    ADD CONSTRAINT "oauthClientAssertion_pkey" PRIMARY KEY (id);


--
-- Name: oauthClientResource oauthClientResource_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."oauthClientResource"
    ADD CONSTRAINT "oauthClientResource_pkey" PRIMARY KEY (id);


--
-- Name: oauthClient oauthClient_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."oauthClient"
    ADD CONSTRAINT "oauthClient_pkey" PRIMARY KEY (id);


--
-- Name: oauthConsent oauthConsent_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."oauthConsent"
    ADD CONSTRAINT "oauthConsent_pkey" PRIMARY KEY (id);


--
-- Name: oauthRefreshToken oauthRefreshToken_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."oauthRefreshToken"
    ADD CONSTRAINT "oauthRefreshToken_pkey" PRIMARY KEY (id);


--
-- Name: oauthResource oauthResource_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."oauthResource"
    ADD CONSTRAINT "oauthResource_pkey" PRIMARY KEY (id);


--
-- Name: rateLimit rateLimit_key_unique; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."rateLimit"
    ADD CONSTRAINT "rateLimit_key_unique" UNIQUE (key);


--
-- Name: rateLimit rateLimit_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."rateLimit"
    ADD CONSTRAINT "rateLimit_pkey" PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: verification verification_pkey; Type: CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);


--
-- Name: current_index current_index_pkey; Type: CONSTRAINT; Schema: campus_docs_serving; Owner: -
--

ALTER TABLE ONLY campus_docs_serving.current_index
    ADD CONSTRAINT current_index_pkey PRIMARY KEY (singleton);


--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: campus_groups; Owner: -
--

ALTER TABLE ONLY campus_groups.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);


--
-- Name: sections sections_pkey; Type: CONSTRAINT; Schema: campus_groups; Owner: -
--

ALTER TABLE ONLY campus_groups.sections
    ADD CONSTRAINT sections_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: message_feedback message_feedback_pkey; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.message_feedback
    ADD CONSTRAINT message_feedback_pkey PRIMARY KEY (feedback_id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: turn_dispatches turn_dispatches_pkey; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.turn_dispatches
    ADD CONSTRAINT turn_dispatches_pkey PRIMARY KEY (request_id);


--
-- Name: map_draft map_draft_pkey; Type: CONSTRAINT; Schema: dining; Owner: -
--

ALTER TABLE ONLY dining.map_draft
    ADD CONSTRAINT map_draft_pkey PRIMARY KEY (scope);


--
-- Name: map_publication map_publication_pkey; Type: CONSTRAINT; Schema: dining; Owner: -
--

ALTER TABLE ONLY dining.map_publication
    ADD CONSTRAINT map_publication_pkey PRIMARY KEY (scope);


--
-- Name: map_releases map_releases_pkey; Type: CONSTRAINT; Schema: dining; Owner: -
--

ALTER TABLE ONLY dining.map_releases
    ADD CONSTRAINT map_releases_pkey PRIMARY KEY (release_id);


--
-- Name: menu_items menu_items_pkey; Type: CONSTRAINT; Schema: dining; Owner: -
--

ALTER TABLE ONLY dining.menu_items
    ADD CONSTRAINT menu_items_pkey PRIMARY KEY (menu_item_id);


--
-- Name: review_edits review_edits_pkey; Type: CONSTRAINT; Schema: dining; Owner: -
--

ALTER TABLE ONLY dining.review_edits
    ADD CONSTRAINT review_edits_pkey PRIMARY KEY (edit_id);


--
-- Name: review_reports review_reports_pkey; Type: CONSTRAINT; Schema: dining; Owner: -
--

ALTER TABLE ONLY dining.review_reports
    ADD CONSTRAINT review_reports_pkey PRIMARY KEY (report_id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: dining; Owner: -
--

ALTER TABLE ONLY dining.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (review_id);


--
-- Name: agent_invocation_receipts agent_invocation_receipts_pkey; Type: CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.agent_invocation_receipts
    ADD CONSTRAINT agent_invocation_receipts_pkey PRIMARY KEY (invocation_id);


--
-- Name: agent_run_cancellations agent_run_cancellations_pkey; Type: CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.agent_run_cancellations
    ADD CONSTRAINT agent_run_cancellations_pkey PRIMARY KEY (request_id);


--
-- Name: agent_run_events agent_run_events_pkey; Type: CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.agent_run_events
    ADD CONSTRAINT agent_run_events_pkey PRIMARY KEY (event_id);


--
-- Name: agent_run_steps agent_run_steps_pkey; Type: CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.agent_run_steps
    ADD CONSTRAINT agent_run_steps_pkey PRIMARY KEY (request_id, step_id);


--
-- Name: agent_runs agent_runs_pkey; Type: CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.agent_runs
    ADD CONSTRAINT agent_runs_pkey PRIMARY KEY (request_id);


--
-- Name: agent_runs agent_runs_request_id_key; Type: CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.agent_runs
    ADD CONSTRAINT agent_runs_request_id_key UNIQUE (request_id);


--
-- Name: agent_step_attempts agent_step_attempts_pkey; Type: CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.agent_step_attempts
    ADD CONSTRAINT agent_step_attempts_pkey PRIMARY KEY (attempt_id);


--
-- Name: agent_step_attempts agent_step_attempts_request_id_step_id_attempt_key; Type: CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.agent_step_attempts
    ADD CONSTRAINT agent_step_attempts_request_id_step_id_attempt_key UNIQUE (request_id, step_id, attempt);


--
-- Name: agent_step_results agent_step_results_pkey; Type: CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.agent_step_results
    ADD CONSTRAINT agent_step_results_pkey PRIMARY KEY (result_id);


--
-- Name: agent_workflow_starts agent_workflow_starts_pkey; Type: CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.agent_workflow_starts
    ADD CONSTRAINT agent_workflow_starts_pkey PRIMARY KEY (request_id);


--
-- Name: agent_workflow_starts agent_workflow_starts_workflow_id_key; Type: CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.agent_workflow_starts
    ADD CONSTRAINT agent_workflow_starts_workflow_id_key UNIQUE (workflow_id);


--
-- Name: conversation_run_locks conversation_run_locks_pkey; Type: CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.conversation_run_locks
    ADD CONSTRAINT conversation_run_locks_pkey PRIMARY KEY (conversation_id);


--
-- Name: owner_deletion_fences owner_deletion_fences_pkey; Type: CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.owner_deletion_fences
    ADD CONSTRAINT owner_deletion_fences_pkey PRIMARY KEY (owner_user_id);


--
-- Name: personal_memory_call_leases personal_memory_call_leases_pkey; Type: CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.personal_memory_call_leases
    ADD CONSTRAINT personal_memory_call_leases_pkey PRIMARY KEY (call_id);


--
-- Name: personal_memory_command_receipts personal_memory_command_receipts_owner_scope_hash_sequence_key; Type: CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.personal_memory_command_receipts
    ADD CONSTRAINT personal_memory_command_receipts_owner_scope_hash_sequence_key UNIQUE (owner_scope_hash, sequence);


--
-- Name: personal_memory_command_receipts personal_memory_command_receipts_pkey; Type: CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.personal_memory_command_receipts
    ADD CONSTRAINT personal_memory_command_receipts_pkey PRIMARY KEY (command_id);


--
-- Name: personal_memory_owner_fences personal_memory_owner_fences_pkey; Type: CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.personal_memory_owner_fences
    ADD CONSTRAINT personal_memory_owner_fences_pkey PRIMARY KEY (owner_scope_hash);


--
-- Name: automation_tokens automation_tokens_pkey; Type: CONSTRAINT; Schema: internal_portal; Owner: -
--

ALTER TABLE ONLY internal_portal.automation_tokens
    ADD CONSTRAINT automation_tokens_pkey PRIMARY KEY (token_id);


--
-- Name: credentials credentials_pkey; Type: CONSTRAINT; Schema: internal_portal; Owner: -
--

ALTER TABLE ONLY internal_portal.credentials
    ADD CONSTRAINT credentials_pkey PRIMARY KEY (credential_id);


--
-- Name: model_configs model_configs_pkey; Type: CONSTRAINT; Schema: model_config; Owner: -
--

ALTER TABLE ONLY model_config.model_configs
    ADD CONSTRAINT model_configs_pkey PRIMARY KEY (name);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: notices; Owner: -
--

ALTER TABLE ONLY notices.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (category);


--
-- Name: notice_assets notice_assets_pkey; Type: CONSTRAINT; Schema: notices; Owner: -
--

ALTER TABLE ONLY notices.notice_assets
    ADD CONSTRAINT notice_assets_pkey PRIMARY KEY (notice_id, asset_kind, ordinal);


--
-- Name: notice_types notice_types_pkey; Type: CONSTRAINT; Schema: notices; Owner: -
--

ALTER TABLE ONLY notices.notice_types
    ADD CONSTRAINT notice_types_pkey PRIMARY KEY (notice_type);


--
-- Name: notices notices_pkey; Type: CONSTRAINT; Schema: notices; Owner: -
--

ALTER TABLE ONLY notices.notices
    ADD CONSTRAINT notices_pkey PRIMARY KEY (notice_id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: notices; Owner: -
--

ALTER TABLE ONLY notices.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (organization_id);


--
-- Name: account_deletion_requests account_deletion_requests_pkey; Type: CONSTRAINT; Schema: profile; Owner: -
--

ALTER TABLE ONLY profile.account_deletion_requests
    ADD CONSTRAINT account_deletion_requests_pkey PRIMARY KEY (request_id);


--
-- Name: memory_command_sources memory_command_sources_command_id_source_message_id_pk; Type: CONSTRAINT; Schema: profile; Owner: -
--

ALTER TABLE ONLY profile.memory_command_sources
    ADD CONSTRAINT memory_command_sources_command_id_source_message_id_pk PRIMARY KEY (command_id, source_message_id);


--
-- Name: memory_commands memory_commands_pkey; Type: CONSTRAINT; Schema: profile; Owner: -
--

ALTER TABLE ONLY profile.memory_commands
    ADD CONSTRAINT memory_commands_pkey PRIMARY KEY (command_id);


--
-- Name: memory_items memory_items_pkey; Type: CONSTRAINT; Schema: profile; Owner: -
--

ALTER TABLE ONLY profile.memory_items
    ADD CONSTRAINT memory_items_pkey PRIMARY KEY (item_id);


--
-- Name: memory_settings memory_settings_pkey; Type: CONSTRAINT; Schema: profile; Owner: -
--

ALTER TABLE ONLY profile.memory_settings
    ADD CONSTRAINT memory_settings_pkey PRIMARY KEY (owner_user_id);


--
-- Name: request_observability_fact request_observability_fact_pkey; Type: CONSTRAINT; Schema: runtime; Owner: -
--

ALTER TABLE ONLY runtime.request_observability_fact
    ADD CONSTRAINT request_observability_fact_pkey PRIMARY KEY (request_id);


--
-- Name: account_admin_event_action_occurred_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX account_admin_event_action_occurred_idx ON app_auth.account_admin_event USING btree (action, occurred_at);


--
-- Name: account_admin_event_actor_idempotency_uidx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE UNIQUE INDEX account_admin_event_actor_idempotency_uidx ON app_auth.account_admin_event USING btree (actor_id, idempotency_key);


--
-- Name: account_admin_event_actor_occurred_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX account_admin_event_actor_occurred_idx ON app_auth.account_admin_event USING btree (actor_id, occurred_at);


--
-- Name: account_admin_event_occurred_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX account_admin_event_occurred_idx ON app_auth.account_admin_event USING btree (occurred_at, event_id);


--
-- Name: account_admin_event_outcome_occurred_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX account_admin_event_outcome_occurred_idx ON app_auth.account_admin_event USING btree (outcome, occurred_at);


--
-- Name: account_admin_event_target_occurred_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX account_admin_event_target_occurred_idx ON app_auth.account_admin_event USING btree (target_user_id, occurred_at);


--
-- Name: account_issuer_accountId_uidx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON app_auth.account USING btree (issuer, "accountId");


--
-- Name: account_userId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "account_userId_idx" ON app_auth.account USING btree ("userId");


--
-- Name: email_access_grant_environment_state_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX email_access_grant_environment_state_idx ON app_auth.email_access_grant USING btree (environment, state, updated_at);


--
-- Name: email_access_grant_event_grant_occurred_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX email_access_grant_event_grant_occurred_idx ON app_auth.email_access_grant_event USING btree (grant_id, occurred_at);


--
-- Name: email_access_grant_event_idempotency_uidx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE UNIQUE INDEX email_access_grant_event_idempotency_uidx ON app_auth.email_access_grant_event USING btree (actor_id, idempotency_key);


--
-- Name: email_access_grant_live_email_uidx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE UNIQUE INDEX email_access_grant_live_email_uidx ON app_auth.email_access_grant USING btree (environment, email) WHERE (state = ANY (ARRAY['pending'::text, 'active'::text]));


--
-- Name: email_access_grant_user_id_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX email_access_grant_user_id_idx ON app_auth.email_access_grant USING btree (user_id);


--
-- Name: oauthAccessToken_authorizationCodeId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthAccessToken_authorizationCodeId_idx" ON app_auth."oauthAccessToken" USING btree ("authorizationCodeId");


--
-- Name: oauthAccessToken_clientId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthAccessToken_clientId_idx" ON app_auth."oauthAccessToken" USING btree ("clientId");


--
-- Name: oauthAccessToken_refreshId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthAccessToken_refreshId_idx" ON app_auth."oauthAccessToken" USING btree ("refreshId");


--
-- Name: oauthAccessToken_sessionId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthAccessToken_sessionId_idx" ON app_auth."oauthAccessToken" USING btree ("sessionId");


--
-- Name: oauthAccessToken_token_uidx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE UNIQUE INDEX "oauthAccessToken_token_uidx" ON app_auth."oauthAccessToken" USING btree (token);


--
-- Name: oauthAccessToken_userId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthAccessToken_userId_idx" ON app_auth."oauthAccessToken" USING btree ("userId");


--
-- Name: oauthClientResource_clientId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthClientResource_clientId_idx" ON app_auth."oauthClientResource" USING btree ("clientId");


--
-- Name: oauthClientResource_clientId_resourceId_uidx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE UNIQUE INDEX "oauthClientResource_clientId_resourceId_uidx" ON app_auth."oauthClientResource" USING btree ("clientId", "resourceId");


--
-- Name: oauthClientResource_resourceId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthClientResource_resourceId_idx" ON app_auth."oauthClientResource" USING btree ("resourceId");


--
-- Name: oauthClient_clientId_uidx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE UNIQUE INDEX "oauthClient_clientId_uidx" ON app_auth."oauthClient" USING btree ("clientId");


--
-- Name: oauthClient_userId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthClient_userId_idx" ON app_auth."oauthClient" USING btree ("userId");


--
-- Name: oauthConsent_clientId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthConsent_clientId_idx" ON app_auth."oauthConsent" USING btree ("clientId");


--
-- Name: oauthConsent_userId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthConsent_userId_idx" ON app_auth."oauthConsent" USING btree ("userId");


--
-- Name: oauthRefreshToken_authorizationCodeId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthRefreshToken_authorizationCodeId_idx" ON app_auth."oauthRefreshToken" USING btree ("authorizationCodeId");


--
-- Name: oauthRefreshToken_clientId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthRefreshToken_clientId_idx" ON app_auth."oauthRefreshToken" USING btree ("clientId");


--
-- Name: oauthRefreshToken_sessionId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthRefreshToken_sessionId_idx" ON app_auth."oauthRefreshToken" USING btree ("sessionId");


--
-- Name: oauthRefreshToken_token_uidx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE UNIQUE INDEX "oauthRefreshToken_token_uidx" ON app_auth."oauthRefreshToken" USING btree (token);


--
-- Name: oauthRefreshToken_userId_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX "oauthRefreshToken_userId_idx" ON app_auth."oauthRefreshToken" USING btree ("userId");


--
-- Name: oauthResource_identifier_uidx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE UNIQUE INDEX "oauthResource_identifier_uidx" ON app_auth."oauthResource" USING btree (identifier);


--
-- Name: session_token_uidx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE UNIQUE INDEX session_token_uidx ON app_auth.session USING btree (token);


--
-- Name: session_user_id_expires_at_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX session_user_id_expires_at_idx ON app_auth.session USING btree ("userId", "expiresAt");


--
-- Name: user_banned_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX user_banned_idx ON app_auth."user" USING btree (banned);


--
-- Name: user_created_at_id_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX user_created_at_id_idx ON app_auth."user" USING btree ("createdAt" DESC NULLS LAST, id DESC NULLS LAST);


--
-- Name: user_email_prefix_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX user_email_prefix_idx ON app_auth."user" USING btree (lower(email) text_pattern_ops);


--
-- Name: user_email_uidx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE UNIQUE INDEX user_email_uidx ON app_auth."user" USING btree (email);


--
-- Name: user_name_prefix_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX user_name_prefix_idx ON app_auth."user" USING btree (lower(name) text_pattern_ops);


--
-- Name: verification_identifier_idx; Type: INDEX; Schema: app_auth; Owner: -
--

CREATE INDEX verification_identifier_idx ON app_auth.verification USING btree (identifier);


--
-- Name: campus_groups_groups_qq_group_number_uidx; Type: INDEX; Schema: campus_groups; Owner: -
--

CREATE UNIQUE INDEX campus_groups_groups_qq_group_number_uidx ON campus_groups.groups USING btree (qq_group_number);


--
-- Name: campus_groups_groups_section_position_uidx; Type: INDEX; Schema: campus_groups; Owner: -
--

CREATE UNIQUE INDEX campus_groups_groups_section_position_uidx ON campus_groups.groups USING btree (section_id, "position");


--
-- Name: campus_groups_sections_name_uidx; Type: INDEX; Schema: campus_groups; Owner: -
--

CREATE UNIQUE INDEX campus_groups_sections_name_uidx ON campus_groups.sections USING btree (name);


--
-- Name: campus_groups_sections_position_uidx; Type: INDEX; Schema: campus_groups; Owner: -
--

CREATE UNIQUE INDEX campus_groups_sections_position_uidx ON campus_groups.sections USING btree ("position");


--
-- Name: chat_conversations_owner_archived_updated_at_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX chat_conversations_owner_archived_updated_at_idx ON chat.conversations USING btree (owner_user_id, archived_at, updated_at);


--
-- Name: chat_conversations_owner_deleted_updated_at_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX chat_conversations_owner_deleted_updated_at_idx ON chat.conversations USING btree (owner_user_id, deleted_at, updated_at);


--
-- Name: chat_conversations_owner_pinned_updated_at_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX chat_conversations_owner_pinned_updated_at_idx ON chat.conversations USING btree (owner_user_id, pinned_at, updated_at);


--
-- Name: chat_conversations_owner_updated_at_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX chat_conversations_owner_updated_at_idx ON chat.conversations USING btree (owner_user_id, updated_at);


--
-- Name: chat_message_feedback_owner_message_uidx; Type: INDEX; Schema: chat; Owner: -
--

CREATE UNIQUE INDEX chat_message_feedback_owner_message_uidx ON chat.message_feedback USING btree (owner_user_id, message_id);


--
-- Name: chat_message_feedback_request_id_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX chat_message_feedback_request_id_idx ON chat.message_feedback USING btree (request_id);


--
-- Name: chat_message_feedback_updated_at_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX chat_message_feedback_updated_at_idx ON chat.message_feedback USING btree (updated_at);


--
-- Name: chat_messages_conversation_branch_sequence_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX chat_messages_conversation_branch_sequence_idx ON chat.messages USING btree (conversation_id, branch_id, turn_sequence);


--
-- Name: chat_messages_conversation_created_at_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX chat_messages_conversation_created_at_idx ON chat.messages USING btree (conversation_id, created_at);


--
-- Name: chat_messages_request_id_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX chat_messages_request_id_idx ON chat.messages USING btree (request_id);


--
-- Name: chat_session_slots_conversation_name_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX chat_session_slots_conversation_name_idx ON chat.session_slots USING btree (conversation_id, name);


--
-- Name: chat_turn_dispatches_actor_idempotency_uidx; Type: INDEX; Schema: chat; Owner: -
--

CREATE UNIQUE INDEX chat_turn_dispatches_actor_idempotency_uidx ON chat.turn_dispatches USING btree (actor_user_id, idempotency_key);


--
-- Name: chat_turn_dispatches_conversation_turn_sequence_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX chat_turn_dispatches_conversation_turn_sequence_idx ON chat.turn_dispatches USING btree (conversation_id, turn_sequence);


--
-- Name: chat_turn_dispatches_created_at_request_id_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX chat_turn_dispatches_created_at_request_id_idx ON chat.turn_dispatches USING btree (created_at DESC, request_id DESC);


--
-- Name: chat_turn_dispatches_safety_identifier_created_at_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX chat_turn_dispatches_safety_identifier_created_at_idx ON chat.turn_dispatches USING btree (safety_identifier, created_at);


--
-- Name: chat_turn_dispatches_status_created_at_idx; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX chat_turn_dispatches_status_created_at_idx ON chat.turn_dispatches USING btree (status, created_at);


--
-- Name: dining_map_releases_created_idx; Type: INDEX; Schema: dining; Owner: -
--

CREATE INDEX dining_map_releases_created_idx ON dining.map_releases USING btree (created_at DESC NULLS LAST, release_id DESC NULLS LAST);


--
-- Name: dining_menu_items_window_sort_idx; Type: INDEX; Schema: dining; Owner: -
--

CREATE INDEX dining_menu_items_window_sort_idx ON dining.menu_items USING btree (window_id, archived_at, sort_order, menu_item_id);


--
-- Name: dining_review_edits_review_idx; Type: INDEX; Schema: dining; Owner: -
--

CREATE INDEX dining_review_edits_review_idx ON dining.review_edits USING btree (review_id, edited_at, edit_id);


--
-- Name: dining_review_reports_pending_idx; Type: INDEX; Schema: dining; Owner: -
--

CREATE INDEX dining_review_reports_pending_idx ON dining.review_reports USING btree (resolved_at, created_at, report_id);


--
-- Name: dining_review_reports_reporter_uidx; Type: INDEX; Schema: dining; Owner: -
--

CREATE UNIQUE INDEX dining_review_reports_reporter_uidx ON dining.review_reports USING btree (review_id, reporter_user_id);


--
-- Name: dining_reviews_idempotency_uidx; Type: INDEX; Schema: dining; Owner: -
--

CREATE UNIQUE INDEX dining_reviews_idempotency_uidx ON dining.reviews USING btree (author_kind, author_id, idempotency_key);


--
-- Name: dining_reviews_member_limit_idx; Type: INDEX; Schema: dining; Owner: -
--

CREATE INDEX dining_reviews_member_limit_idx ON dining.reviews USING btree (author_kind, author_id, menu_item_id, submission_date);


--
-- Name: dining_reviews_menu_created_idx; Type: INDEX; Schema: dining; Owner: -
--

CREATE INDEX dining_reviews_menu_created_idx ON dining.reviews USING btree (menu_item_id, created_at DESC NULLS LAST, review_id DESC NULLS LAST);


--
-- Name: agent_invocation_receipts_request_idx; Type: INDEX; Schema: execution_control; Owner: -
--

CREATE INDEX agent_invocation_receipts_request_idx ON execution_control.agent_invocation_receipts USING btree (request_id, created_at);


--
-- Name: agent_run_cancellations_lease_idx; Type: INDEX; Schema: execution_control; Owner: -
--

CREATE INDEX agent_run_cancellations_lease_idx ON execution_control.agent_run_cancellations USING btree (state, next_attempt_at, lease_until);


--
-- Name: agent_run_events_conversation_occurred_idx; Type: INDEX; Schema: execution_control; Owner: -
--

CREATE INDEX agent_run_events_conversation_occurred_idx ON execution_control.agent_run_events USING btree (conversation_id, occurred_at DESC);


--
-- Name: agent_run_events_request_occurred_idx; Type: INDEX; Schema: execution_control; Owner: -
--

CREATE INDEX agent_run_events_request_occurred_idx ON execution_control.agent_run_events USING btree (request_id, occurred_at);


--
-- Name: agent_run_events_request_sequence_idx; Type: INDEX; Schema: execution_control; Owner: -
--

CREATE UNIQUE INDEX agent_run_events_request_sequence_idx ON execution_control.agent_run_events USING btree (request_id, sequence);


--
-- Name: agent_run_events_type_occurred_idx; Type: INDEX; Schema: execution_control; Owner: -
--

CREATE INDEX agent_run_events_type_occurred_idx ON execution_control.agent_run_events USING btree (event_type, occurred_at DESC);


--
-- Name: agent_run_steps_request_updated_idx; Type: INDEX; Schema: execution_control; Owner: -
--

CREATE INDEX agent_run_steps_request_updated_idx ON execution_control.agent_run_steps USING btree (request_id, updated_at);


--
-- Name: agent_runs_active_conversation_idx; Type: INDEX; Schema: execution_control; Owner: -
--

CREATE UNIQUE INDEX agent_runs_active_conversation_idx ON execution_control.agent_runs USING btree (conversation_id) WHERE (status = ANY (ARRAY['created'::text, 'queued'::text, 'admitted'::text, 'running'::text, 'streaming'::text]));


--
-- Name: agent_runs_status_task_queue_created_idx; Type: INDEX; Schema: execution_control; Owner: -
--

CREATE INDEX agent_runs_status_task_queue_created_idx ON execution_control.agent_runs USING btree (status, task_queue, created_at);


--
-- Name: agent_step_results_request_step_idx; Type: INDEX; Schema: execution_control; Owner: -
--

CREATE INDEX agent_step_results_request_step_idx ON execution_control.agent_step_results USING btree (request_id, step_id, created_at);


--
-- Name: agent_workflow_starts_lease_idx; Type: INDEX; Schema: execution_control; Owner: -
--

CREATE INDEX agent_workflow_starts_lease_idx ON execution_control.agent_workflow_starts USING btree (state, next_attempt_at, lease_until);


--
-- Name: owner_deletion_fences_state_idx; Type: INDEX; Schema: execution_control; Owner: -
--

CREATE INDEX owner_deletion_fences_state_idx ON execution_control.owner_deletion_fences USING btree (state, started_at);


--
-- Name: internal_portal_credentials_name_uidx; Type: INDEX; Schema: internal_portal; Owner: -
--

CREATE UNIQUE INDEX internal_portal_credentials_name_uidx ON internal_portal.credentials USING btree (name);


--
-- Name: notices_category_released_idx; Type: INDEX; Schema: notices; Owner: -
--

CREATE INDEX notices_category_released_idx ON notices.notices USING btree (category, released_at DESC, notice_id DESC);


--
-- Name: notices_organization_released_idx; Type: INDEX; Schema: notices; Owner: -
--

CREATE INDEX notices_organization_released_idx ON notices.notices USING btree (organization_id, released_at DESC, notice_id DESC);


--
-- Name: notices_released_idx; Type: INDEX; Schema: notices; Owner: -
--

CREATE INDEX notices_released_idx ON notices.notices USING btree (released_at DESC, notice_id DESC);


--
-- Name: notices_type_released_idx; Type: INDEX; Schema: notices; Owner: -
--

CREATE INDEX notices_type_released_idx ON notices.notices USING btree (notice_type, released_at DESC, notice_id DESC);


--
-- Name: profile_account_deletion_owner_uidx; Type: INDEX; Schema: profile; Owner: -
--

CREATE UNIQUE INDEX profile_account_deletion_owner_uidx ON profile.account_deletion_requests USING btree (owner_user_id);


--
-- Name: profile_account_deletion_pending_lease_idx; Type: INDEX; Schema: profile; Owner: -
--

CREATE INDEX profile_account_deletion_pending_lease_idx ON profile.account_deletion_requests USING btree (status, next_attempt_at, lease_expires_at);


--
-- Name: profile_memory_commands_owner_generation_scope_sequence_idx; Type: INDEX; Schema: profile; Owner: -
--

CREATE INDEX profile_memory_commands_owner_generation_scope_sequence_idx ON profile.memory_commands USING btree (owner_user_id, owner_generation, supersession_scope, owner_sequence);


--
-- Name: profile_memory_commands_owner_idempotency_uidx; Type: INDEX; Schema: profile; Owner: -
--

CREATE UNIQUE INDEX profile_memory_commands_owner_idempotency_uidx ON profile.memory_commands USING btree (owner_user_id, idempotency_key_hash);


--
-- Name: profile_memory_commands_owner_sequence_uidx; Type: INDEX; Schema: profile; Owner: -
--

CREATE UNIQUE INDEX profile_memory_commands_owner_sequence_uidx ON profile.memory_commands USING btree (owner_user_id, owner_sequence);


--
-- Name: profile_memory_commands_owner_status_sequence_idx; Type: INDEX; Schema: profile; Owner: -
--

CREATE INDEX profile_memory_commands_owner_status_sequence_idx ON profile.memory_commands USING btree (owner_user_id, status, owner_sequence);


--
-- Name: profile_memory_commands_status_created_idx; Type: INDEX; Schema: profile; Owner: -
--

CREATE INDEX profile_memory_commands_status_created_idx ON profile.memory_commands USING btree (status, created_at);


--
-- Name: profile_memory_items_owner_key_uidx; Type: INDEX; Schema: profile; Owner: -
--

CREATE UNIQUE INDEX profile_memory_items_owner_key_uidx ON profile.memory_items USING btree (owner_user_id, key);


--
-- Name: profile_memory_items_owner_updated_at_idx; Type: INDEX; Schema: profile; Owner: -
--

CREATE INDEX profile_memory_items_owner_updated_at_idx ON profile.memory_items USING btree (owner_user_id, updated_at);


--
-- Name: runtime_request_observability_model_name_started_at_idx; Type: INDEX; Schema: runtime; Owner: -
--

CREATE INDEX runtime_request_observability_model_name_started_at_idx ON runtime.request_observability_fact USING btree (model_name, started_at);


--
-- Name: runtime_request_observability_principal_type_started_at_idx; Type: INDEX; Schema: runtime; Owner: -
--

CREATE INDEX runtime_request_observability_principal_type_started_at_idx ON runtime.request_observability_fact USING btree (principal_type, started_at);


--
-- Name: runtime_request_observability_safety_identifier_started_at_idx; Type: INDEX; Schema: runtime; Owner: -
--

CREATE INDEX runtime_request_observability_safety_identifier_started_at_idx ON runtime.request_observability_fact USING btree (safety_identifier, started_at);


--
-- Name: runtime_request_observability_started_at_idx; Type: INDEX; Schema: runtime; Owner: -
--

CREATE INDEX runtime_request_observability_started_at_idx ON runtime.request_observability_fact USING btree (started_at);


--
-- Name: runtime_request_observability_status_started_at_idx; Type: INDEX; Schema: runtime; Owner: -
--

CREATE INDEX runtime_request_observability_status_started_at_idx ON runtime.request_observability_fact USING btree (status, started_at);


--
-- Name: runtime_request_observability_surface_started_at_idx; Type: INDEX; Schema: runtime; Owner: -
--

CREATE INDEX runtime_request_observability_surface_started_at_idx ON runtime.request_observability_fact USING btree (surface, started_at);


--
-- Name: account_admin_event account_admin_event_target_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth.account_admin_event
    ADD CONSTRAINT account_admin_event_target_user_id_user_id_fk FOREIGN KEY (target_user_id) REFERENCES app_auth."user"(id) ON DELETE SET NULL;


--
-- Name: account account_userId_user_id_fk; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth.account
    ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES app_auth."user"(id) ON DELETE CASCADE;


--
-- Name: email_access_grant_event email_access_grant_event_grant_id_email_access_grant_id_fk; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth.email_access_grant_event
    ADD CONSTRAINT email_access_grant_event_grant_id_email_access_grant_id_fk FOREIGN KEY (grant_id) REFERENCES app_auth.email_access_grant(id) ON DELETE CASCADE;


--
-- Name: email_access_grant email_access_grant_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth.email_access_grant
    ADD CONSTRAINT email_access_grant_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES app_auth."user"(id) ON DELETE CASCADE;


--
-- Name: oauthAccessToken oauthAccessToken_clientId_oauthClient_clientId_fk; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."oauthAccessToken"
    ADD CONSTRAINT "oauthAccessToken_clientId_oauthClient_clientId_fk" FOREIGN KEY ("clientId") REFERENCES app_auth."oauthClient"("clientId") ON DELETE CASCADE;


--
-- Name: oauthAccessToken oauthAccessToken_refreshId_oauthRefreshToken_id_fk; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."oauthAccessToken"
    ADD CONSTRAINT "oauthAccessToken_refreshId_oauthRefreshToken_id_fk" FOREIGN KEY ("refreshId") REFERENCES app_auth."oauthRefreshToken"(id) ON DELETE CASCADE;


--
-- Name: oauthAccessToken oauthAccessToken_sessionId_session_id_fk; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."oauthAccessToken"
    ADD CONSTRAINT "oauthAccessToken_sessionId_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES app_auth.session(id) ON DELETE SET NULL;


--
-- Name: oauthAccessToken oauthAccessToken_userId_user_id_fk; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."oauthAccessToken"
    ADD CONSTRAINT "oauthAccessToken_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES app_auth."user"(id) ON DELETE CASCADE;


--
-- Name: oauthClientResource oauthClientResource_clientId_oauthClient_clientId_fk; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."oauthClientResource"
    ADD CONSTRAINT "oauthClientResource_clientId_oauthClient_clientId_fk" FOREIGN KEY ("clientId") REFERENCES app_auth."oauthClient"("clientId") ON DELETE CASCADE;


--
-- Name: oauthClientResource oauthClientResource_resourceId_oauthResource_identifier_fk; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."oauthClientResource"
    ADD CONSTRAINT "oauthClientResource_resourceId_oauthResource_identifier_fk" FOREIGN KEY ("resourceId") REFERENCES app_auth."oauthResource"(identifier) ON DELETE CASCADE;


--
-- Name: oauthClient oauthClient_userId_user_id_fk; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."oauthClient"
    ADD CONSTRAINT "oauthClient_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES app_auth."user"(id) ON DELETE CASCADE;


--
-- Name: oauthConsent oauthConsent_clientId_oauthClient_clientId_fk; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."oauthConsent"
    ADD CONSTRAINT "oauthConsent_clientId_oauthClient_clientId_fk" FOREIGN KEY ("clientId") REFERENCES app_auth."oauthClient"("clientId") ON DELETE CASCADE;


--
-- Name: oauthConsent oauthConsent_userId_user_id_fk; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."oauthConsent"
    ADD CONSTRAINT "oauthConsent_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES app_auth."user"(id) ON DELETE CASCADE;


--
-- Name: oauthRefreshToken oauthRefreshToken_clientId_oauthClient_clientId_fk; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."oauthRefreshToken"
    ADD CONSTRAINT "oauthRefreshToken_clientId_oauthClient_clientId_fk" FOREIGN KEY ("clientId") REFERENCES app_auth."oauthClient"("clientId") ON DELETE CASCADE;


--
-- Name: oauthRefreshToken oauthRefreshToken_sessionId_session_id_fk; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."oauthRefreshToken"
    ADD CONSTRAINT "oauthRefreshToken_sessionId_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES app_auth.session(id) ON DELETE SET NULL;


--
-- Name: oauthRefreshToken oauthRefreshToken_userId_user_id_fk; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth."oauthRefreshToken"
    ADD CONSTRAINT "oauthRefreshToken_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES app_auth."user"(id) ON DELETE CASCADE;


--
-- Name: session session_userId_user_id_fk; Type: FK CONSTRAINT; Schema: app_auth; Owner: -
--

ALTER TABLE ONLY app_auth.session
    ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES app_auth."user"(id) ON DELETE CASCADE;


--
-- Name: groups groups_section_id_sections_id_fk; Type: FK CONSTRAINT; Schema: campus_groups; Owner: -
--

ALTER TABLE ONLY campus_groups.groups
    ADD CONSTRAINT groups_section_id_sections_id_fk FOREIGN KEY (section_id) REFERENCES campus_groups.sections(id) ON DELETE CASCADE;


--
-- Name: message_feedback message_feedback_conversation_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.message_feedback
    ADD CONSTRAINT message_feedback_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES chat.conversations(id) ON DELETE CASCADE;


--
-- Name: message_feedback message_feedback_message_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.message_feedback
    ADD CONSTRAINT message_feedback_message_id_fkey FOREIGN KEY (message_id) REFERENCES chat.messages(id) ON DELETE CASCADE;


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES chat.conversations(id) ON DELETE CASCADE;


--
-- Name: session_slots session_slots_conversation_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.session_slots
    ADD CONSTRAINT session_slots_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES chat.conversations(id) ON DELETE CASCADE;


--
-- Name: turn_dispatches turn_dispatches_conversation_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.turn_dispatches
    ADD CONSTRAINT turn_dispatches_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES chat.conversations(id) ON DELETE CASCADE;


--
-- Name: turn_dispatches turn_dispatches_user_message_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.turn_dispatches
    ADD CONSTRAINT turn_dispatches_user_message_id_fkey FOREIGN KEY (user_message_id) REFERENCES chat.messages(id) ON DELETE CASCADE;


--
-- Name: map_releases dining_map_releases_restored_from_release_id_fkey; Type: FK CONSTRAINT; Schema: dining; Owner: -
--

ALTER TABLE ONLY dining.map_releases
    ADD CONSTRAINT dining_map_releases_restored_from_release_id_fkey FOREIGN KEY (restored_from_release_id) REFERENCES dining.map_releases(release_id);


--
-- Name: map_publication map_publication_release_id_map_releases_release_id_fk; Type: FK CONSTRAINT; Schema: dining; Owner: -
--

ALTER TABLE ONLY dining.map_publication
    ADD CONSTRAINT map_publication_release_id_map_releases_release_id_fk FOREIGN KEY (release_id) REFERENCES dining.map_releases(release_id);


--
-- Name: review_edits review_edits_review_id_reviews_review_id_fk; Type: FK CONSTRAINT; Schema: dining; Owner: -
--

ALTER TABLE ONLY dining.review_edits
    ADD CONSTRAINT review_edits_review_id_reviews_review_id_fk FOREIGN KEY (review_id) REFERENCES dining.reviews(review_id) ON DELETE CASCADE;


--
-- Name: review_reports review_reports_review_id_reviews_review_id_fk; Type: FK CONSTRAINT; Schema: dining; Owner: -
--

ALTER TABLE ONLY dining.review_reports
    ADD CONSTRAINT review_reports_review_id_reviews_review_id_fk FOREIGN KEY (review_id) REFERENCES dining.reviews(review_id) ON DELETE CASCADE;


--
-- Name: reviews reviews_menu_item_id_menu_items_menu_item_id_fk; Type: FK CONSTRAINT; Schema: dining; Owner: -
--

ALTER TABLE ONLY dining.reviews
    ADD CONSTRAINT reviews_menu_item_id_menu_items_menu_item_id_fk FOREIGN KEY (menu_item_id) REFERENCES dining.menu_items(menu_item_id) ON DELETE RESTRICT;


--
-- Name: agent_invocation_receipts agent_invocation_receipts_request_id_fkey; Type: FK CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.agent_invocation_receipts
    ADD CONSTRAINT agent_invocation_receipts_request_id_fkey FOREIGN KEY (request_id) REFERENCES execution_control.agent_runs(request_id) ON DELETE CASCADE;


--
-- Name: agent_run_cancellations agent_run_cancellations_request_id_fkey; Type: FK CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.agent_run_cancellations
    ADD CONSTRAINT agent_run_cancellations_request_id_fkey FOREIGN KEY (request_id) REFERENCES execution_control.agent_runs(request_id) ON DELETE CASCADE;


--
-- Name: agent_run_events agent_run_events_request_id_fkey; Type: FK CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.agent_run_events
    ADD CONSTRAINT agent_run_events_request_id_fkey FOREIGN KEY (request_id) REFERENCES execution_control.agent_runs(request_id) ON DELETE CASCADE;


--
-- Name: agent_run_steps agent_run_steps_request_id_fkey; Type: FK CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.agent_run_steps
    ADD CONSTRAINT agent_run_steps_request_id_fkey FOREIGN KEY (request_id) REFERENCES execution_control.agent_runs(request_id) ON DELETE CASCADE;


--
-- Name: agent_step_attempts agent_step_attempts_request_id_fkey; Type: FK CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.agent_step_attempts
    ADD CONSTRAINT agent_step_attempts_request_id_fkey FOREIGN KEY (request_id) REFERENCES execution_control.agent_runs(request_id) ON DELETE CASCADE;


--
-- Name: agent_step_results agent_step_results_request_id_fkey; Type: FK CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.agent_step_results
    ADD CONSTRAINT agent_step_results_request_id_fkey FOREIGN KEY (request_id) REFERENCES execution_control.agent_runs(request_id) ON DELETE CASCADE;


--
-- Name: agent_workflow_starts agent_workflow_starts_request_id_fkey; Type: FK CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.agent_workflow_starts
    ADD CONSTRAINT agent_workflow_starts_request_id_fkey FOREIGN KEY (request_id) REFERENCES execution_control.agent_runs(request_id) ON DELETE CASCADE;


--
-- Name: conversation_run_locks conversation_run_locks_request_id_fkey; Type: FK CONSTRAINT; Schema: execution_control; Owner: -
--

ALTER TABLE ONLY execution_control.conversation_run_locks
    ADD CONSTRAINT conversation_run_locks_request_id_fkey FOREIGN KEY (request_id) REFERENCES execution_control.agent_runs(request_id) ON DELETE CASCADE;


--
-- Name: notice_assets notice_assets_notice_id_fkey; Type: FK CONSTRAINT; Schema: notices; Owner: -
--

ALTER TABLE ONLY notices.notice_assets
    ADD CONSTRAINT notice_assets_notice_id_fkey FOREIGN KEY (notice_id) REFERENCES notices.notices(notice_id) ON DELETE CASCADE;


--
-- Name: notices notices_category_fkey; Type: FK CONSTRAINT; Schema: notices; Owner: -
--

ALTER TABLE ONLY notices.notices
    ADD CONSTRAINT notices_category_fkey FOREIGN KEY (category) REFERENCES notices.categories(category);


--
-- Name: notices notices_notice_type_fkey; Type: FK CONSTRAINT; Schema: notices; Owner: -
--

ALTER TABLE ONLY notices.notices
    ADD CONSTRAINT notices_notice_type_fkey FOREIGN KEY (notice_type) REFERENCES notices.notice_types(notice_type);


--
-- Name: notices notices_organization_id_fkey; Type: FK CONSTRAINT; Schema: notices; Owner: -
--

ALTER TABLE ONLY notices.notices
    ADD CONSTRAINT notices_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES notices.organizations(organization_id);


--
-- Name: memory_command_sources memory_command_sources_command_id_memory_commands_command_id_fk; Type: FK CONSTRAINT; Schema: profile; Owner: -
--

ALTER TABLE ONLY profile.memory_command_sources
    ADD CONSTRAINT memory_command_sources_command_id_memory_commands_command_id_fk FOREIGN KEY (command_id) REFERENCES profile.memory_commands(command_id) ON DELETE CASCADE;


--
-- Name: SCHEMA app_auth; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA app_auth TO app_api;


--
-- Name: SCHEMA campus_docs_serving; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA campus_docs_serving TO execution_control;


--
-- Name: SCHEMA campus_groups; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA campus_groups TO app_api;


--
-- Name: SCHEMA chat; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA chat TO app_api;
GRANT USAGE ON SCHEMA chat TO ops_web;


--
-- Name: SCHEMA dining; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA dining TO ops_web;
GRANT USAGE ON SCHEMA dining TO app_api;


--
-- Name: SCHEMA execution_control; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA execution_control TO execution_control;
GRANT USAGE ON SCHEMA execution_control TO ops_web;


--
-- Name: SCHEMA internal_portal; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA internal_portal TO ops_web;


--
-- Name: SCHEMA model_config; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA model_config TO model_config;


--
-- Name: SCHEMA notices; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA notices TO app_api;
GRANT USAGE ON SCHEMA notices TO ops_web;
DO $campus_agent_optional_notice_publisher$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notice_publisher') THEN
        EXECUTE 'GRANT USAGE ON SCHEMA notices TO notice_publisher';
    END IF;
END
$campus_agent_optional_notice_publisher$;


--
-- Name: SCHEMA profile; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA profile TO app_api;


--
-- Name: SCHEMA runtime; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA runtime TO app_api;
GRANT USAGE ON SCHEMA runtime TO execution_control;
GRANT USAGE ON SCHEMA runtime TO ops_web;


--
-- Name: TABLE account; Type: ACL; Schema: app_auth; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app_auth.account TO app_api;


--
-- Name: TABLE account_admin_event; Type: ACL; Schema: app_auth; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app_auth.account_admin_event TO app_api;


--
-- Name: TABLE email_access_grant; Type: ACL; Schema: app_auth; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app_auth.email_access_grant TO app_api;


--
-- Name: TABLE email_access_grant_event; Type: ACL; Schema: app_auth; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app_auth.email_access_grant_event TO app_api;


--
-- Name: TABLE jwks; Type: ACL; Schema: app_auth; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app_auth.jwks TO app_api;


--
-- Name: TABLE "oauthAccessToken"; Type: ACL; Schema: app_auth; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app_auth."oauthAccessToken" TO app_api;


--
-- Name: TABLE "oauthClient"; Type: ACL; Schema: app_auth; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app_auth."oauthClient" TO app_api;


--
-- Name: TABLE "oauthClientAssertion"; Type: ACL; Schema: app_auth; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app_auth."oauthClientAssertion" TO app_api;


--
-- Name: TABLE "oauthClientResource"; Type: ACL; Schema: app_auth; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app_auth."oauthClientResource" TO app_api;


--
-- Name: TABLE "oauthConsent"; Type: ACL; Schema: app_auth; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app_auth."oauthConsent" TO app_api;


--
-- Name: TABLE "oauthRefreshToken"; Type: ACL; Schema: app_auth; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app_auth."oauthRefreshToken" TO app_api;


--
-- Name: TABLE "oauthResource"; Type: ACL; Schema: app_auth; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app_auth."oauthResource" TO app_api;


--
-- Name: TABLE "rateLimit"; Type: ACL; Schema: app_auth; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app_auth."rateLimit" TO app_api;


--
-- Name: TABLE session; Type: ACL; Schema: app_auth; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app_auth.session TO app_api;


--
-- Name: TABLE "user"; Type: ACL; Schema: app_auth; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app_auth."user" TO app_api;


--
-- Name: TABLE verification; Type: ACL; Schema: app_auth; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app_auth.verification TO app_api;


--
-- Name: TABLE current_index; Type: ACL; Schema: campus_docs_serving; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE campus_docs_serving.current_index TO execution_control;


--
-- Name: TABLE groups; Type: ACL; Schema: campus_groups; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE campus_groups.groups TO app_api;


--
-- Name: TABLE sections; Type: ACL; Schema: campus_groups; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE campus_groups.sections TO app_api;


--
-- Name: TABLE conversations; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE chat.conversations TO app_api;


--
-- Name: TABLE message_feedback; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE chat.message_feedback TO app_api;


--
-- Name: TABLE messages; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE chat.messages TO app_api;


--
-- Name: COLUMN messages.id; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT(id) ON TABLE chat.messages TO ops_web;


--
-- Name: COLUMN messages.conversation_id; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT(conversation_id) ON TABLE chat.messages TO ops_web;


--
-- Name: COLUMN messages.role; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT(role) ON TABLE chat.messages TO ops_web;


--
-- Name: COLUMN messages.kind; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT(kind) ON TABLE chat.messages TO ops_web;


--
-- Name: COLUMN messages.text; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT(text) ON TABLE chat.messages TO ops_web;


--
-- Name: COLUMN messages.structured_parts_json; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT(structured_parts_json) ON TABLE chat.messages TO ops_web;


--
-- Name: COLUMN messages.request_id; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT(request_id) ON TABLE chat.messages TO ops_web;


--
-- Name: TABLE session_slots; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE chat.session_slots TO app_api;


--
-- Name: TABLE turn_dispatches; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE chat.turn_dispatches TO app_api;


--
-- Name: COLUMN turn_dispatches.request_id; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT(request_id) ON TABLE chat.turn_dispatches TO ops_web;


--
-- Name: COLUMN turn_dispatches.conversation_id; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT(conversation_id) ON TABLE chat.turn_dispatches TO ops_web;


--
-- Name: COLUMN turn_dispatches.user_message_id; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT(user_message_id) ON TABLE chat.turn_dispatches TO ops_web;


--
-- Name: COLUMN turn_dispatches.status; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT(status) ON TABLE chat.turn_dispatches TO ops_web;


--
-- Name: COLUMN turn_dispatches.error_code; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT(error_code) ON TABLE chat.turn_dispatches TO ops_web;


--
-- Name: COLUMN turn_dispatches.created_at; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT(created_at) ON TABLE chat.turn_dispatches TO ops_web;


--
-- Name: COLUMN turn_dispatches.completed_at; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT(completed_at) ON TABLE chat.turn_dispatches TO ops_web;


--
-- Name: COLUMN turn_dispatches.updated_at; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT(updated_at) ON TABLE chat.turn_dispatches TO ops_web;


--
-- Name: COLUMN turn_dispatches.assistant_message_id; Type: ACL; Schema: chat; Owner: -
--

GRANT SELECT(assistant_message_id) ON TABLE chat.turn_dispatches TO ops_web;


--
-- Name: TABLE map_draft; Type: ACL; Schema: dining; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE dining.map_draft TO ops_web;


--
-- Name: TABLE map_publication; Type: ACL; Schema: dining; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE dining.map_publication TO ops_web;
GRANT SELECT ON TABLE dining.map_publication TO app_api;


--
-- Name: TABLE map_releases; Type: ACL; Schema: dining; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE dining.map_releases TO ops_web;
GRANT SELECT ON TABLE dining.map_releases TO app_api;


--
-- Name: TABLE menu_items; Type: ACL; Schema: dining; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE dining.menu_items TO ops_web;
GRANT SELECT ON TABLE dining.menu_items TO app_api;


--
-- Name: TABLE review_edits; Type: ACL; Schema: dining; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE dining.review_edits TO ops_web;


--
-- Name: TABLE review_reports; Type: ACL; Schema: dining; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE dining.review_reports TO ops_web;
GRANT SELECT,INSERT ON TABLE dining.review_reports TO app_api;


--
-- Name: TABLE reviews; Type: ACL; Schema: dining; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE dining.reviews TO ops_web;
GRANT SELECT,INSERT,UPDATE ON TABLE dining.reviews TO app_api;


--
-- Name: TABLE agent_invocation_receipts; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE execution_control.agent_invocation_receipts TO execution_control;


--
-- Name: TABLE agent_run_cancellations; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE execution_control.agent_run_cancellations TO execution_control;


--
-- Name: TABLE agent_run_events; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE execution_control.agent_run_events TO execution_control;


--
-- Name: TABLE agent_run_steps; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE execution_control.agent_run_steps TO execution_control;


--
-- Name: COLUMN agent_run_steps.step_id; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(step_id) ON TABLE execution_control.agent_run_steps TO ops_web;


--
-- Name: COLUMN agent_run_steps.step_kind; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(step_kind) ON TABLE execution_control.agent_run_steps TO ops_web;


--
-- Name: COLUMN agent_run_steps.status; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(status) ON TABLE execution_control.agent_run_steps TO ops_web;


--
-- Name: COLUMN agent_run_steps.started_at; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(started_at) ON TABLE execution_control.agent_run_steps TO ops_web;


--
-- Name: COLUMN agent_run_steps.completed_at; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(completed_at) ON TABLE execution_control.agent_run_steps TO ops_web;


--
-- Name: COLUMN agent_run_steps.updated_at; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(updated_at) ON TABLE execution_control.agent_run_steps TO ops_web;


--
-- Name: COLUMN agent_run_steps.sanitized_payload_json; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(sanitized_payload_json) ON TABLE execution_control.agent_run_steps TO ops_web;


--
-- Name: COLUMN agent_run_steps.request_id; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(request_id) ON TABLE execution_control.agent_run_steps TO ops_web;


--
-- Name: TABLE agent_runs; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE execution_control.agent_runs TO execution_control;


--
-- Name: COLUMN agent_runs.request_id; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(request_id) ON TABLE execution_control.agent_runs TO ops_web;


--
-- Name: COLUMN agent_runs.status; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(status) ON TABLE execution_control.agent_runs TO ops_web;


--
-- Name: COLUMN agent_runs.terminal_reason; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(terminal_reason) ON TABLE execution_control.agent_runs TO ops_web;


--
-- Name: COLUMN agent_runs.fail_close_reason; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(fail_close_reason) ON TABLE execution_control.agent_runs TO ops_web;


--
-- Name: COLUMN agent_runs.completed_at; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(completed_at) ON TABLE execution_control.agent_runs TO ops_web;


--
-- Name: COLUMN agent_runs.updated_at; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(updated_at) ON TABLE execution_control.agent_runs TO ops_web;


--
-- Name: TABLE agent_step_attempts; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE execution_control.agent_step_attempts TO execution_control;


--
-- Name: COLUMN agent_step_attempts.step_id; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(step_id) ON TABLE execution_control.agent_step_attempts TO ops_web;


--
-- Name: COLUMN agent_step_attempts.attempt; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(attempt) ON TABLE execution_control.agent_step_attempts TO ops_web;


--
-- Name: COLUMN agent_step_attempts.status; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(status) ON TABLE execution_control.agent_step_attempts TO ops_web;


--
-- Name: COLUMN agent_step_attempts.started_at; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(started_at) ON TABLE execution_control.agent_step_attempts TO ops_web;


--
-- Name: COLUMN agent_step_attempts.completed_at; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(completed_at) ON TABLE execution_control.agent_step_attempts TO ops_web;


--
-- Name: COLUMN agent_step_attempts.duration_ms; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(duration_ms) ON TABLE execution_control.agent_step_attempts TO ops_web;


--
-- Name: COLUMN agent_step_attempts.model_provider; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(model_provider) ON TABLE execution_control.agent_step_attempts TO ops_web;


--
-- Name: COLUMN agent_step_attempts.model_name; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(model_name) ON TABLE execution_control.agent_step_attempts TO ops_web;


--
-- Name: COLUMN agent_step_attempts.model_request_count; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(model_request_count) ON TABLE execution_control.agent_step_attempts TO ops_web;


--
-- Name: COLUMN agent_step_attempts.input_tokens; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(input_tokens) ON TABLE execution_control.agent_step_attempts TO ops_web;


--
-- Name: COLUMN agent_step_attempts.output_tokens; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(output_tokens) ON TABLE execution_control.agent_step_attempts TO ops_web;


--
-- Name: COLUMN agent_step_attempts.cached_input_tokens; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(cached_input_tokens) ON TABLE execution_control.agent_step_attempts TO ops_web;


--
-- Name: COLUMN agent_step_attempts.usage_observed; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(usage_observed) ON TABLE execution_control.agent_step_attempts TO ops_web;


--
-- Name: COLUMN agent_step_attempts.fail_close_reason; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(fail_close_reason) ON TABLE execution_control.agent_step_attempts TO ops_web;


--
-- Name: COLUMN agent_step_attempts.terminal_reason; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(terminal_reason) ON TABLE execution_control.agent_step_attempts TO ops_web;


--
-- Name: COLUMN agent_step_attempts.sanitized_payload_json; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(sanitized_payload_json) ON TABLE execution_control.agent_step_attempts TO ops_web;


--
-- Name: COLUMN agent_step_attempts.request_id; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT(request_id) ON TABLE execution_control.agent_step_attempts TO ops_web;


--
-- Name: TABLE agent_step_results; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE execution_control.agent_step_results TO execution_control;


--
-- Name: TABLE agent_workflow_starts; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE execution_control.agent_workflow_starts TO execution_control;


--
-- Name: TABLE conversation_run_locks; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE execution_control.conversation_run_locks TO execution_control;


--
-- Name: TABLE owner_deletion_fences; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE execution_control.owner_deletion_fences TO execution_control;


--
-- Name: TABLE personal_memory_call_leases; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE execution_control.personal_memory_call_leases TO execution_control;


--
-- Name: TABLE personal_memory_command_receipts; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE execution_control.personal_memory_command_receipts TO execution_control;


--
-- Name: TABLE personal_memory_owner_fences; Type: ACL; Schema: execution_control; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE execution_control.personal_memory_owner_fences TO execution_control;


--
-- Name: TABLE automation_tokens; Type: ACL; Schema: internal_portal; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE internal_portal.automation_tokens TO ops_web;


--
-- Name: TABLE credentials; Type: ACL; Schema: internal_portal; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE internal_portal.credentials TO ops_web;


--
-- Name: TABLE model_configs; Type: ACL; Schema: model_config; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE model_config.model_configs TO model_config;


--
-- Name: TABLE categories; Type: ACL; Schema: notices; Owner: -
--

GRANT SELECT ON TABLE notices.categories TO app_api;
GRANT SELECT ON TABLE notices.categories TO ops_web;
DO $campus_agent_optional_notice_publisher$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notice_publisher') THEN
        EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE notices.categories TO notice_publisher';
    END IF;
END
$campus_agent_optional_notice_publisher$;


--
-- Name: TABLE notice_assets; Type: ACL; Schema: notices; Owner: -
--

GRANT SELECT ON TABLE notices.notice_assets TO app_api;
DO $campus_agent_optional_notice_publisher$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notice_publisher') THEN
        EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE notices.notice_assets TO notice_publisher';
    END IF;
END
$campus_agent_optional_notice_publisher$;


--
-- Name: TABLE notice_types; Type: ACL; Schema: notices; Owner: -
--

GRANT SELECT ON TABLE notices.notice_types TO app_api;
GRANT SELECT ON TABLE notices.notice_types TO ops_web;
DO $campus_agent_optional_notice_publisher$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notice_publisher') THEN
        EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE notices.notice_types TO notice_publisher';
    END IF;
END
$campus_agent_optional_notice_publisher$;


--
-- Name: TABLE notices; Type: ACL; Schema: notices; Owner: -
--

GRANT SELECT ON TABLE notices.notices TO app_api;
DO $campus_agent_optional_notice_publisher$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notice_publisher') THEN
        EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE notices.notices TO notice_publisher';
    END IF;
END
$campus_agent_optional_notice_publisher$;


--
-- Name: COLUMN notices.notice_id; Type: ACL; Schema: notices; Owner: -
--

GRANT SELECT(notice_id) ON TABLE notices.notices TO ops_web;


--
-- Name: COLUMN notices.notice_type; Type: ACL; Schema: notices; Owner: -
--

GRANT SELECT(notice_type) ON TABLE notices.notices TO ops_web;


--
-- Name: COLUMN notices.organization_id; Type: ACL; Schema: notices; Owner: -
--

GRANT SELECT(organization_id) ON TABLE notices.notices TO ops_web;


--
-- Name: COLUMN notices.title; Type: ACL; Schema: notices; Owner: -
--

GRANT SELECT(title) ON TABLE notices.notices TO ops_web;


--
-- Name: COLUMN notices.released_at; Type: ACL; Schema: notices; Owner: -
--

GRANT SELECT(released_at) ON TABLE notices.notices TO ops_web;


--
-- Name: COLUMN notices.is_external; Type: ACL; Schema: notices; Owner: -
--

GRANT SELECT(is_external) ON TABLE notices.notices TO ops_web;


--
-- Name: COLUMN notices.external_url; Type: ACL; Schema: notices; Owner: -
--

GRANT SELECT(external_url) ON TABLE notices.notices TO ops_web;


--
-- Name: COLUMN notices.category; Type: ACL; Schema: notices; Owner: -
--

GRANT SELECT(category),UPDATE(category) ON TABLE notices.notices TO ops_web;


--
-- Name: COLUMN notices.is_published; Type: ACL; Schema: notices; Owner: -
--

GRANT SELECT(is_published) ON TABLE notices.notices TO ops_web;


--
-- Name: TABLE organizations; Type: ACL; Schema: notices; Owner: -
--

GRANT SELECT ON TABLE notices.organizations TO app_api;
GRANT SELECT ON TABLE notices.organizations TO ops_web;
DO $campus_agent_optional_notice_publisher$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notice_publisher') THEN
        EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE notices.organizations TO notice_publisher';
    END IF;
END
$campus_agent_optional_notice_publisher$;


--
-- Name: TABLE account_deletion_requests; Type: ACL; Schema: profile; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE profile.account_deletion_requests TO app_api;


--
-- Name: TABLE memory_command_sources; Type: ACL; Schema: profile; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE profile.memory_command_sources TO app_api;


--
-- Name: TABLE memory_commands; Type: ACL; Schema: profile; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE profile.memory_commands TO app_api;


--
-- Name: TABLE memory_items; Type: ACL; Schema: profile; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE profile.memory_items TO app_api;


--
-- Name: TABLE memory_settings; Type: ACL; Schema: profile; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE profile.memory_settings TO app_api;


--
-- Name: TABLE personal_memory_call_leases; Type: ACL; Schema: runtime; Owner: -
--

GRANT SELECT ON TABLE runtime.personal_memory_call_leases TO execution_control;


--
-- Name: TABLE personal_memory_command_receipts; Type: ACL; Schema: runtime; Owner: -
--

GRANT SELECT ON TABLE runtime.personal_memory_command_receipts TO execution_control;


--
-- Name: TABLE personal_memory_owner_fences; Type: ACL; Schema: runtime; Owner: -
--

GRANT SELECT ON TABLE runtime.personal_memory_owner_fences TO execution_control;


--
-- Name: TABLE request_observability_fact; Type: ACL; Schema: runtime; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE runtime.request_observability_fact TO app_api;


--
-- PostgreSQL database dump complete
--
