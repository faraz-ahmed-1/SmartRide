// server.js (LOCAL + ENV)

require("dotenv").config();
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const path = require("path");

const app = express();

/* ---------------- Middleware ---------------- */
app.use(cors());
app.use(express.json());

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

/* ---------------- MySQL (Local via ENV) ---------------- */
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT)
});

db.connect((err) => {
  if (err) {
    console.error("❌ MySQL connection failed:", err.message);
    return;
  }
  console.log("✅ Connected to local MySQL database");
});

/* ---------------- Sign Up API ---------------- */
app.post("/api/signup", (req, res) => {
  const { name, email, contact, gender, role } = req.body;

  if (!name || !email || !contact || !gender || !role) {
    return res.status(400).json({ error: "All fields are required" });
  }

  const checkSql =
    "SELECT id FROM Users WHERE Email = ? OR Contact = ?";

  db.query(checkSql, [email, contact], (err, results) => {
    if (err) {
      console.error("❌ Check user error:", err);
      return res.status(500).json({ error: "Server error" });
    }

    if (results.length > 0) {
      return res.status(409).json({ error: "User already exists" });
    }

    const insertSql = `
      INSERT INTO Users (Name, Email, Contact, Gender, Role)
      VALUES (?, ?, ?, ?, ?)
    `;

    db.query(insertSql, [name, email, contact, gender, role], (err, result) => {
      if (err) {
        console.error("❌ Insert error:", err);
        return res.status(500).json({ error: "Failed to add user" });
      }

      res.status(201).json({
        message: "User registered successfully",
        userId: result.insertId
      });
    });
  });
});

/* ---------------- Start Local Server ---------------- */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Local server running at http://localhost:${PORT}`);
});