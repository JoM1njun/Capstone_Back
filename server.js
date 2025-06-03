const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json()); // POST, PATCH 요청 본문(JSON) 파싱

const pool = new Pool({
  user: 'capstone_db_owner',
  host: 'ep-winter-thunder-a4nlvdmy-pooler.us-east-1.aws.neon.tech',
  database: 'capstone_db',
  password: 'npg_zDJqaIkyg07j',
  port: 5432,
});

// Management
const msql = `
    SELECT m.id, m.name, t.type_name, m."date", m.location, m.status, m.shake_date, f.number
    FROM management m
    JOIN types t ON m.type_id = t.id
    JOIN floors f ON m.floor_id = f.name
    order by length(m.name), m.name
  `;

  // Place
  const psql = `
    SELECT alias, name, lat, lng, maxfloor
    FROM place;
  `;

  module.exports = {
    msql,
    psql
  }

console.log('server.js 시작됨');

app.get('/', (req, res) => {
  console.log("Get 요청 받음");
  res.send('Hello from Node.js server!');
});

// GET API
// Management Data
app.get('/api/management', async (req, res) => {
  try {
    const result = await pool.query(msql);
    res.json(result.rows);
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'DB query failed' });
  }
});

// Place Data
app.get('/api/places', async (req, res) => {
  try {
    const result = await pool.query(psql);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching places:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Management 데이터 수정 API
app.put('/api/management/:id', async (req, res) => {
  const id = req.params.id;
  const { name, type_name, date, location, shake_date } = req.body;

  try {
    // type_name으로 type_id를 찾는 쿼리
    const typeResult = await pool.query(
      'SELECT id FROM types WHERE type_name = $1',
      [type_name]
    );

    if (typeResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid type_name' });
    }

    const typeId = typeResult.rows[0].id;

    // management 테이블 업데이트
    const result = await pool.query(
      `UPDATE management 
       SET name = $1,
           type_id = $2,
           date = $3,
           location = $4,
           shake_date = $5
       WHERE id = $6`,
      [name, typeId, date, location, shake_date, id]
    );

    // if (result.rows.length === 0) {
    //   return res.status(404).json({ error: 'Item not found' });
    // }

    console.log("Update successful:", result.rows[0]);
    res.json({ 
      status: 'success', 
      message: `ID ${id} updated`,
      data: result.rows[0]
    });
  } catch (err) {
    console.error("Update failed:", err);
    res.status(500).json({ 
      status: 'error', 
      message: 'Update failed', 
      details: err.message
    });
  }
});

// 월별 움직임 데이터 API (shake_date 기준)
app.get('/api/management/movement/:id', async (req, res) => {
  const { id } = req.params;

  // 관리 항목의 shake_date 조회
  const itemResult = await pool.query(
    'SELECT name, shake_date FROM management WHERE id = $1',
    [id]
  );
  if (itemResult.rows.length === 0) {
    return res.status(404).json({ error: '관리 항목을 찾을 수 없습니다.' });
  }
  const { name, shake_date } = itemResult.rows[0];

  // shake_date 기준 한 달 범위 계산
  const startDate = new Date(shake_date);
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + 1);
  endDate.setDate(endDate.getDate() - 1); // shake_date + 1달 - 1일

  // 움직임 데이터 조회
  const result = await pool.query(
    `SELECT 
      DATE_TRUNC('day', created_at) as date,
      COUNT(*) as movement_count
     FROM movements 
     WHERE name = $1 
     AND created_at BETWEEN $2 AND $3
     GROUP BY DATE_TRUNC('day', created_at)
     ORDER BY date`,
    [name, startDate, endDate]
  );

  // 날짜별 데이터 포맷팅
  const labels = [];
  const values = [];
  const daysInMonth = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

  for (let i = 0; i < daysInMonth; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    labels.push(`${date.getMonth() + 1}/${date.getDate()}`);
    values.push(0);
  }

  result.rows.forEach(row => {
    const d = new Date(row.date);
    const idx = Math.round((d - startDate) / (1000 * 60 * 60 * 24));
    values[idx] = row.movement_count;
  });

  const maxValue = Math.max(...values);
  const normalizedValues = values.map(v => maxValue > 0 ? v / maxValue : 0);

  res.json({
    labels,
    values: normalizedValues,
    rawValues: values,
    maxValue,
    name,
    shake_date: startDate,
    end_date: endDate
  });
});

// esp32 데이터 DB status, shake_date 반영
app.patch('/api/management/shake/:id', async (req, res) => {
  const id = req.params.id;
  const { status, shake_date } = req.body;

  try {
    await pool.query(
      `UPDATE management
       SET status = $1,
           shake_date = $2
       WHERE id = $3`,
      [status, shake_date || new Date(), id]
    );

    res.json({ status: 'success', message: `ID ${id} updated` });
  } catch (err) {
    console.error("Update failed:", err);
    res.status(500).json({ status: 'error', message: 'Update failed' });
  }
});


// DB Connenct
app.get("/api/db-connect", async (req, res) => {
  try {
    // 간단한 쿼리로 연결 확인 (예: 현재 시간 가져오기)
    const result = await queryDB("SELECT NOW()");
    console.log("DB Connected");
    res.json({
      status: "success",
      message: "DB Connected",
      time: result.rows[0].now,
    });
  } catch (err) {
    console.error("Connect Failed", err);
    res.status(500).json({ status: "error", message: "Connect Failed" });
  }
});

const server = app.listen(port, '0.0.0.0', () => {
  const addr = server.address();
  console.log(`Server running at http://{addr.address}:${port}`);
});
