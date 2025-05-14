const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = 3000;

app.use(cors());

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'capstone',
  password: '~al09490402',
  port: 5432,
});

const sql = `
    SELECT m.name, t.type_name, m."date", m.location, f.number
    FROM management m
    JOIN types t ON m.type_id = t.id
    JOIN floors f ON m.floor_id = f.name
    order by length(m.name), m.name
  `;
  module.exports = sql;

// GET API
app.get('/api/management', async (req, res) => {
  try {
    const result = await pool.query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'DB query failed' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
