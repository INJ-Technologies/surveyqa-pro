'use strict';
const { pool } = require('./index');

const migrate = async () => {
  const client = await pool.connect();

  try {
    console.log('Running database migration...');
    await client.query('BEGIN');

    // ─── EXTENSIONS ────────────────────────────────────────────────────────
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // ─── WORKSPACES ────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name          VARCHAR(255) NOT NULL,
        slug          VARCHAR(100) UNIQUE NOT NULL,
        logo_url      TEXT,
        primary_color VARCHAR(7)   DEFAULT '#1F4E79',
        accent_color  VARCHAR(7)   DEFAULT '#2E75B6',
        custom_domain VARCHAR(255),
        timezone      VARCHAR(100) DEFAULT 'Asia/Kolkata',
        is_active     BOOLEAN      DEFAULT true,
        created_at    TIMESTAMPTZ  DEFAULT NOW(),
        updated_at    TIMESTAMPTZ  DEFAULT NOW()
      )
    `);

    // ─── USERS ─────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        workspace_id   UUID         REFERENCES workspaces(id) ON DELETE CASCADE,
        email          VARCHAR(255) UNIQUE NOT NULL,
        password_hash  TEXT         NOT NULL,
        full_name      VARCHAR(255) NOT NULL,
        role           VARCHAR(50)  NOT NULL DEFAULT 'tester'
                         CHECK (role IN ('admin','project_manager','tester','viewer','client')),
        is_active      BOOLEAN      DEFAULT true,
        last_login_at  TIMESTAMPTZ,
        created_at     TIMESTAMPTZ  DEFAULT NOW(),
        updated_at     TIMESTAMPTZ  DEFAULT NOW()
      )
    `);

    // ─── AUDIT LOG ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        workspace_id UUID         REFERENCES workspaces(id) ON DELETE SET NULL,
        user_id      UUID         REFERENCES users(id) ON DELETE SET NULL,
        action       VARCHAR(100) NOT NULL,
        entity_type  VARCHAR(100),
        entity_id    UUID,
        metadata     JSONB        DEFAULT '{}',
        ip_address   VARCHAR(50),
        created_at   TIMESTAMPTZ  DEFAULT NOW()
      )
    `);

    // ─── PROJECTS ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        workspace_id        UUID         NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        owner_id            UUID         REFERENCES users(id) ON DELETE SET NULL,
        name                VARCHAR(255) NOT NULL,
        client_name         VARCHAR(255),
        reference_id        VARCHAR(100),
        description         TEXT,
        survey_platform     VARCHAR(50)  DEFAULT 'unknown'
                              CHECK (survey_platform IN (
                                'decipher','qualtrics','confirmit',
                                'alchemer','surveymonkey','custom','unknown'
                              )),
        status              VARCHAR(50)  DEFAULT 'draft'
                              CHECK (status IN (
                                'draft','review','active','paused','completed','archived'
                              )),
        target_completes    INTEGER      DEFAULT 0,
        target_loi_minutes  INTEGER      DEFAULT 15,
        ai_mode_openend     VARCHAR(20)  DEFAULT 'ai'
                              CHECK (ai_mode_openend IN ('ai','human','predefined')),
        ai_mode_image       VARCHAR(20)  DEFAULT 'ai'
                              CHECK (ai_mode_image IN ('ai','human','predefined')),
        ai_strategy         VARCHAR(20)  DEFAULT 'persona_true'
                              CHECK (ai_strategy IN (
                                'persona_true','quota_guided','stress_test'
                              )),
        proxy_provider      VARCHAR(50)  DEFAULT 'brightdata',
        concurrent_sessions INTEGER      DEFAULT 5,
        budget_proxy        NUMERIC(10,2),
        budget_ai           NUMERIC(10,2),
        start_date          DATE,
        end_date            DATE,
        launched_at         TIMESTAMPTZ,
        completed_at        TIMESTAMPTZ,
        settings            JSONB        DEFAULT '{}',
        created_at          TIMESTAMPTZ  DEFAULT NOW(),
        updated_at          TIMESTAMPTZ  DEFAULT NOW()
      )
    `);

    // ─── PROJECT SURVEY URLS ───────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS project_surveys (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        project_id   UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        label        VARCHAR(100) DEFAULT 'Main',
        url          TEXT         NOT NULL,
        countries    TEXT[]       DEFAULT '{}',
        languages    TEXT[]       DEFAULT '{}',
        allocation   INTEGER      DEFAULT 100,
        is_active    BOOLEAN      DEFAULT true,
        created_at   TIMESTAMPTZ  DEFAULT NOW()
      )
    `);

    // ─── PERSONAS ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS personas (
        id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        workspace_id      UUID         NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name              VARCHAR(255) NOT NULL,
        description       TEXT,
        tags              TEXT[]       DEFAULT '{}',
        age_min           INTEGER,
        age_max           INTEGER,
        gender            VARCHAR(20),
        country           VARCHAR(100),
        region            VARCHAR(100),
        city              VARCHAR(100),
        language          VARCHAR(10)  DEFAULT 'en',
        income_min        INTEGER,
        income_max        INTEGER,
        education         VARCHAR(100),
        employment_status VARCHAR(100),
        household_size    INTEGER,
        marital_status    VARCHAR(50),
        device_type       VARCHAR(20)  DEFAULT 'desktop'
                            CHECK (device_type IN ('desktop','mobile','tablet')),
        behavioural_attrs JSONB        DEFAULT '{}',
        custom_attrs      JSONB        DEFAULT '{}',
        is_active         BOOLEAN      DEFAULT true,
        performance_score NUMERIC(5,2) DEFAULT 100,
        version           INTEGER      DEFAULT 1,
        created_by        UUID         REFERENCES users(id) ON DELETE SET NULL,
        created_at        TIMESTAMPTZ  DEFAULT NOW(),
        updated_at        TIMESTAMPTZ  DEFAULT NOW()
      )
    `);

    // ─── QUOTA PLANS ───────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS quota_plans (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        project_id   UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        version      INTEGER      DEFAULT 1,
        is_active    BOOLEAN      DEFAULT true,
        created_by   UUID         REFERENCES users(id) ON DELETE SET NULL,
        created_at   TIMESTAMPTZ  DEFAULT NOW(),
        updated_at   TIMESTAMPTZ  DEFAULT NOW()
      )
    `);

    // ─── QUOTA CELLS ───────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS quota_cells (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        quota_plan_id   UUID         NOT NULL REFERENCES quota_plans(id) ON DELETE CASCADE,
        project_id      UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        label           VARCHAR(255) NOT NULL,
        dimensions      JSONB        NOT NULL DEFAULT '{}',
        target          INTEGER      NOT NULL DEFAULT 0,
        minimum         INTEGER      DEFAULT 0,
        quota_type      VARCHAR(10)  DEFAULT 'hard'
                          CHECK (quota_type IN ('hard','soft')),
        current_count   INTEGER      DEFAULT 0,
        status          VARCHAR(20)  DEFAULT 'open'
                          CHECK (status IN ('open','filled','closed','at_risk')),
        created_at      TIMESTAMPTZ  DEFAULT NOW(),
        updated_at      TIMESTAMPTZ  DEFAULT NOW()
      )
    `);

    // ─── PROJECT PERSONA MAPPING ───────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS project_personas (
        id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        persona_id     UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
        quota_cell_ids UUID[]      DEFAULT '{}',
        is_active      BOOLEAN     DEFAULT true,
        created_at     TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(project_id, persona_id)
      )
    `);

    // ─── RESPONSE LIBRARIES ────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS response_libraries (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        project_id   UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name         VARCHAR(255) DEFAULT 'Default Library',
        total_count  INTEGER      DEFAULT 0,
        used_count   INTEGER      DEFAULT 0,
        created_at   TIMESTAMPTZ  DEFAULT NOW(),
        updated_at   TIMESTAMPTZ  DEFAULT NOW()
      )
    `);

    // ─── RESPONSE LIBRARY ENTRIES ──────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS response_library_entries (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        library_id      UUID         NOT NULL REFERENCES response_libraries(id) ON DELETE CASCADE,
        project_id      UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        response_text   TEXT         NOT NULL,
        topic_tags      TEXT[]       DEFAULT '{}',
        persona_tags    TEXT[]       DEFAULT '{}',
        sentiment       VARCHAR(20)  DEFAULT 'neutral'
                          CHECK (sentiment IN ('positive','neutral','negative')),
        length_category VARCHAR(20)  DEFAULT 'medium'
                          CHECK (length_category IN ('short','medium','long')),
        is_used         BOOLEAN      DEFAULT false,
        used_in_session UUID,
        used_at         TIMESTAMPTZ,
        created_at      TIMESTAMPTZ  DEFAULT NOW()
      )
    `);

    // ─── PROXY USED IPS ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS proxy_used_ips (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        ip_address  VARCHAR(50) NOT NULL,
        country     VARCHAR(10),
        provider    VARCHAR(50),
        used_at     TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(project_id, ip_address)
      )
    `);

    // ─── SESSIONS ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        project_id       UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        survey_id        UUID         REFERENCES project_surveys(id) ON DELETE SET NULL,
        persona_id       UUID         REFERENCES personas(id) ON DELETE SET NULL,
        quota_cell_id    UUID         REFERENCES quota_cells(id) ON DELETE SET NULL,
        status           VARCHAR(20)  DEFAULT 'queued'
                           CHECK (status IN (
                             'queued','initialising','in_progress',
                             'completed','terminated','over_quota','error','flagged'
                           )),
        ai_strategy      VARCHAR(20)  DEFAULT 'persona_true',
        browser_type     VARCHAR(20)  DEFAULT 'chromium',
        device_type      VARCHAR(20)  DEFAULT 'desktop',
        proxy_ip         VARCHAR(50),
        proxy_country    VARCHAR(10),
        proxy_provider   VARCHAR(50),
        outcome          VARCHAR(30),
        redirect_url     TEXT,
        redirect_type    VARCHAR(20),
        total_duration_s INTEGER,
        question_count   INTEGER      DEFAULT 0,
        quality_score    NUMERIC(5,2),
        tags             TEXT[]       DEFAULT '{}',
        error_log        TEXT,
        started_at       TIMESTAMPTZ,
        completed_at     TIMESTAMPTZ,
        created_at       TIMESTAMPTZ  DEFAULT NOW(),
        updated_at       TIMESTAMPTZ  DEFAULT NOW()
      )
    `);

    // ─── SESSION ANSWERS ───────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS session_answers (
        id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        session_id          UUID         NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        project_id          UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        question_number     INTEGER,
        question_text       TEXT,
        question_type       VARCHAR(50),
        answer_value        TEXT,
        answer_label        TEXT,
        ai_mode             VARCHAR(20),
        ai_confidence       NUMERIC(5,2),
        ai_reasoning        TEXT,
        library_entry_id    UUID         REFERENCES response_library_entries(id),
        human_handled       BOOLEAN      DEFAULT false,
        time_on_question_s  INTEGER,
        page_timer_detected BOOLEAN      DEFAULT false,
        page_timer_value_s  INTEGER,
        created_at          TIMESTAMPTZ  DEFAULT NOW()
      )
    `);

    // ─── SESSION EVENTS ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS session_events (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        session_id   UUID        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        event_type   VARCHAR(50) NOT NULL,
        page_number  INTEGER,
        details      JSONB       DEFAULT '{}',
        created_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ─── INDEXES ───────────────────────────────────────────────────────────
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_projects_workspace   ON projects(workspace_id)`,
      `CREATE INDEX IF NOT EXISTS idx_projects_status      ON projects(status)`,
      `CREATE INDEX IF NOT EXISTS idx_personas_workspace   ON personas(workspace_id)`,
      `CREATE INDEX IF NOT EXISTS idx_quota_cells_project  ON quota_cells(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_quota_cells_status   ON quota_cells(status)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_project     ON sessions(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_status      ON sessions(status)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_persona     ON sessions(persona_id)`,
      `CREATE INDEX IF NOT EXISTS idx_session_answers_sess ON session_answers(session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_session_events_sess  ON session_events(session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_proxy_ips_project    ON proxy_used_ips(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace ON audit_logs(workspace_id)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_logs_user      ON audit_logs(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_lib_entries_project  ON response_library_entries(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_lib_entries_used     ON response_library_entries(is_used)`,
    ];

    for (const idx of indexes) {
      await client.query(idx);
    }

    // ─── DEFAULT WORKSPACE ─────────────────────────────────────────────────
    await client.query(`
      INSERT INTO workspaces (name, slug, timezone)
      VALUES ('INJ Technologies', 'inj-technologies', 'Asia/Kolkata')
      ON CONFLICT (slug) DO NOTHING
    `);

    await client.query('COMMIT');

    console.log('✅ Migration complete — all tables created');

    // Show what was created
    const tables = await pool.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    console.log('📋 Tables in database:');
    tables.rows.forEach(r => console.log(`   • ${r.tablename}`));

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { migrate };