'use strict';
const { pool } = require('./index');

const getProviders = async (workspaceId) => {
  const result = await pool.query(
    `SELECT id, name, provider_type, model, base_url, secret_name,
            is_active, is_default, created_at
     FROM ai_providers WHERE workspace_id = $1 ORDER BY created_at ASC`,
    [workspaceId]
  );
  return result.rows;
};

const getProviderById = async (id, workspaceId) => {
  const result = await pool.query(
    `SELECT * FROM ai_providers WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId]
  );
  return result.rows[0] || null;
};

// Used by worker — returns full API key
const getProviderByIdInternal = async (id) => {
  const result = await pool.query(
    `SELECT * FROM ai_providers WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
};

const getDefaultProvider = async (workspaceId) => {
  const result = await pool.query(
    `SELECT * FROM ai_providers
     WHERE workspace_id = $1 AND is_active = true AND is_default = true
     LIMIT 1`,
    [workspaceId]
  );
  return result.rows[0] || null;
};

const createProvider = async ({ workspaceId, name, providerType, secretName, model, baseUrl, isDefault }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (isDefault) {
      await client.query(
        `UPDATE ai_providers SET is_default = false WHERE workspace_id = $1`,
        [workspaceId]
      );
    }
    const result = await client.query(
      `INSERT INTO ai_providers (workspace_id, name, provider_type, secret_name, model, base_url, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, provider_type, model, base_url, secret_name, is_active, is_default, created_at`,
      [workspaceId, name, providerType, secretName, model, baseUrl || null, isDefault || false]
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

const updateProvider = async (id, workspaceId, { name, model, secretName, baseUrl, isActive, isDefault }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (isDefault) {
      await client.query(
        `UPDATE ai_providers SET is_default = false WHERE workspace_id = $1`,
        [workspaceId]
      );
    }
    const fields = ['updated_at = NOW()'];
    const vals = [id, workspaceId];
    let idx = 3;
    if (name       !== undefined) { fields.push(`name = $${idx++}`);        vals.push(name); }
    if (model      !== undefined) { fields.push(`model = $${idx++}`);       vals.push(model); }
    if (baseUrl    !== undefined) { fields.push(`base_url = $${idx++}`);    vals.push(baseUrl); }
    if (secretName !== undefined && secretName !== '') { fields.push(`secret_name = $${idx++}`);         vals.push(secretName); }
    if (isActive   !== undefined) { fields.push(`is_active = $${idx++}`);  vals.push(isActive); }
    if (isDefault  !== undefined) { fields.push(`is_default = $${idx++}`); vals.push(isDefault); }
    const result = await client.query(
      `UPDATE ai_providers SET ${fields.join(', ')} WHERE id = $1 AND workspace_id = $2
       RETURNING id, name, provider_type, model, base_url, secret_name, is_active, is_default`,
      vals
    );
    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

const deleteProvider = async (id, workspaceId) => {
  await pool.query(
    `DELETE FROM ai_providers WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId]
  );
};

module.exports = {
  getProviders, getProviderById, getProviderByIdInternal,
  getDefaultProvider, createProvider, updateProvider, deleteProvider,
};