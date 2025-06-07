const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = 3000;
const HOST = '0.0.0.0'; // ★ 중요: 외부에서 접근 가능하게

app.use(cors({
  origin: "https://capstone-rust-nu.vercel.app",
}));
app.use(express.json()); // POST, PATCH 요청 본문(JSON) 파싱

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PW,
  port: 5432,
  max: 20,
  ssl: {
      rejectUnauthorized: false, // SSL 인증서 문제를 해결하기 위한 설정
    },
});

// GET API
// Management Data API
app.get('/api/management', async (req, res) => {
  // Management
const msql = `
    SELECT 
    m.id,
    mk.name AS name,
    t.type_name AS type,
    m.date,
    m.shake_date,
    CONCAT(p.name, ' ', f.number, '층') AS location,
    m.status
    FROM 
    management m
    JOIN marker mk ON m.marker_id = mk.id
    JOIN types t ON mk.ckey = t.id
    JOIN floors f ON mk.fkey = f.name
    JOIN place p ON f.building_name = p.alias
    ORDER BY m.id;
  `;

  try {
    console.time("Query: /api/management");
    const result = await pool.query(msql);
    console.timeEnd("Query: /api/management");
    res.json(result.rows);
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'DB query failed' });
  }
});

// Place Data API
app.get('/api/places', async (req, res) => {
  // Place
  const psql = `
    SELECT alias, name, lat, lng, maxfloor
    FROM place;
  `;

  try {
    const result = await pool.query(psql);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching places:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Marker Data API
app.get('/api/marker', async (req, res) => {
  const mksql = `
    SELECT m.x, m.y, m.name, f.number AS floor
    FROM marker m
    JOIN floors f ON m.fkey = f.name;
  `;
  
  try {
    const result = await pool.query(mksql);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching places:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Category Data API
app.get('/api/category', async (req, res) => {
  const { type } = req.query; // 쿼리에서 type 받기
  console.log("Received /api/category with type:", type);

  if (!type) {
    return res.status(400).json({ error: "Missing type parameter" });
  }

  const typeId = parseInt(type, 10);
  if (isNaN(typeId)) {
    return res.status(400).json({ error: "Invalid type parameter" });
  }

  try {
    // types 테이블 조회는 생략해도 됨, 바로 category에서 조회
    const result = await pool.query(
      `SELECT
        id,
        name,
        lat as latitude,
        lng as longitude,
        type
      FROM category
      WHERE type = $1`,
      [typeId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No places found for this category" });
    }

    const places = result.rows.map(row => ({
      name: row.name,
      type: row.type,
      latitude: parseFloat(row.latitude),
      longitude: parseFloat(row.longitude),
    }));

    res.json({ places });
  } catch (err) {
    console.error("Category search failed:", err);
    res.status(500).json({
      error: "Category search failed",
      details: err.message,
    });
  }
});

// Management 데이터 수정 API
app.put('/api/management/:id', async (req, res) => {
  const id = req.params.id;
  const { name, type_name, date, location, shake_date } = req.body;

  // 디버깅을 위한 로그 추가
  console.log("Received data:", { id, name, type_name, date, location, shake_date });
  console.log("Location type:", typeof location);
  console.log("Location value:", location);

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

    // location에서 건물명과 층수 분리 (예: "하워드관 1층" -> ["하워드관", "1"])
    const [building, floor] = location.split(' ');
    const floorNumber = floor.replace('층', '');

    // floor 테이블에서 해당 건물의 floor name 찾기
    const floorResult = await pool.query(
      `SELECT f.name 
       FROM floors f 
       JOIN place p ON f.building_name = p.alias 
       WHERE p.name = $1 AND f.number = $2`,
      [building, floorNumber]
    );

    if (floorResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid location' });
    }

    const floorName = floorResult.rows[0].name;

    // marker 테이블 업데이트
    const markerResult = await pool.query(
      `UPDATE marker 
       SET name = $1,
           ckey = $2,
           fkey = $3
       WHERE id = (
         SELECT marker_id 
         FROM management 
         WHERE id = $4
       )
       RETURNING id`,
      [name, typeId, floorName, id]
    );

    if (markerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Marker not found' });
    }

    // management 테이블 업데이트
    const result = await pool.query(
      `UPDATE management 
       SET date = $1,
           shake_date = $2
       WHERE id = $3
       RETURNING *`,
      [date, shake_date, id]
    );

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

// Management 데이터 삭제 API
app.delete('/api/management/:id', async (req, res) => {
  const id = req.params.id;
  console.log("삭제 요청 받음 - ID:", id);

  try {
    // 트랜잭션 시작
    await pool.query('BEGIN');

    // management 테이블에서 marker_id 가져오기
    const markerResult = await pool.query(
      'SELECT marker_id FROM management WHERE id = $1',
      [id]
    );

    if (markerResult.rows.length === 0) {
      console.log("해당 ID를 찾을 수 없음 : ", id);
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Item not found' });
    }

    const markerId = markerResult.rows[0].marker_id;

    // management 테이블에서 삭제
    await pool.query('DELETE FROM management WHERE id = $1', [id]);

    // marker 테이블에서 삭제
    await pool.query('DELETE FROM marker WHERE id = $1', [markerId]);

    // 트랜잭션 커밋
    await pool.query('COMMIT');

    res.json({ 
      status: 'success', 
      message: `ID ${id} deleted successfully` 
    });
  } catch (err) {
    // 에러 발생 시 롤백
    await pool.query('ROLLBACK');
    console.error("Delete failed:", err);
    res.status(500).json({ 
      status: 'error', 
      message: 'Delete failed', 
      details: err.message 
    });
  }
});

// 월별 움직임 데이터 API (shake_date 기준) Chart
app.get('/api/management/movement/:id', async (req, res) => {
  const { id } = req.params;

  // 관리 항목의 shake_date 조회
  const itemResult = await pool.query(
    'SELECT id, marker_id, status, shake_date FROM management WHERE id = $1',
    [id]
  );
  if (itemResult.rows.length === 0) {
    return res.status(404).json({ error: '관리 항목을 찾을 수 없습니다.' });
  }
  const { id: managementID, shake_date } = itemResult.rows[0];

  const shakeDate = itemResult.rows[0].shake_date;
  if (!shakeDate) {
    return res.status(400).json({ error: 'shake_date 값이 없습니다.' });
  }
  const startDate = new Date(shakeDate);
  if (isNaN(startDate.getTime())) {
    return res.status(400).json({ error: 'shake_date 값이 유효하지 않습니다.' });
  }

  // shake_date 기준 한 달 범위 계산
  //const startDate = new Date(shake_date);
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + 1);
  endDate.setDate(endDate.getDate() - 1); // shake_date + 1달 - 1일

  // 움직임 데이터 조회
  const result = await pool.query(
    `SELECT DISTINCT ON (DATE(record_at))
      status,
      DATE_TRUNC('month', record_at) as date,
      COUNT(*) as movement_count
     FROM management_history 
     WHERE management_id = $1 
     AND record_at BETWEEN $2 AND $3
     GROUP BY DATE(record_at), record_at
     ORDER BY date`,
    [managementID, startDate, endDate]
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
    name: `관리 ID ${id}`,
    shake_date: startDate,
    end_date: endDate
  });
});

// esp32 데이터 DB status, shake_date 반영
app.patch('/api/management/shake/:id', async (req, res) => {
  const id = req.params.id;
  const { status, shake_date } = req.body;

  console.log("🔵 PATCH 요청 수신");
  console.log("params.id:", id);
  console.log("body.status:", status);
  console.log("body.shake_date:", shake_date);

  try {
    if (typeof shake_date === 'number') {
      // 밀리초면 초로 변환
      if (shake_date > 9999999999) shake_date = new Date(shake_date);
      else shake_date = new Date(shake_date * 1000);
    }
    
    await pool.query(
      `UPDATE management
       SET status = $1,
           shake_date = $2
       WHERE id = $3`,
      [status, shake_date || new Date(), id]
    );

     await pool.query(
    `INSERT INTO management_history (management_id, status, record_at)
     VALUES ($1, $2, NOW())`,
    [id, status]
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
    const result = await pool.query("SELECT NOW()");
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

app.listen(port, HOST, () => {
  console.log(`Server running at ${HOST}:${port}`);
});
