// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const pool = require('./db'); 

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));


async function initDb() {
  console.log('Initializing database tables if not exist...');

  // subjects table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS subjects (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      totalClasses INT NOT NULL DEFAULT 0,
      present INT NOT NULL DEFAULT 0,
      absent INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB;
  `);

  // students table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS students (
      id INT AUTO_INCREMENT PRIMARY KEY,
      enroll_id VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL
    ) ENGINE=InnoDB;
  `);

  // attendance_records table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS attendance_records (
      id INT AUTO_INCREMENT PRIMARY KEY,
      studentId INT NOT NULL,
      enroll_id VARCHAR(255) NOT NULL,
      subjectId INT NOT NULL,
      subjectName VARCHAR(255) NOT NULL,
      date DATE NOT NULL,
      status ENUM('present','absent') NOT NULL,
      UNIQUE KEY uniq_att (studentId, subjectId, date),
      CONSTRAINT fk_att_student FOREIGN KEY (studentId)
        REFERENCES students(id) ON DELETE CASCADE,
      CONSTRAINT fk_att_subject FOREIGN KEY (subjectId)
        REFERENCES subjects(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  console.log('DB init done ✅');
}

// ---------- Health / debug ----------
app.get('/ping', (req, res) => res.json({ ok: true }));

app.get('/debug/db', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS ok');
    res.json({ ok: true, db: rows[0] });
  } catch (err) {
    console.error('DB debug error:', err.code, err.sqlMessage || err.message);
    res.status(500).json({ ok: false, error: 'DB error', detail: err.message });
  }
});

// ---------- Subjects ----------
app.get('/api/subjects', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, totalClasses, present, absent FROM subjects ORDER BY id DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/subjects error:', err.code, err.sqlMessage || err.message);
    res.status(500).json({ error: 'DB error' });
  }
});

app.post('/api/subjects', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  try {
    const [result] = await pool.execute(
      'INSERT INTO subjects (name) VALUES (?)',
      [name]
    );
    const [rows] = await pool.execute(
      'SELECT id, name, totalClasses, present, absent FROM subjects WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Subject exists' });
    }
    console.error('POST /api/subjects error:', err.code, err.sqlMessage || err.message);
    res.status(500).json({ error: 'DB error' });
  }
});

app.delete('/api/subjects/:id', async (req, res) => {
  const id = req.params.id;
  try {
    await pool.execute('DELETE FROM subjects WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/subjects/:id error:', err.code, err.sqlMessage || err.message);
    res.status(500).json({ error: 'DB error' });
  }
});

// ---------- Students ----------
app.get('/api/students', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, enroll_id, name FROM students ORDER BY name'
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/students error:', err.code, err.sqlMessage || err.message);
    res.status(500).json({ error: 'DB error' });
  }
});

app.post('/api/students', async (req, res) => {
  const { enroll_id, name } = req.body;
  if (!enroll_id || !name) {
    return res.status(400).json({ error: 'enroll_id and name required' });
  }

  try {
    const [result] = await pool.execute(
      'INSERT INTO students (enroll_id, name) VALUES (?, ?)',
      [enroll_id, name]
    );
    const [rows] = await pool.execute(
      'SELECT id, enroll_id, name FROM students WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'enroll_id exists' });
    }
    console.error('POST /api/students error:', err.code, err.sqlMessage || err.message);
    res.status(500).json({ error: 'DB error' });
  }
});

app.delete('/api/students/:id', async (req, res) => {
  const id = req.params.id;
  try {
    await pool.execute('DELETE FROM students WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/students/:id error:', err.code, err.sqlMessage || err.message);
    res.status(500).json({ error: 'DB error' });
  }
});

// ---------- Subject-wise students + status for date ----------
app.get('/api/subjects/:subjectId/students', async (req, res) => {
  const subjectId = req.params.subjectId;
  const date = req.query.date;

  try {
    const [students] = await pool.execute(
      'SELECT id, enroll_id, name FROM students ORDER BY name'
    );

    if (!date) {
      return res.json(students.map(s => ({ ...s, status: null })));
    }

    const [att] = await pool.execute(
      'SELECT studentId, status FROM attendance_records WHERE subjectId = ? AND date = ?',
      [subjectId, date]
    );

    const map = Object.fromEntries(att.map(r => [r.studentId, r.status]));

    res.json(
      students.map(s => ({
        id: s.id,
        enroll_id: s.enroll_id,
        name: s.name,
        status: map[s.id] || null
      }))
    );
  } catch (err) {
    console.error('GET /api/subjects/:subjectId/students error:', err.code, err.sqlMessage || err.message);
    res.status(500).json({ error: 'DB error' });
  }
});

// ---------- Attendance single insert ----------
app.post('/api/attendance', async (req, res) => {
  const { studentId, subjectId, date, status } = req.body;
  if (!studentId || !subjectId || !date || !status) {
    return res.status(400).json({ error: 'studentId, subjectId, date, status required' });
  }
  if (!['present', 'absent'].includes(status)) {
    return res.status(400).json({ error: 'invalid status' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [sRows] = await conn.execute(
      'SELECT enroll_id FROM students WHERE id = ?',
      [studentId]
    );
    if (!sRows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'student not found' });
    }
    const enroll_id = sRows[0].enroll_id;

    const [subRows] = await conn.execute(
      'SELECT name FROM subjects WHERE id = ?',
      [subjectId]
    );
    if (!subRows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'subject not found' });
    }
    const subjectName = subRows[0].name;

    await conn.execute(
      'INSERT INTO attendance_records (studentId, enroll_id, subjectId, subjectName, date, status) VALUES (?, ?, ?, ?, ?, ?)',
      [studentId, enroll_id, subjectId, subjectName, date, status]
    );

    const presentInc = status === 'present' ? 1 : 0;
    const absentInc = status === 'absent' ? 1 : 0;

    await conn.execute(
      'UPDATE subjects SET totalClasses = totalClasses + 1, present = present + ?, absent = absent + ? WHERE id = ?',
      [presentInc, absentInc, subjectId]
    );

    await conn.commit();
    res.status(201).json({ ok: true });
  } catch (err) {
    if (conn) await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Attendance already marked for this student/subject/date' });
    }
    console.error('POST /api/attendance error:', err.code, err.sqlMessage || err.message);
    res.status(500).json({ error: 'DB error' });
  } finally {
    if (conn) conn.release();
  }
});

// ---------- Attendance bulk ----------
app.post('/api/attendance/bulk', async (req, res) => {
  const { subjectId, date, records } = req.body;
  if (!subjectId || !date || !Array.isArray(records)) {
    return res.status(400).json({ error: 'subjectId, date, records required' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [subRows] = await conn.execute(
      'SELECT name FROM subjects WHERE id = ?',
      [subjectId]
    );
    if (!subRows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'subject not found' });
    }
    const subjectName = subRows[0].name;

    let inserted = 0, presentCount = 0, absentCount = 0;

    for (const r of records) {
      const { studentId, status } = r;
      if (!studentId || !['present', 'absent'].includes(status)) continue;

      const [sRows] = await conn.execute(
        'SELECT enroll_id FROM students WHERE id = ?',
        [studentId]
      );
      if (!sRows.length) continue;
      const enroll_id = sRows[0].enroll_id;

      try {
        await conn.execute(
          'INSERT INTO attendance_records (studentId, enroll_id, subjectId, subjectName, date, status) VALUES (?, ?, ?, ?, ?, ?)',
          [studentId, enroll_id, subjectId, subjectName, date, status]
        );
        inserted++;
        if (status === 'present') presentCount++;
        else absentCount++;
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') {
          // skip duplicate for that student/subject/date
        } else {
          throw e;
        }
      }
    }

    await conn.execute(
      'UPDATE subjects SET totalClasses = totalClasses + ?, present = present + ?, absent = absent + ? WHERE id = ?',
      [inserted, presentCount, absentCount, subjectId]
    );

    await conn.commit();
    res.json({ ok: true, inserted, presentCount, absentCount });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('POST /api/attendance/bulk error:', err.code, err.sqlMessage || err.message);
    res.status(500).json({ error: 'Bulk insert failed' });
  } finally {
    if (conn) conn.release();
  }
});

// ---------- Attendance history ----------
app.get('/api/attendance', async (req, res) => {
  const { subjectId, studentId } = req.query;

  try {
    let q = `
      SELECT id, studentId, enroll_id, subjectId, subjectName,
             DATE_FORMAT(date, "%Y-%m-%d") AS date, status
      FROM attendance_records
    `;
    const params = [];
    const where = [];

    if (subjectId) {
      where.push('subjectId = ?');
      params.push(subjectId);
    }
    if (studentId) {
      where.push('studentId = ?');
      params.push(studentId);
    }
    if (where.length) {
      q += ' WHERE ' + where.join(' AND ');
    }
    q += ' ORDER BY date DESC';

    const [rows] = await pool.execute(q, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/attendance error:', err.code, err.sqlMessage || err.message);
    res.status(500).json({ error: 'DB error' });
  }
});

// ---------- Delete single attendance record ----------
app.delete('/api/attendance/:id', async (req, res) => {
  const id = req.params.id;

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      'SELECT id, subjectId, status FROM attendance_records WHERE id = ?',
      [id]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Record not found' });
    }
    const rec = rows[0];

    await conn.execute('DELETE FROM attendance_records WHERE id = ?', [id]);

    const presentDec = rec.status === 'present' ? 1 : 0;
    const absentDec = rec.status === 'absent' ? 1 : 0;

    await conn.execute(
      'UPDATE subjects SET totalClasses = GREATEST(0, totalClasses - 1), present = GREATEST(0, present - ?), absent = GREATEST(0, absent - ?) WHERE id = ?',
      [presentDec, absentDec, rec.subjectId]
    );

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('DELETE /api/attendance/:id error:', err.code, err.sqlMessage || err.message);
    res.status(500).json({ error: 'Delete failed' });
  } finally {
    if (conn) conn.release();
  }
});

// ---------- Bulk delete attendance by subjectId+date ----------
app.delete('/api/attendance', async (req, res) => {
  const { subjectId, studentId, date } = req.query;
  if (!subjectId || !date) {
    return res.status(400).json({ error: 'subjectId and date required' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    let q = 'SELECT id, status FROM attendance_records WHERE subjectId = ? AND date = ?';
    const params = [subjectId, date];

    if (studentId) {
      q += ' AND studentId = ?';
      params.push(studentId);
    }

    const [rows] = await conn.execute(q, params);
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'No records found' });
    }

    let delCount = 0, presentCount = 0, absentCount = 0;
    const ids = [];

    for (const r of rows) {
      ids.push(r.id);
      delCount++;
      if (r.status === 'present') presentCount++;
      else if (r.status === 'absent') absentCount++;
    }

    await conn.execute(
      `DELETE FROM attendance_records WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids
    );

    await conn.execute(
      'UPDATE subjects SET totalClasses = GREATEST(0, totalClasses - ?), present = GREATEST(0, present - ?), absent = GREATEST(0, absent - ?) WHERE id = ?',
      [delCount, presentCount, absentCount, subjectId]
    );

    await conn.commit();
    res.json({
      ok: true,
      deleted: delCount,
      presentRemoved: presentCount,
      absentRemoved: absentCount
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('DELETE /api/attendance (bulk) error:', err.code, err.sqlMessage || err.message);
    res.status(500).json({ error: 'Bulk delete failed' });
  } finally {
    if (conn) conn.release();
  }
});

// ---------- Start server AFTER DB init ----------
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to init DB:', err);
    process.exit(1);
  });
