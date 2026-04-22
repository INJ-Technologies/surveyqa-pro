const { Worker } = require('bullmq');
const fs = require('fs');

const readSecret = (envVar) => {
  const filePath = process.env[envVar];
  if (filePath && fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8').trim();
  }
  return process.env[envVar.replace('_FILE', '')] || null;
};

const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: readSecret('REDIS_PASSWORD_FILE'),
};

console.log('SurveyQA Workers starting...');
console.log(`Redis: ${redisConnection.host}:${redisConnection.port}`);

const worker = new Worker('survey-sessions', async (job) => {
  console.log(`Processing job: ${job.id} | type: ${job.name}`);
  // Browser automation logic goes here in Phase 2
}, { connection: redisConnection });

worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed: ${err.message}`);
});

console.log('Workers ready and listening for jobs...');