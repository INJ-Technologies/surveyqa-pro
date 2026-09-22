'use strict';
const express = require('express');
const fs      = require('fs');
const {
  getPersonas, getPersonaById,
  createPersona, updatePersona, deletePersona,
} = require('../db/personas');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ─── Read OpenRouter API key ──────────────────────────────────────────────────
const getORKey = () => {
  try { return fs.readFileSync('/run/secrets/openrouter_synthfield', 'utf8').trim(); } catch { return null; }
};

// ─── GET /api/personas ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const personas = await getPersonas(req.user.workspace_id);
    res.json({ personas });
  } catch (err) {
    console.error('Get personas error:', err.message);
    res.status(500).json({ error: 'Failed to fetch personas' });
  }
});

// ─── GET /api/personas/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const persona = await getPersonaById(req.params.id, req.user.workspace_id);
    if (!persona) return res.status(404).json({ error: 'Persona not found' });
    res.json({ persona });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch persona' });
  }
});

// ─── POST /api/personas/generate-description — AI generates persona bio ───────
// Receives structured persona fields, returns a rich behavioural description.
router.post('/generate-description', async (req, res) => {
  const apiKey = getORKey();
  if (!apiKey) return res.status(500).json({ error: 'AI API key not configured' });

  const {
    name, country, language, ageMin, ageMax, gender,
    designation, department, industry, companyRevenue, employeeSize,
    annualIncome, educationLevel, maritalStatus, childrenStatus,
    behaviouralTags = [],
  } = req.body;

  if (!name) return res.status(400).json({ error: 'Persona name is required' });

  const isB2B = !!(designation || department || industry);

  const prompt = `You are writing a detailed persona brief for a market research respondent. This brief will be used by an AI to simulate this person's behaviour when answering online surveys — so it must be specific, realistic, and internally consistent.

PERSONA FIELDS PROVIDED:
Name / Label: ${name}
Country: ${country || 'Not specified'}
Language: ${language || 'English'}
Age Range: ${ageMin && ageMax ? `${ageMin}–${ageMax} years` : ageMin ? `${ageMin}+ years` : 'Not specified'}
Gender: ${gender || 'Not specified'}
Education: ${educationLevel || 'Not specified'}
Marital Status: ${maritalStatus || 'Not specified'}
Children / Dependants: ${childrenStatus || 'Not specified'}
Annual Income: ${annualIncome || 'Not specified'}
${isB2B ? `Designation / Job Title: ${designation || 'Not specified'}
Function / Department: ${department || 'Not specified'}
Industry: ${industry || 'Not specified'}
Company Revenue: ${companyRevenue || 'Not specified'}
Company Size (employees): ${employeeSize || 'Not specified'}` : 'Persona Type: B2C / Consumer (no company affiliation)'}
Behavioural Tags: ${behaviouralTags.length > 0 ? behaviouralTags.join(', ') : 'Not specified'}

INSTRUCTIONS:
Write a 180–220 word persona description in the third person (e.g. "Rajiv is a..."). 

Include ALL of the following (adapt for B2B or B2C as relevant):
1. A realistic name and brief personal snapshot (age, location, life stage)
2. ${isB2B ? 'Professional role, responsibilities, team size, reporting line, and decision-making authority' : 'Daily lifestyle, occupation or life stage, and typical weekly routine'}
3. ${isB2B ? 'Business priorities, key pain points, and what success looks like in their role' : 'Consumer priorities, lifestyle goals, and key frustrations'}
4. Purchasing behaviour — what they buy, how they decide, how long consideration takes, who influences them
5. Brand and media preferences — specific brands they trust, media channels they use, how they research before buying
6. ${isB2B ? 'Technology posture — current tools/vendors, openness to new software, IT security stance' : 'Digital behaviour — social media habits, app usage, online vs offline preference'}
7. One specific opinion or attitude that a survey question might probe (e.g. their stance on sustainability, AI, data privacy, luxury vs value, etc.)

Do NOT use bullet points. Write in plain prose, as a character brief. Be specific with numbers and names where realistic. Do NOT mention this is an AI-generated persona.`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer':  'https://surveyqa.pro',
        'X-Title':       'SurveyQA Pro',
      },
      body: JSON.stringify({
        model:      'google/gemini-2.5-flash',
        max_tokens: 600,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('[Persona AI] OpenRouter error:', response.status, errData);
      return res.status(502).json({ error: 'AI service returned an error. Please try again.' });
    }

    const data = await response.json();
    const description = data.choices?.[0]?.message?.content?.trim() || '';
    if (!description) return res.status(500).json({ error: 'AI returned empty response. Please try again.' });

    res.json({ description });
  } catch (err) {
    console.error('[Persona AI] Generate description error:', err.message);
    res.status(500).json({ error: 'Failed to generate description' });
  }
});

// ─── POST /api/personas ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Persona name is required' });
    const persona = await createPersona({
      workspaceId: req.user.workspace_id,
      createdBy:   req.user.id,
      ...req.body,
    });
    res.status(201).json({ message: 'Persona created', persona });
  } catch (err) {
    console.error('Create persona error:', err.message);
    res.status(500).json({ error: 'Failed to create persona' });
  }
});

// ─── PATCH /api/personas/:id ──────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const persona = await updatePersona(req.params.id, req.user.workspace_id, req.body);
    if (!persona) return res.status(404).json({ error: 'Persona not found' });
    res.json({ message: 'Persona updated', persona });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update persona' });
  }
});

// ─── DELETE /api/personas/:id ─────────────────────────────────────────────────
router.delete('/:id', requireRole('admin', 'project_manager'), async (req, res) => {
  try {
    const deleted = await deletePersona(req.params.id, req.user.workspace_id);
    if (!deleted) return res.status(404).json({ error: 'Persona not found' });
    res.json({ message: 'Persona deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete persona' });
  }
});

module.exports = router;