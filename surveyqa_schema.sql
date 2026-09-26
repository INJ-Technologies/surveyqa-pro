--
-- PostgreSQL database dump
--

\restrict 3bDiyN8NuOohkZqZfQs8NlxvsCv24ler7XmSKLJj1haMV9zRvvFSNaIwBf1uMbT

-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ai_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_models (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    workspace_id uuid NOT NULL,
    display_name character varying(255) NOT NULL,
    model_id character varying(200) NOT NULL,
    provider character varying(100),
    input_price_per_1m numeric(12,6) DEFAULT 0,
    output_price_per_1m numeric(12,6) DEFAULT 0,
    context_length integer DEFAULT 0,
    supports_reasoning boolean DEFAULT false,
    reasoning_level character varying(20) DEFAULT 'off'::character varying,
    notes text,
    is_default boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    reasoning_price_per_1m numeric(12,6) DEFAULT 0,
    CONSTRAINT ai_models_reasoning_level_check CHECK (((reasoning_level)::text = ANY ((ARRAY['off'::character varying, 'low'::character varying, 'medium'::character varying, 'high'::character varying])::text[])))
);


--
-- Name: ai_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    name text NOT NULL,
    provider_type text NOT NULL,
    secret_name text NOT NULL,
    model text NOT NULL,
    base_url text,
    is_active boolean DEFAULT true,
    is_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    workspace_id uuid,
    user_id uuid,
    action character varying(100) NOT NULL,
    entity_type character varying(100),
    entity_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    ip_address character varying(50),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: personas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personas (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    tags text[] DEFAULT '{}'::text[],
    age_min integer,
    age_max integer,
    gender character varying(20),
    country character varying(100),
    region character varying(100),
    city character varying(100),
    language character varying(10) DEFAULT 'en'::character varying,
    income_min integer,
    income_max integer,
    education character varying(100),
    employment_status character varying(100),
    household_size integer,
    marital_status character varying(50),
    device_type character varying(20) DEFAULT 'desktop'::character varying,
    behavioural_attrs jsonb DEFAULT '{}'::jsonb,
    custom_attrs jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    performance_score numeric(5,2) DEFAULT 100,
    version integer DEFAULT 1,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    ai_generated boolean DEFAULT false,
    CONSTRAINT personas_device_type_check CHECK (((device_type)::text = ANY ((ARRAY['desktop'::character varying, 'mobile'::character varying, 'tablet'::character varying])::text[])))
);


--
-- Name: project_personas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_personas (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    project_id uuid NOT NULL,
    persona_id uuid NOT NULL,
    quota_cell_ids uuid[] DEFAULT '{}'::uuid[],
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: project_scenarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_scenarios (
    project_id uuid NOT NULL,
    scenario_id uuid NOT NULL,
    is_active boolean DEFAULT true
);


--
-- Name: project_surveys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_surveys (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    project_id uuid NOT NULL,
    label character varying(100) DEFAULT 'Main'::character varying,
    url text NOT NULL,
    countries text[] DEFAULT '{}'::text[],
    languages text[] DEFAULT '{}'::text[],
    allocation integer DEFAULT 100,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    workspace_id uuid NOT NULL,
    owner_id uuid,
    name character varying(255) NOT NULL,
    client_name character varying(255),
    reference_id character varying(100),
    description text,
    survey_platform character varying(50) DEFAULT 'unknown'::character varying,
    status character varying(50) DEFAULT 'draft'::character varying,
    target_completes integer DEFAULT 0,
    target_loi_minutes integer DEFAULT 15,
    ai_mode_openend character varying(20) DEFAULT 'ai'::character varying,
    ai_mode_image character varying(20) DEFAULT 'ai'::character varying,
    ai_strategy character varying(20) DEFAULT 'persona_true'::character varying,
    proxy_provider character varying(50) DEFAULT 'brightdata'::character varying,
    concurrent_sessions integer DEFAULT 5,
    budget_proxy numeric(10,2),
    budget_ai numeric(10,2),
    start_date date,
    end_date date,
    launched_at timestamp with time zone,
    completed_at timestamp with time zone,
    settings jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    persona_rotation character varying(20) DEFAULT 'random'::character varying,
    CONSTRAINT projects_ai_mode_image_check CHECK (((ai_mode_image)::text = ANY ((ARRAY['ai'::character varying, 'human'::character varying, 'predefined'::character varying])::text[]))),
    CONSTRAINT projects_ai_mode_openend_check CHECK (((ai_mode_openend)::text = ANY ((ARRAY['ai'::character varying, 'human'::character varying, 'predefined'::character varying])::text[]))),
    CONSTRAINT projects_ai_strategy_check CHECK (((ai_strategy)::text = ANY ((ARRAY['persona_true'::character varying, 'quota_guided'::character varying, 'stress_test'::character varying])::text[]))),
    CONSTRAINT projects_persona_rotation_check CHECK (((persona_rotation)::text = ANY ((ARRAY['random'::character varying, 'round_robin'::character varying, 'weighted'::character varying])::text[]))),
    CONSTRAINT projects_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'review'::character varying, 'active'::character varying, 'paused'::character varying, 'completed'::character varying, 'archived'::character varying])::text[]))),
    CONSTRAINT projects_survey_platform_check CHECK (((survey_platform)::text = ANY ((ARRAY['decipher'::character varying, 'qualtrics'::character varying, 'confirmit'::character varying, 'alchemer'::character varying, 'surveymonkey'::character varying, 'custom'::character varying, 'unknown'::character varying])::text[])))
);


--
-- Name: proxy_countries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proxy_countries (
    id integer NOT NULL,
    country character varying(100) NOT NULL,
    code character(2) NOT NULL,
    endpoint character varying(100),
    port integer,
    status smallint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: proxy_countries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.proxy_countries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: proxy_countries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.proxy_countries_id_seq OWNED BY public.proxy_countries.id;


--
-- Name: proxy_used_ips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proxy_used_ips (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    project_id uuid NOT NULL,
    ip_address character varying(50) NOT NULL,
    country character varying(10),
    provider character varying(50),
    used_at timestamp with time zone DEFAULT now(),
    session_id uuid
);


--
-- Name: quota_cells; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quota_cells (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    quota_plan_id uuid NOT NULL,
    project_id uuid NOT NULL,
    label character varying(255) NOT NULL,
    dimensions jsonb DEFAULT '{}'::jsonb NOT NULL,
    target integer DEFAULT 0 NOT NULL,
    minimum integer DEFAULT 0,
    quota_type character varying(10) DEFAULT 'hard'::character varying,
    current_count integer DEFAULT 0,
    status character varying(20) DEFAULT 'open'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT quota_cells_quota_type_check CHECK (((quota_type)::text = ANY ((ARRAY['hard'::character varying, 'soft'::character varying])::text[]))),
    CONSTRAINT quota_cells_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'filled'::character varying, 'closed'::character varying, 'at_risk'::character varying])::text[])))
);


--
-- Name: quota_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quota_plans (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    project_id uuid NOT NULL,
    version integer DEFAULT 1,
    is_active boolean DEFAULT true,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: response_fingerprints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.response_fingerprints (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    project_id uuid NOT NULL,
    session_id uuid,
    fingerprint text NOT NULL,
    page_count integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: response_libraries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.response_libraries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    project_id uuid NOT NULL,
    name character varying(255) DEFAULT 'Default Library'::character varying,
    total_count integer DEFAULT 0,
    used_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: response_library_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.response_library_entries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    library_id uuid NOT NULL,
    project_id uuid NOT NULL,
    response_text text NOT NULL,
    topic_tags text[] DEFAULT '{}'::text[],
    persona_tags text[] DEFAULT '{}'::text[],
    sentiment character varying(20) DEFAULT 'neutral'::character varying,
    length_category character varying(20) DEFAULT 'medium'::character varying,
    is_used boolean DEFAULT false,
    used_in_session uuid,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT response_library_entries_length_category_check CHECK (((length_category)::text = ANY ((ARRAY['short'::character varying, 'medium'::character varying, 'long'::character varying])::text[]))),
    CONSTRAINT response_library_entries_sentiment_check CHECK (((sentiment)::text = ANY ((ARRAY['positive'::character varying, 'neutral'::character varying, 'negative'::character varying])::text[])))
);


--
-- Name: scenario_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scenario_steps (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    scenario_id uuid NOT NULL,
    step_order integer NOT NULL,
    when_type character varying(50) NOT NULL,
    when_value text,
    conditions jsonb DEFAULT '[]'::jsonb,
    action character varying(50) NOT NULL,
    action_values jsonb DEFAULT '[]'::jsonb,
    action_mode character varying(50),
    action_text text,
    duration_s integer,
    created_at timestamp with time zone DEFAULT now(),
    wait_min_s integer,
    wait_max_s integer
);


--
-- Name: scenarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scenarios (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    project_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    expected_outcome character varying(50) DEFAULT 'any'::character varying,
    source_session_id uuid,
    is_active boolean DEFAULT true,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    country_mapping jsonb
);


--
-- Name: session_anomalies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_anomalies (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    project_id uuid NOT NULL,
    session_id uuid,
    anomaly_type character varying(50) NOT NULL,
    details jsonb DEFAULT '{}'::jsonb,
    severity character varying(20) DEFAULT 'warning'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT session_anomalies_severity_check CHECK (((severity)::text = ANY ((ARRAY['info'::character varying, 'warning'::character varying, 'critical'::character varying])::text[])))
);


--
-- Name: session_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_answers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id uuid NOT NULL,
    project_id uuid NOT NULL,
    question_number integer,
    question_text text,
    question_type character varying(50),
    answer_value text,
    answer_label text,
    ai_mode character varying(20),
    ai_confidence numeric(5,2),
    ai_reasoning text,
    library_entry_id uuid,
    human_handled boolean DEFAULT false,
    time_on_question_s integer,
    page_timer_detected boolean DEFAULT false,
    page_timer_value_s integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: session_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_events (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id uuid NOT NULL,
    event_type character varying(50) NOT NULL,
    page_number integer,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    payload jsonb DEFAULT '{}'::jsonb
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    project_id uuid NOT NULL,
    survey_id uuid,
    persona_id uuid,
    quota_cell_id uuid,
    status character varying(20) DEFAULT 'queued'::character varying,
    ai_strategy character varying(20) DEFAULT 'persona_true'::character varying,
    browser_type character varying(20) DEFAULT 'chromium'::character varying,
    device_type character varying(20) DEFAULT 'desktop'::character varying,
    proxy_ip character varying(50),
    proxy_country character varying(10),
    proxy_provider character varying(50),
    outcome character varying(30),
    redirect_url text,
    redirect_type character varying(20),
    total_duration_s integer,
    question_count integer DEFAULT 0,
    quality_score numeric(5,2),
    tags text[] DEFAULT '{}'::text[],
    error_log text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    response_id character varying(20),
    trace_path text,
    workspace_id uuid,
    survey_url text,
    survey_label character varying(255) DEFAULT 'Main'::character varying,
    internal_testing boolean DEFAULT false,
    scenario_name character varying(255),
    model_used character varying(200),
    input_tokens_total integer DEFAULT 0,
    output_tokens_total integer DEFAULT 0,
    ai_calls_count integer DEFAULT 0,
    ai_cost_usd numeric(10,6) DEFAULT 0,
    persona_name character varying(255),
    straight_line_score numeric(5,2),
    openend_quality_score numeric(5,2),
    validation_errors integer DEFAULT 0,
    platform_detected character varying(50),
    survey_map_id uuid,
    CONSTRAINT sessions_status_check CHECK (((status)::text = ANY ((ARRAY['queued'::character varying, 'initialising'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'terminated'::character varying, 'over_quota'::character varying, 'error'::character varying, 'flagged'::character varying])::text[])))
);


--
-- Name: survey_maps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.survey_maps (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    project_id uuid NOT NULL,
    survey_url text NOT NULL,
    platform character varying(50) DEFAULT 'decipher'::character varying,
    page_count integer,
    screener_pages jsonb DEFAULT '[]'::jsonb,
    question_map jsonb DEFAULT '[]'::jsonb,
    routing_hints jsonb DEFAULT '{}'::jsonb,
    mapped_at timestamp with time zone DEFAULT now()
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    workspace_id uuid,
    email character varying(255) NOT NULL,
    password_hash text NOT NULL,
    full_name character varying(255) NOT NULL,
    role character varying(50) DEFAULT 'tester'::character varying NOT NULL,
    is_active boolean DEFAULT true,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['admin'::character varying, 'project_manager'::character varying, 'tester'::character varying, 'viewer'::character varying, 'client'::character varying])::text[])))
);


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(100) NOT NULL,
    logo_url text,
    primary_color character varying(7) DEFAULT '#1F4E79'::character varying,
    accent_color character varying(7) DEFAULT '#2E75B6'::character varying,
    custom_domain character varying(255),
    timezone character varying(100) DEFAULT 'Asia/Kolkata'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: proxy_countries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proxy_countries ALTER COLUMN id SET DEFAULT nextval('public.proxy_countries_id_seq'::regclass);


--
-- Name: ai_models ai_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_models
    ADD CONSTRAINT ai_models_pkey PRIMARY KEY (id);


--
-- Name: ai_models ai_models_workspace_id_model_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_models
    ADD CONSTRAINT ai_models_workspace_id_model_id_key UNIQUE (workspace_id, model_id);


--
-- Name: ai_providers ai_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_providers
    ADD CONSTRAINT ai_providers_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: personas personas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personas
    ADD CONSTRAINT personas_pkey PRIMARY KEY (id);


--
-- Name: project_personas project_personas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_personas
    ADD CONSTRAINT project_personas_pkey PRIMARY KEY (id);


--
-- Name: project_personas project_personas_project_id_persona_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_personas
    ADD CONSTRAINT project_personas_project_id_persona_id_key UNIQUE (project_id, persona_id);


--
-- Name: project_scenarios project_scenarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_scenarios
    ADD CONSTRAINT project_scenarios_pkey PRIMARY KEY (project_id, scenario_id);


--
-- Name: project_surveys project_surveys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_surveys
    ADD CONSTRAINT project_surveys_pkey PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: proxy_countries proxy_countries_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proxy_countries
    ADD CONSTRAINT proxy_countries_code_key UNIQUE (code);


--
-- Name: proxy_countries proxy_countries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proxy_countries
    ADD CONSTRAINT proxy_countries_pkey PRIMARY KEY (id);


--
-- Name: proxy_used_ips proxy_used_ips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proxy_used_ips
    ADD CONSTRAINT proxy_used_ips_pkey PRIMARY KEY (id);


--
-- Name: proxy_used_ips proxy_used_ips_project_id_ip_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proxy_used_ips
    ADD CONSTRAINT proxy_used_ips_project_id_ip_address_key UNIQUE (project_id, ip_address);


--
-- Name: quota_cells quota_cells_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quota_cells
    ADD CONSTRAINT quota_cells_pkey PRIMARY KEY (id);


--
-- Name: quota_plans quota_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quota_plans
    ADD CONSTRAINT quota_plans_pkey PRIMARY KEY (id);


--
-- Name: response_fingerprints response_fingerprints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_fingerprints
    ADD CONSTRAINT response_fingerprints_pkey PRIMARY KEY (id);


--
-- Name: response_fingerprints response_fingerprints_project_id_fingerprint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_fingerprints
    ADD CONSTRAINT response_fingerprints_project_id_fingerprint_key UNIQUE (project_id, fingerprint);


--
-- Name: response_libraries response_libraries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_libraries
    ADD CONSTRAINT response_libraries_pkey PRIMARY KEY (id);


--
-- Name: response_library_entries response_library_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_library_entries
    ADD CONSTRAINT response_library_entries_pkey PRIMARY KEY (id);


--
-- Name: scenario_steps scenario_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scenario_steps
    ADD CONSTRAINT scenario_steps_pkey PRIMARY KEY (id);


--
-- Name: scenarios scenarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scenarios
    ADD CONSTRAINT scenarios_pkey PRIMARY KEY (id);


--
-- Name: session_anomalies session_anomalies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_anomalies
    ADD CONSTRAINT session_anomalies_pkey PRIMARY KEY (id);


--
-- Name: session_answers session_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_answers
    ADD CONSTRAINT session_answers_pkey PRIMARY KEY (id);


--
-- Name: session_events session_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_events
    ADD CONSTRAINT session_events_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: survey_maps survey_maps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_maps
    ADD CONSTRAINT survey_maps_pkey PRIMARY KEY (id);


--
-- Name: survey_maps survey_maps_project_id_survey_url_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_maps
    ADD CONSTRAINT survey_maps_project_id_survey_url_key UNIQUE (project_id, survey_url);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_slug_key UNIQUE (slug);


--
-- Name: idx_ai_models_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_models_workspace ON public.ai_models USING btree (workspace_id);


--
-- Name: idx_ai_providers_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_providers_workspace ON public.ai_providers USING btree (workspace_id);


--
-- Name: idx_audit_logs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_user ON public.audit_logs USING btree (user_id);


--
-- Name: idx_audit_logs_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_workspace ON public.audit_logs USING btree (workspace_id);


--
-- Name: idx_lib_entries_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lib_entries_project ON public.response_library_entries USING btree (project_id);


--
-- Name: idx_lib_entries_used; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lib_entries_used ON public.response_library_entries USING btree (is_used);


--
-- Name: idx_personas_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_personas_workspace ON public.personas USING btree (workspace_id);


--
-- Name: idx_project_personas_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_personas_persona ON public.project_personas USING btree (persona_id);


--
-- Name: idx_project_personas_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_personas_project ON public.project_personas USING btree (project_id);


--
-- Name: idx_projects_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_status ON public.projects USING btree (status);


--
-- Name: idx_projects_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_workspace ON public.projects USING btree (workspace_id);


--
-- Name: idx_proxy_ips_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proxy_ips_project ON public.proxy_used_ips USING btree (project_id);


--
-- Name: idx_quota_cells_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quota_cells_project ON public.quota_cells USING btree (project_id);


--
-- Name: idx_quota_cells_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quota_cells_status ON public.quota_cells USING btree (status);


--
-- Name: idx_session_answers_sess; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_answers_sess ON public.session_answers USING btree (session_id);


--
-- Name: idx_session_events_sess; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_events_sess ON public.session_events USING btree (session_id);


--
-- Name: idx_sessions_cost; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_cost ON public.sessions USING btree (project_id, ai_cost_usd);


--
-- Name: idx_sessions_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_persona ON public.sessions USING btree (persona_id);


--
-- Name: idx_sessions_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_project ON public.sessions USING btree (project_id);


--
-- Name: idx_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_status ON public.sessions USING btree (status);


--
-- Name: ai_models ai_models_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_models
    ADD CONSTRAINT ai_models_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: ai_providers ai_providers_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_providers
    ADD CONSTRAINT ai_providers_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: audit_logs audit_logs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;


--
-- Name: personas personas_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personas
    ADD CONSTRAINT personas_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: personas personas_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personas
    ADD CONSTRAINT personas_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: project_personas project_personas_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_personas
    ADD CONSTRAINT project_personas_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE CASCADE;


--
-- Name: project_personas project_personas_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_personas
    ADD CONSTRAINT project_personas_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_scenarios project_scenarios_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_scenarios
    ADD CONSTRAINT project_scenarios_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_scenarios project_scenarios_scenario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_scenarios
    ADD CONSTRAINT project_scenarios_scenario_id_fkey FOREIGN KEY (scenario_id) REFERENCES public.scenarios(id) ON DELETE CASCADE;


--
-- Name: project_surveys project_surveys_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_surveys
    ADD CONSTRAINT project_surveys_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: projects projects_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: projects projects_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: proxy_used_ips proxy_used_ips_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proxy_used_ips
    ADD CONSTRAINT proxy_used_ips_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: proxy_used_ips proxy_used_ips_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proxy_used_ips
    ADD CONSTRAINT proxy_used_ips_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL;


--
-- Name: quota_cells quota_cells_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quota_cells
    ADD CONSTRAINT quota_cells_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: quota_cells quota_cells_quota_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quota_cells
    ADD CONSTRAINT quota_cells_quota_plan_id_fkey FOREIGN KEY (quota_plan_id) REFERENCES public.quota_plans(id) ON DELETE CASCADE;


--
-- Name: quota_plans quota_plans_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quota_plans
    ADD CONSTRAINT quota_plans_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: quota_plans quota_plans_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quota_plans
    ADD CONSTRAINT quota_plans_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: response_fingerprints response_fingerprints_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_fingerprints
    ADD CONSTRAINT response_fingerprints_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: response_fingerprints response_fingerprints_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_fingerprints
    ADD CONSTRAINT response_fingerprints_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL;


--
-- Name: response_libraries response_libraries_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_libraries
    ADD CONSTRAINT response_libraries_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: response_library_entries response_library_entries_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_library_entries
    ADD CONSTRAINT response_library_entries_library_id_fkey FOREIGN KEY (library_id) REFERENCES public.response_libraries(id) ON DELETE CASCADE;


--
-- Name: response_library_entries response_library_entries_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_library_entries
    ADD CONSTRAINT response_library_entries_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: scenario_steps scenario_steps_scenario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scenario_steps
    ADD CONSTRAINT scenario_steps_scenario_id_fkey FOREIGN KEY (scenario_id) REFERENCES public.scenarios(id) ON DELETE CASCADE;


--
-- Name: scenarios scenarios_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scenarios
    ADD CONSTRAINT scenarios_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: scenarios scenarios_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scenarios
    ADD CONSTRAINT scenarios_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: scenarios scenarios_source_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scenarios
    ADD CONSTRAINT scenarios_source_session_id_fkey FOREIGN KEY (source_session_id) REFERENCES public.sessions(id) ON DELETE SET NULL;


--
-- Name: scenarios scenarios_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scenarios
    ADD CONSTRAINT scenarios_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: session_anomalies session_anomalies_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_anomalies
    ADD CONSTRAINT session_anomalies_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: session_anomalies session_anomalies_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_anomalies
    ADD CONSTRAINT session_anomalies_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL;


--
-- Name: session_answers session_answers_library_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_answers
    ADD CONSTRAINT session_answers_library_entry_id_fkey FOREIGN KEY (library_entry_id) REFERENCES public.response_library_entries(id);


--
-- Name: session_answers session_answers_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_answers
    ADD CONSTRAINT session_answers_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: session_answers session_answers_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_answers
    ADD CONSTRAINT session_answers_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: session_events session_events_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_events
    ADD CONSTRAINT session_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE SET NULL;


--
-- Name: sessions sessions_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_quota_cell_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_quota_cell_id_fkey FOREIGN KEY (quota_cell_id) REFERENCES public.quota_cells(id) ON DELETE SET NULL;


--
-- Name: sessions sessions_survey_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_survey_id_fkey FOREIGN KEY (survey_id) REFERENCES public.project_surveys(id) ON DELETE SET NULL;


--
-- Name: sessions sessions_survey_map_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_survey_map_id_fkey FOREIGN KEY (survey_map_id) REFERENCES public.survey_maps(id) ON DELETE SET NULL;


--
-- Name: sessions sessions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;


--
-- Name: survey_maps survey_maps_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_maps
    ADD CONSTRAINT survey_maps_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: users users_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 3bDiyN8NuOohkZqZfQs8NlxvsCv24ler7XmSKLJj1haMV9zRvvFSNaIwBf1uMbT

