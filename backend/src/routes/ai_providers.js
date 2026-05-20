'use strict';
const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  getProviders, getProviderById, createProvider,
  updateProvider, deleteProvider,
} = require('../db/ai_providers');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const providers = await getProviders(req.user.workspace_id);
    res.json({ providers });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch AI providers' });
  }
});

router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { name, providerType, secretName, model, baseUrl, isDefault } = req.body;
    if (!name || !providerType || !secretName || !model)
      return res.status(400).json({ error: 'name, providerType, secretName and model are required' });
    const provider = await createProvider({
      workspaceId: req.user.workspace_id,
      name, providerType, secretName, model, baseUrl, isDefault,
    });
    res.status(201).json({ provider });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', requireRole('admin'), async (req, res) => {
  try {
    const provider = await updateProvider(
      req.params.id, req.user.workspace_id, req.body
    );
    if (!provider) return res.status(404).json({ error: 'Provider not found' });
    res.json({ provider });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    await deleteProvider(req.params.id, req.user.workspace_id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;