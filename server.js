import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import dotenv from "dotenv";
dotenv.config();

console.log("EMAIL_USER =", process.env.EMAIL_USER);
console.log("EMAIL_PASS =", process.env.EMAIL_PASS ? "LOADED" : "MISSING");

import express from "express";
import mysql from "mysql2";
import cors from "cors";


const app = express();
import { transporter } from "./mailer.js";

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
  const { name, email, contact, gender, role, vehicleNumber } = req.body;

  // 🔹 Basic validation
  if (!name || !email || !contact || !gender || !role) {
    return res.status(400).json({ error: "All fields are required" });
  }

  // 🔹 Vehicle required only for drivers
  if (role === "Driver" && !vehicleNumber) {
    return res.status(400).json({ error: "Vehicle registration is required for drivers" });
  }

  // 🔍 Check if user already exists
  const checkSql = `
    SELECT id FROM Users WHERE Email = ? OR Contact = ?
  `;

  db.query(checkSql, [email, contact], (err, results) => {
    if (err) {
      console.error("❌ Check user error:", err);
      return res.status(500).json({ error: "Server error" });
    }

    if (results.length > 0) {
      return res.status(409).json({ error: "User already exists" });
    }

    // 🧾 Insert into Users table
    const insertUserSql = `
      INSERT INTO Users (Name, Email, Contact, Gender, Role)
      VALUES (?, ?, ?, ?, ?)
    `;

    db.query(
      insertUserSql,
      [name, email, contact, gender, role],
      (err, result) => {
        if (err) {
          console.error("❌ Insert user error:", err);
          return res.status(500).json({ error: "Failed to add user" });
        }

        const userId = result.insertId; // ✅ Retrieved UserID

        // 🚗 If role is Driver → insert into Drivers table
        if (role === "Driver") {
          const insertDriverSql = `
            INSERT INTO Drivers (UserID, VehicleRegistration)
            VALUES (?, ?)
          `;

          db.query(
            insertDriverSql,
            [userId, vehicleNumber],
            (err) => {
              if (err) {
                console.error("❌ Insert driver error:", err);
                return res.status(500).json({ error: "Failed to add driver details" });
              }

              return res.status(201).json({
                message: "Driver registered successfully",
                userId
              });
            }
          );
        } else {
          // 🧍 Passenger response
          return res.status(201).json({
            message: "User registered successfully",
            userId
          });
        }
      }
    );
  });
});

/* ---------------- PASSWORD API ---------------- */
app.post("/api/password", (req, res) => {
  const { userId, password } = req.body;

  // Basic validation
  if (!userId || !password) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  // Optional length check (matches frontend)
  if (password.length < 8 || password.length > 18) {
    return res.status(400).json({
      success: false,
      message: "Password must be 8–18 characters"
    });
  }

  // Check if password already exists (because UNIQUE)
  const checkSql = `
    SELECT ID FROM Passwords WHERE Password = ?
  `;

  db.query(checkSql, [password], (err, result) => {
    if (err) {
      console.error("❌ Password check error:", err);
      return res.status(500).json({ success: false });
    }

    if (result.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Password already in use"
      });
    }

    // Insert password
    const insertSql = `
      INSERT INTO Passwords (UserID, Password)
      VALUES (?, ?)
    `;

    db.query(insertSql, [userId, password], (err) => {
      if (err) {
        console.error("❌ Password insert error:", err);
        return res.status(500).json({ success: false });
      }

      res.status(201).json({
        success: true,
        message: "Password saved successfully"
      });
    });
  });
});

/* ---------------- LOGIN API ---------------- */
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required"
    });
  }

  const sql = `
    SELECT 
      Users.ID,
      Users.Name,
      Users.Email,
      Users.Role,
      Passwords.Password
    FROM Users
    JOIN Passwords ON Users.ID = Passwords.UserID
    WHERE Users.Email = ?
  `;

  db.query(sql, [email], (err, results) => {
    if (err) {
      console.error("❌ Login SQL Error:", err);
      return res.status(500).json({
        success: false,
        message: "Server error"
      });
    }

    if (results.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Email not found"
      });
    }

    const user = results[0];

    // Plain text password check
    if (user.Password !== password) {
      return res.status(401).json({
        success: false,
        message: "Invalid password"
      });
    }

    res.json({
      success: true,
      user: {
        id: user.ID,
        name: user.Name,
        email: user.Email,
        role: user.Role
      }
    });
  });
});

app.post("/api/reset-email", async (req, res) => {
  const { email } = req.body;
console.log("Email: ", email);
  try {
    const [rows] = await db.promise().query(
      "SELECT ID FROM Users WHERE Email = ?",
      [email]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Email not found" });
    }

    const userId = rows[0].ID;
    const otp = Math.floor(100000 + Math.random() * 900000);

    const [row] = await db.promise().query(
      "INSERT INTO OTPs(UserID, OTP) VALUES (?, ?)",
      [userId, otp]
    );

    const mailOptions = {
      from: `"SmartRide" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "SmartRide - Password Reset OTP",
      html: `
        <h2>Password Reset</h2>
        <p>Your OTP is:</p>
        <h1>${otp}</h1>
        <p>This OTP is valid for 5 minutes.</p>
      `
    };

    await transporter.sendMail(mailOptions);

    console.log("✅ OTP sent to:", email, "OTP:", otp);

    res.json({ success: true, userId });

  } catch (error) {
    console.error("❌ Reset email error:", error);
    res.status(500).json({ success: false });
  }
});

app.post("/api/verify-otp", async (req, res) => {
  const { UserEmail, otp } = req.body;
  console.log("req.body: ", req.body);
    const [rows] = await db.promise().query(
      "SELECT ID FROM Users WHERE Email = ?",
      [UserEmail]
    );

    const userId = rows[0].ID;
    console.log(userId);
    const [result] = await db.promise().query(
      "SELECT OTP FROM OTPs WHERE UserID = ?",
      [userId]
    );
    const OTP = result[0].OTP;
    console.log(result[0].OTP);
    console.log(OTP);
    console.log(otp);
  if (OTP == otp) {
    console.log("OTP Verified");
    const [row] = await db.promise().query(
      "DELETE FROM OTPs WHERE UserID = ?",
      [userId]
    );
    return res.json({ success: true });
  }

  res.json({ success: false });
});

app.post("/api/reset-password", (req, res) => {
  const { userId, password } = req.body;

  db.query(
    "UPDATE Passwords SET Password=? WHERE UserID=?",
    [password, userId],
    (err) => {
      if (err) {
        return res.json({ success: false });
      }
      res.json({ success: true });
    }
  );
});

/* ---------------- Start Local Server ---------------- */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Local server running at http://localhost:${PORT}`);
});