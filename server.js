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
      Users.Contact,
      Users.Gender,
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

    // ⚠️ Plain text check (hashing recommended later)
    if (user.Password !== password) {
      return res.status(401).json({
        success: false,
        message: "Invalid password"
      });
    }

    // ✅ Check if profile exists
    const verifyProfileSql = `SELECT ID FROM Profile WHERE UserID = ?`;

    db.query(verifyProfileSql, [user.ID], (err, profileResult) => {
      if (err) {
        console.error("❌ Profile check error:", err);
        return res.status(500).json({
          success: false,
          message: "Server error"
        });
      }

      // ✅ Create profile if missing
      if (profileResult.length === 0) {
        const insertProfileSql = `
          INSERT INTO Profile (UserID, Name, Contact, Email, Address, City)
          VALUES (?, ?, ?, ?, ?, ?)
        `;

        db.query(
          insertProfileSql,
          [user.ID, user.Name, user.Contact, user.Email, null, null],
          (err) => {
            if (err) {
              console.error("❌ Profile insert error:", err);
              return res.status(500).json({
                success: false,
                message: "Failed to create profile"
              });
            }

            // ✅ Send response AFTER profile creation
            return res.json({
              success: true,
              user: {
                id: user.ID,
                name: user.Name,
                email: user.Email,
                role: user.Role
              }
            });
          }
        );
      } else {
        // ✅ Profile already exists
        return res.json({
          success: true,
          user: {
            id: user.ID,
            name: user.Name,
            email: user.Email,
            role: user.Role
          }
        });
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

app.post("/api/reset-password", async (req, res) => {
  const { UserEmail, newPass } = req.body;
console.log("req.body: ", req.body);

    const [result] = await db.promise().query(
      "SELECT ID FROM Users WHERE Email = ?",
      [UserEmail]
    );
    const userID = result[0].ID;

  db.query(
    "UPDATE Passwords SET Password=? WHERE UserID=?",
    [newPass, userID],
    (err) => {
      if (err) {
        return res.json({ success: false });
      }
      res.json({ success: true });
    }
  );
});

// GET WALLET DETAILS
app.get("/api/wallet", (req, res) => {
  const userId = req.query.userId;
  console.log("userId: ", userId);

  // Check if wallet exists
  db.query(
    "SELECT * FROM Wallet WHERE UserID = ?",
    [userId],
    (err, walletResult) => {
      if (err) return res.status(500).json(err);
      // If wallet doesn't exist, create one
      if (walletResult.length == 0) {
        db.query(
          "INSERT INTO Wallet (UserID, Balance) VALUES (?, 0)",
          [userId],
          () => {
            return res.json({ balance: 0, transactions: [] });
          }
        );
      } else {
        const wallet = walletResult[0];

        // Get transactions
        db.query(
          "SELECT * FROM WalletTransactions WHERE WalletID = ? ORDER BY CreatedAt DESC",
          [wallet.WalletID],
          (err, txResult) => {
            if (err) return res.status(500).json(err);

            res.json({
              balance: wallet.Balance,
              transactions: txResult
            });
          }
        );
      }
    }
  );
});

// ADD MONEY TO WALLET
app.post("/api/wallet/add", (req, res) => {
  const { userId, amount } = req.body;
console.log("req.body: ", req.body);
  if (!amount || amount <= 0) {
    return res.status(400).json({ message: "Invalid amount" });
  }

  // Get wallet
  db.query(
    "SELECT * FROM Wallet WHERE UserID = ?",
    [userId],
    (err, walletResult) => {
      if (err) return res.status(500).json(err);
      if (walletResult.length === 0) {
        return res.status(404).json({ message: "Wallet not found" });
      }

      const wallet = walletResult[0];
      const newBalance = Number(wallet.Balance) + Number(amount);

      // Update balance
      db.query(
        "UPDATE Wallet SET Balance = ? WHERE WalletID = ?",
        [newBalance, wallet.WalletID],
        (err) => {
          if (err) return res.status(500).json(err);

          // Insert transaction
          db.query(
            "INSERT INTO WalletTransactions (WalletID, Amount, Type) VALUES (?, ?, 'CREDIT')",
            [wallet.WalletID, amount],
            () => {
              res.json({ message: "Wallet updated successfully" });
            }
          );
        }
      );
    }
  );
});

app.get("/api/profile", (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ message: "UserID is required" });
  }

  db.query(
    `SELECT 
      p.ID AS ID,
      u.ID AS UserID,
      p.Name AS Name,
      u.Contact As Contact,
      u.Gender AS Gender,
      u.Email AS Email,
      u.Role AS Role,
      p.Address AS Address,
      p.City AS City
     FROM Profile p
     JOIN Users u ON u.ID = p.UserID
     WHERE u.ID = ?`,
    [userId],
    (err, result) => {
      if (err) {
        console.error("PROFILE FETCH ERROR:", err);
        return res.status(500).json({ error: err.message });
      }

      if (result.length === 0) {
        return res.status(404).json({ message: "Profile not found" });
      }

      res.json(result[0]);
    }
  );
});

app.post("/api/profile/update", (req, res) => {
  const { userId, name, address, city } = req.body;

  if (!userId || !name) {
    return res.status(400).json({
      message: "UserID and Name are required"
    });
  }

  // 1️⃣ Update Profile table
  const updateProfileSql = `
    UPDATE Profile
    SET Name = ?, Address = ?, City = ?
    WHERE UserID = ?
  `;

  db.query(updateProfileSql, [name, address || null, city || null, userId], (err, result) => {
    if (err) {
      console.error("❌ PROFILE UPDATE ERROR:", err);

      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          message: "Email or Contact already exists"
        });
      }

      return res.status(500).json({
        message: "Failed to update profile"
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Profile not found"
      });
    }

    // 2️⃣ Update Users table
    const updateUsersSql = `
      UPDATE Users
      SET Name = ?
      WHERE ID = ?
    `;

    db.query(updateUsersSql, [name, userId], (err2) => {
      if (err2) {
        console.error("❌ USERS UPDATE ERROR:", err2);
        return res.status(500).json({
          message: "Failed to update user name"
        });
      }

      // ✅ Respond after both updates succeed
      return res.json({
        message: "Profile updated successfully"
      });
    });
  });
});

/* ---------------- Start Local Server ---------------- */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Local server running at http://localhost:${PORT}`);
});