'use strict';
const { pool } = require('./index');

// ─── Get all personas for a workspace ────────────────────────────────────────
const getPersonas = async (workspaceId) => {
  const result = await pool.query(
    `SELECT * FROM personas
     WHERE workspace_id = $1
     ORDER BY created_at DESC`,
    [workspaceId]
  );
  return result.rows;
};

// ─── Get single persona ───────────────────────────────────────────────────────
const getPersonaById = async (id, workspaceId) => {
  const result = await pool.query(
    `SELECT * FROM personas WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId]
  );
  return result.rows[0] || null;
};

// ─── Create persona ───────────────────────────────────────────────────────────
const createPersona = async ({
  workspaceId, createdBy, name, description, tags,
  ageMin, ageMax, gender, country, language,
  designation, department, companyRevenue, employeeSize,
  secondaryDescription, behaviouralTags,
  deviceType, deviceOs, browser, readingSpeed, responseStyle,
  customAttrs,
}) => {
  const result = await pool.query(
    `INSERT INTO personas (
       workspace_id, created_by, name, description, tags,
       age_min, age_max, gender, country, language,
       device_type,
       behavioural_attrs, custom_attrs
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      workspaceId, createdBy, name, description, tags || [],
      ageMin || null, ageMax || null,
      gender || null, country || null, language || 'en',
      deviceType || 'desktop',
      JSON.stringify({
        designation, department, companyRevenue, employeeSize,
        secondaryDescription, behaviouralTags: behaviouralTags || [],
        deviceOs, browser, readingSpeed, responseStyle,
      }),
      JSON.stringify(customAttrs || {}),
    ]
  );
  return result.rows[0];
};

// ─── Update persona ───────────────────────────────────────────────────────────
const updatePersona = async (id, workspaceId, updates) => {
  const result = await pool.query(
    `UPDATE personas SET
       name               = COALESCE($1, name),
       description        = COALESCE($2, description),
       tags               = COALESCE($3, tags),
       age_min            = COALESCE($4, age_min),
       age_max            = COALESCE($5, age_max),
       gender             = COALESCE($6, gender),
       country            = COALESCE($7, country),
       language           = COALESCE($8, language),
       device_type        = COALESCE($9, device_type),
       behavioural_attrs  = COALESCE($10, behavioural_attrs),
       custom_attrs       = COALESCE($11, custom_attrs),
       updated_at         = NOW()
     WHERE id = $12 AND workspace_id = $13
     RETURNING *`,
    [
      updates.name, updates.description, updates.tags,
      updates.ageMin, updates.ageMax, updates.gender,
      updates.country, updates.language, updates.deviceType,
      updates.behaviouralAttrs ? JSON.stringify(updates.behaviouralAttrs) : null,
      updates.customAttrs      ? JSON.stringify(updates.customAttrs)      : null,
      id, workspaceId,
    ]
  );
  return result.rows[0] || null;
};

// ─── Delete persona ───────────────────────────────────────────────────────────
const deletePersona = async (id, workspaceId) => {
  const result = await pool.query(
    `DELETE FROM personas WHERE id = $1 AND workspace_id = $2 RETURNING id`,
    [id, workspaceId]
  );
  return result.rows[0] || null;
};

module.exports = {
  getPersonas, getPersonaById,
  createPersona, updatePersona, deletePersona,
};