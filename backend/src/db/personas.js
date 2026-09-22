'use strict';
const { pool } = require('./index');

// ─── Helper: build behavioural_attrs from flat form fields ────────────────────
// The frontend sends flat fields. This packages them into the JSONB column.
const buildBehaviouralAttrs = (fields) => ({
  designation:          fields.designation          || null,
  department:           fields.department           || null,
  industry:             fields.industry             || null,
  companyRevenue:       fields.companyRevenue        || null,
  employeeSize:         fields.employeeSize          || null,
  annualIncome:         fields.annualIncome          || null,
  educationLevel:       fields.educationLevel        || null,
  maritalStatus:        fields.maritalStatus         || null,
  childrenStatus:       fields.childrenStatus        || null,
  secondaryDescription: fields.secondaryDescription  || null,
  behaviouralTags:      Array.isArray(fields.behaviouralTags) ? fields.behaviouralTags : [],
  deviceOs:             fields.deviceOs              || null,
  browser:              fields.browser               || 'Chrome',
  readingSpeed:         fields.readingSpeed          || 'Normal — average reading pace',
  responseStyle:        fields.responseStyle         || 'Neutral — balanced, moderate responses',
});

// ─── GET all personas for workspace ──────────────────────────────────────────
const getPersonas = async (workspaceId) => {
  const { rows } = await pool.query(
    `SELECT * FROM personas
     WHERE workspace_id = $1 AND is_active = true
     ORDER BY created_at DESC`,
    [workspaceId]
  );
  return rows;
};

// ─── GET single persona ───────────────────────────────────────────────────────
const getPersonaById = async (id, workspaceId) => {
  const { rows } = await pool.query(
    `SELECT * FROM personas WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId]
  );
  return rows[0] || null;
};

// ─── CREATE persona ───────────────────────────────────────────────────────────
const createPersona = async (fields) => {
  const {
    workspaceId, createdBy,
    name, tags = [], country, language,
    ageMin, ageMax, gender,
    deviceType = 'desktop',
    aiGenerated = false,
  } = fields;

  const behaviouralAttrs = buildBehaviouralAttrs(fields);

  const { rows } = await pool.query(
    `INSERT INTO personas (
       workspace_id, created_by,
       name, tags, country, language,
       age_min, age_max, gender,
       device_type, behavioural_attrs,
       ai_generated
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      workspaceId, createdBy || null,
      name,
      Array.isArray(tags) ? tags : [],
      country  || null,
      language || 'en',
      ageMin   ? parseInt(ageMin)  : null,
      ageMax   ? parseInt(ageMax)  : null,
      gender   || null,
      deviceType,
      JSON.stringify(behaviouralAttrs),
      !!aiGenerated,
    ]
  );
  return rows[0];
};

// ─── UPDATE persona ───────────────────────────────────────────────────────────
// Accepts flat form fields from the frontend and rebuilds behavioural_attrs
const updatePersona = async (id, workspaceId, fields) => {
  const {
    name, tags, country, language,
    ageMin, ageMax, gender,
    deviceType, aiGenerated,
  } = fields;

  // Always rebuild behavioural_attrs from the full form payload
  // This is the key fix: previously only top-level columns were updated,
  // leaving behavioural_attrs (designation, description, etc.) stale
  const behaviouralAttrs = buildBehaviouralAttrs(fields);

  const updates = [];
  const values  = [];
  let   idx     = 1;

  const set = (col, val) => { updates.push(`${col} = $${idx++}`); values.push(val); };

  if (name        !== undefined) set('name',       name);
  if (tags        !== undefined) set('tags',       Array.isArray(tags) ? tags : []);
  if (country     !== undefined) set('country',    country    || null);
  if (language    !== undefined) set('language',   language   || 'en');
  if (ageMin      !== undefined) set('age_min',    ageMin     ? parseInt(ageMin) : null);
  if (ageMax      !== undefined) set('age_max',    ageMax     ? parseInt(ageMax) : null);
  if (gender      !== undefined) set('gender',     gender     || null);
  if (deviceType  !== undefined) set('device_type', deviceType || 'desktop');
  if (aiGenerated !== undefined) set('ai_generated', !!aiGenerated);

  // Always update behavioural_attrs when form fields are present
  set('behavioural_attrs', JSON.stringify(behaviouralAttrs));
  set('updated_at', new Date().toISOString());

  if (updates.length === 0) return null;

  values.push(id, workspaceId);
  const { rows } = await pool.query(
    `UPDATE personas
     SET ${updates.join(', ')}
     WHERE id = $${idx++} AND workspace_id = $${idx}
     RETURNING *`,
    values
  );
  return rows[0] || null;
};

// ─── DELETE (soft) ────────────────────────────────────────────────────────────
const deletePersona = async (id, workspaceId) => {
  const { rows } = await pool.query(
    `UPDATE personas SET is_active = false, updated_at = NOW()
     WHERE id = $1 AND workspace_id = $2
     RETURNING id`,
    [id, workspaceId]
  );
  return rows[0] || null;
};

module.exports = {
  getPersonas, getPersonaById,
  createPersona, updatePersona, deletePersona,
};