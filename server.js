
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || "mowakal_secret_key_2026";

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "MOWAKAL backend يعمل بنجاح" });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, role, phone } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ status: "error", message: "الاسم والبريد وكلمة المرور مطلوبة" });
    }
    const [existing] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length > 0) {
      return res.status(409).json({ status: "error", message: "البريد الإلكتروني مستخدم مسبقًا" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      "INSERT INTO users (name, email, password, role, phone) VALUES (?, ?, ?, ?, ?)",
      [name, email, hashedPassword, role || "client", phone || null]
    );
    res.json({ status: "ok", message: "تم إنشاء الحساب بنجاح", userId: result.insertId });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    if (rows.length === 0) {
      return res.status(401).json({ status: "error", message: "البريد أو كلمة المرور غير صحيحة" });
    }
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ status: "error", message: "البريد أو كلمة المرور غير صحيحة" });
    }
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
    res.json({
      status: "ok",
      message: "تم تسجيل الدخول بنجاح",
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});
app.get("/api/lawyers", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM lawyers WHERE id IN (SELECT MIN(id) FROM lawyers GROUP BY license_number) ORDER BY id ASC");
    res.json({ status: "ok", lawyers: rows });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});
// إنشاء طلب استشارة جديد
app.post("/api/requests", async (req, res) => {
  try {
    const { client_id, lawyer_id, title, description, category } = req.body;
    if (!client_id || !title) {
      return res.status(400).json({ status: "error", message: "بيانات الطلب غير مكتملة" });
    }
    const [result] = await pool.query(
      "INSERT INTO requests (client_id, lawyer_id, title, description, category) VALUES (?, ?, ?, ?, ?)",
      [client_id, lawyer_id || null, title, description || null, category || null]
    );
    res.json({ status: "ok", message: "تم إرسال الطلب بنجاح", requestId: result.insertId });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

// طلبات عميل معين
app.get("/api/requests/client/:clientId", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.*, l.name AS lawyer_name FROM requests r
       LEFT JOIN lawyers l ON r.lawyer_id = l.id
       WHERE r.client_id = ? ORDER BY r.created_at DESC`,
      [req.params.clientId]
    );
    res.json({ status: "ok", requests: rows });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

// تحديث حالة الطلب
app.put("/api/requests/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    await pool.query("UPDATE requests SET status = ? WHERE id = ?", [status, req.params.id]);
    res.json({ status: "ok", message: "تم تحديث حالة الطلب" });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});
// إرسال رسالة جديدة
app.post("/api/messages", async (req, res) => {
  try {
    const { request_id, sender_id, sender_role, content } = req.body;
    if (!request_id || !sender_id || !content) {
      return res.status(400).json({ status: "error", message: "بيانات الرسالة غير مكتملة" });
    }
    const [result] = await pool.query(
      "INSERT INTO messages (request_id, sender_id, sender_role, content) VALUES (?, ?, ?, ?)",
      [request_id, sender_id, sender_role, content]
    );
    res.json({ status: "ok", message: "تم إرسال الرسالة", messageId: result.insertId });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

// جلب كل رسائل طلب معين
app.get("/api/messages/:requestId", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM messages WHERE request_id = ? ORDER BY created_at ASC",
      [req.params.requestId]
    );
    res.json({ status: "ok", messages: rows });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});
// حجز موعد جديد
app.post("/api/appointments", async (req, res) => {
  try {
    const { request_id, client_id, lawyer_id, appointment_date, notes } = req.body;
    if (!request_id || !client_id || !lawyer_id || !appointment_date) {
      return res.status(400).json({ status: "error", message: "بيانات الموعد غير مكتملة" });
    }
    const [result] = await pool.query(
      "INSERT INTO appointments (request_id, client_id, lawyer_id, appointment_date, notes) VALUES (?, ?, ?, ?, ?)",
      [request_id, client_id, lawyer_id, appointment_date, notes || null]
    );
    res.json({ status: "ok", message: "تم حجز الموعد بنجاح", appointmentId: result.insertId });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

// مواعيد عميل معين
app.get("/api/appointments/client/:clientId", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.*, l.name AS lawyer_name FROM appointments a
       LEFT JOIN lawyers l ON a.lawyer_id = l.id
       WHERE a.client_id = ? ORDER BY a.appointment_date ASC`,
      [req.params.clientId]
    );
    res.json({ status: "ok", appointments: rows });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});
// كل المستخدمين (للأدمن)
app.get("/api/admin/users", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, name, email, role, phone, created_at FROM users ORDER BY created_at DESC");
    res.json({ status: "ok", users: rows });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

// كل الطلبات مع أسماء العميل والمحامي (للأدمن)
app.get("/api/admin/requests", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.*, u.name AS client_name, l.name AS lawyer_name
       FROM requests r
       LEFT JOIN users u ON r.client_id = u.id
       LEFT JOIN lawyers l ON r.lawyer_id = l.id
       ORDER BY r.created_at DESC`
    );
    res.json({ status: "ok", requests: rows });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

// إحصائيات عامة (للأدمن)
app.get("/api/admin/stats", async (req, res) => {
  try {
    const [[{ totalUsers }]] = await pool.query("SELECT COUNT(*) AS totalUsers FROM users");
    const [[{ totalLawyers }]] = await pool.query("SELECT COUNT(*) AS totalLawyers FROM lawyers");
    const [[{ totalRequests }]] = await pool.query("SELECT COUNT(*) AS totalRequests FROM requests");
    const [[{ pendingRequests }]] = await pool.query("SELECT COUNT(*) AS pendingRequests FROM requests WHERE status = 'pending'");
    res.json({
      status: "ok",
      stats: { totalUsers, totalLawyers, totalRequests, pendingRequests }
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
