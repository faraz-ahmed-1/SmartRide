require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(bodyParser.json());
app.use(cors());

// Serve frontend files (for HTML, CSS, JS)
app.use(express.static(path.join(__dirname, "public")));

// ✅ Database connection (works locally + on Railway)
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT
});

db.connect((err) => {
  if (err) {
    console.error("❌ Database connection failed:", err);
  } else {
    console.log("✅ Connected to MySQL Database");
  }
});

// --- Sign Up API ---
app.post('/api/signup', async (req, res) => {
  try {
    const { name, email, contact, gender, role } = req.body;

    if (!name || !email || !contact || !gender || !role) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // 1️⃣ Check if user already exists
    const checkSql = `SELECT * FROM Users WHERE email = ? OR contact = ?`;
    db.query(checkSql, [email, contact], async (err, results) => {
      if (err) {
        console.error('Error checking user:', err);
        return res.status(500).json({ error: 'Server error' });
      }
      if (results.length > 0) {
        return res.status(400).json({ error: 'User already exists' });
      }

      // 3️⃣ Insert new user
      const insertSql = `
        INSERT INTO Users (Name, Email, Contact, Gender, Role)
        VALUES (?, ?, ?, ?, ?)
      `;
      db.query(insertSql, [name, email, contact, gender, role], (err, result) => {
        if (err) {
          console.error('Error inserting user:', err);
          return res.status(500).json({ error: 'Failed to add user' });
        }
        res.status(201).json({ message: 'User added successfully', userId: result.insertId });
      });
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});