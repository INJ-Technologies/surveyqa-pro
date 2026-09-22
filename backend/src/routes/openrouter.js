'use strict';
const express = require('express');
const fs      = require('fs');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  getActiveModels, getModelById,
  activateModel, updateModel,
  deactivateModel, setDefaultModel,
} = require('../db/ai_models');

const router = express.Router();
router.use(requireAuth);

// ─── Read OpenRouter API key from Docker secret ───────────────────────────────
const getORKey = () => {
  try {
    return fs.readFileSync('/run/secrets/openrouter_synthfield', 'utf8').trim();
  } catch {
    return null;
  }
};

// ─── Text-capable model filter ────────────────────────────────────────────────
const EXCLUDED_PATTERNS = [
  'dall-e', 'whisper', 'embedding', 'tts', 'stable-diffusion',
  'midjourney', 'sdxl', 'imagen', 'musicgen', 'audio',
];

const isTextModel = (model) => {
  const id = (model.id || '').toLowerCase();
  if (EXCLUDED_PATTERNS.some(p => id.includes(p))) return false;
  const modalities = model.architecture?.input_modalities || [];
  // Must support text input
  return modalities.includes('text') || modalities.length === 0;
};

// ─── GET /api/openrouter/models — fetch live from OpenRouter ─────────────────
router.get('/models', async (req, res) => {
  const apiKey = getORKey();
  if (!apiKey) return res.status(500).json({ error: 'OpenRouter API key not configured' });

  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer':  'https://surveyqa.pro',
        'X-Title':       'SurveyQA Pro',
      },
    });

    if (!response.ok) {
      return res.status(502).json({ error: `OpenRouter returned ${response.status}` });
    }

    const data = await response.json();
    const allModels = data.data || [];

    // Filter to text-capable only
    const textModels = allModels
      .filter(isTextModel)
      .map(m => ({
        id:                   m.id,
        name:                 m.name || m.id,
        provider:             (m.id || '').split('/')[0] || 'Unknown',
        context_length:       m.context_length || 0,
        input_price_per_1m:   parseFloat(m.pricing?.prompt   || 0) * 1_000_000,
        output_price_per_1m:  parseFloat(m.pricing?.completion|| 0) * 1_000_000,
        supports_reasoning:   !!(m.supported_parameters?.includes('reasoning') ||
                                 m.id.includes('thinking') ||
                                 m.id.includes('o1') ||
                                 m.id.includes('o3')),
        supports_vision:      (m.architecture?.input_modalities || []).includes('image'),
        description:          m.description || '',
        top_provider:         m.top_provider || {},
      }))
      .sort((a, b) => a.input_price_per_1m - b.input_price_per_1m);

    res.json({ models: textModels, total: textModels.length });

  } catch (err) {
    console.error('[OpenRouter] Fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch models from OpenRouter' });
  }
});

// ─── GET /api/openrouter/active — list activated models ──────────────────────
router.get('/active', async (req, res) => {
  try {
    const models = await getActiveModels(req.user.workspace_id);
    res.json({ models });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch active models' });
  }
});

// ─── POST /api/openrouter/activate — activate a model ────────────────────────
router.post('/activate', requireRole('admin'), async (req, res) => {
  try {
    const {
      modelId, displayName, provider,
      inputPricePer1m, outputPricePer1m,
      contextLength, supportsReasoning,
      reasoningLevel, notes,
    } = req.body;

    if (!modelId || !displayName) {
      return res.status(400).json({ error: 'modelId and displayName are required' });
    }

    const model = await activateModel({
      workspaceId:       req.user.workspace_id,
      modelId,
      displayName,
      provider:          provider || modelId.split('/')[0],
      inputPricePer1m:   parseFloat(inputPricePer1m  || 0),
      outputPricePer1m:  parseFloat(outputPricePer1m || 0),
      contextLength:     parseInt(contextLength || 0),
      supportsReasoning: !!supportsReasoning,
      reasoningLevel:    reasoningLevel || 'off',
      notes:             notes || '',
    });

    res.status(201).json({ model });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/openrouter/active/:id — update an activated model ─────────────
router.patch('/active/:id', requireRole('admin'), async (req, res) => {
  try {
    const model = await updateModel(
      req.params.id,
      req.user.workspace_id,
      req.body
    );
    if (!model) return res.status(404).json({ error: 'Model not found' });
    res.json({ model });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/openrouter/active/:id/set-default ─────────────────────────────
router.post('/active/:id/set-default', requireRole('admin'), async (req, res) => {
  try {
    await setDefaultModel(req.params.id, req.user.workspace_id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/openrouter/active/:id — deactivate a model ──────────────────
router.delete('/active/:id', requireRole('admin'), async (req, res) => {
  try {
    await deactivateModel(req.params.id, req.user.workspace_id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/openrouter/estimate — cost estimate for a session ───────────────
router.get('/estimate', async (req, res) => {
  try {
    const { modelId, questionCount = 20, avgInputTokens = 1200, avgOutputTokens = 150 } = req.query;

    const models = await getActiveModels(req.user.workspace_id);
    const model  = modelId
      ? models.find(m => m.model_id === modelId)
      : models.find(m => m.is_default) || models[0];

    if (!model) return res.status(404).json({ error: 'No active model found' });

    const qCount   = parseInt(questionCount);
    const inTok    = parseInt(avgInputTokens);
    const outTok   = parseInt(avgOutputTokens);

    const perCallInputCost  = (inTok  / 1_000_000) * parseFloat(model.input_price_per_1m);
    const perCallOutputCost = (outTok / 1_000_000) * parseFloat(model.output_price_per_1m);
    const perCallTotal      = perCallInputCost + perCallOutputCost;
    const sessionTotal      = perCallTotal * qCount;

    res.json({
      model: {
        id:           model.model_id,
        display_name: model.display_name,
        input_price_per_1m:  parseFloat(model.input_price_per_1m),
        output_price_per_1m: parseFloat(model.output_price_per_1m),
      },
      assumptions: { questionCount: qCount, avgInputTokens: inTok, avgOutputTokens: outTok },
      per_question: {
        input_cost_usd:  perCallInputCost,
        output_cost_usd: perCallOutputCost,
        total_usd:       perCallTotal,
      },
      per_session: {
        total_input_tokens:  inTok  * qCount,
        total_output_tokens: outTok * qCount,
        total_usd:           sessionTotal,
      },
      per_100_sessions: { total_usd: sessionTotal * 100 },
      per_1000_sessions:{ total_usd: sessionTotal * 1000 },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;