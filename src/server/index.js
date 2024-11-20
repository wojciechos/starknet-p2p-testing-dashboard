import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// PostgreSQL connection
const pool = new Pool({
  user: process.env.POSTGRES_USER,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  port: process.env.POSTGRES_PORT || 5432,
});

// Create table if it doesn't exist
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS test_runs (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
    process.exit(1);
  }
}

const app = express();
const PORT = 3322;

const clients = new Set();

// Serve static files from the dist directory
app.use(express.static(join(__dirname, '../../dist')));

app.use(express.json());

// Enable CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Modified SSE endpoint
app.get('/events', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send initial data from PostgreSQL
  try {
    const result = await pool.query('SELECT data FROM test_runs');
    const initialData = result.rows.map(row => row.data);
    res.write(`data: ${JSON.stringify({ type: 'initial', data: initialData })}\n\n`);
  } catch (error) {
    console.error('Error fetching initial data:', error);
  }

  clients.add(res);
  req.on('close', () => clients.delete(res));
});

// Serve index.html for all routes
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../../dist/index.html'));
});

function broadcastUpdate(data) {
  clients.forEach(client => {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

// Modified update endpoint
app.post('/update', async (req, res) => {
  const update = req.body;
  
  try {
    if (update.type === 'newTest' || update.type === 'updateTest') {
      await pool.query(
        'INSERT INTO test_runs (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2',
        [update.data.id, update.data]
      );
    }
    
    broadcastUpdate(update);
    res.sendStatus(200);
  } catch (error) {
    console.error('Error updating data:', error);
    res.sendStatus(500);
  }
});

// Initialize the database and start the server
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});