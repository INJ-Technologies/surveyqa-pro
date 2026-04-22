const express = require('express');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Helper to read Docker secrets
const readSecret = (envVar) => {
  const filePath = process.env[envVar];
  if (filePath && fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8').trim();
  }
  return process.env[envVar.replace('_FILE', '')] || null;
};

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'surveyqa-backend',
    time: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Root catch
app.get('/api', (req, res) => {
  res.json({ message: 'SurveyQA Pro API is running' });
});

app.listen(PORT, () => {
  console.log(`SurveyQA Backend running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});