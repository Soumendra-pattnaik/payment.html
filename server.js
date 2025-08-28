import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import path from "path";
import { fileURLToPath } from "url";

import db from "./db.js";

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

function createJwtToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

function getTokenFromRequest(req) {
  const authHeader = req.headers["authorization"]; 
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring("Bearer ".length);
  }
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }
  return null;
}

function authMiddleware(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function getUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email);
}

function getUserById(id) {
  return db.prepare("SELECT id, name, email, created_at FROM users WHERE id = ?").get(id);
}

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email and password are required" });
    }
    const existing = getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "Email already in use" });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const info = db.prepare(
      "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)"
    ).run(name, email, passwordHash);
    const userId = info.lastInsertRowid;
    const token = createJwtToken(userId);
    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    const user = getUserById(userId);
    return res.json({ user });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/auth/signin", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }
    const user = getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = createJwtToken(user.id);
    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    return res.json({ user: getUserById(user.id) });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/auth/signout", (req, res) => {
  res.clearCookie("token");
  return res.json({ ok: true });
});

app.get("/api/me", authMiddleware, (req, res) => {
  const user = getUserById(req.userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({ user });
});

// Notes endpoints
app.get("/api/notes", authMiddleware, (req, res) => {
  const rows = db.prepare(
    "SELECT id, title, content, created_at, updated_at FROM notes WHERE user_id = ? ORDER BY updated_at DESC"
  ).all(req.userId);
  return res.json({ notes: rows });
});

app.post("/api/notes", authMiddleware, (req, res) => {
  const { title, content } = req.body || {};
  if (!title || !content) {
    return res.status(400).json({ error: "title and content are required" });
  }
  const info = db.prepare(
    "INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)"
  ).run(req.userId, title, content);
  const note = db.prepare(
    "SELECT id, title, content, created_at, updated_at FROM notes WHERE id = ?"
  ).get(info.lastInsertRowid);
  return res.status(201).json({ note });
});

app.put("/api/notes/:id", authMiddleware, (req, res) => {
  const noteId = Number(req.params.id);
  const { title, content } = req.body || {};
  const existing = db.prepare(
    "SELECT id FROM notes WHERE id = ? AND user_id = ?"
  ).get(noteId, req.userId);
  if (!existing) return res.status(404).json({ error: "Note not found" });
  db.prepare(
    "UPDATE notes SET title = COALESCE(?, title), content = COALESCE(?, content) WHERE id = ? AND user_id = ?"
  ).run(title ?? null, content ?? null, noteId, req.userId);
  const updated = db.prepare(
    "SELECT id, title, content, created_at, updated_at FROM notes WHERE id = ?"
  ).get(noteId);
  return res.json({ note: updated });
});

app.delete("/api/notes/:id", authMiddleware, (req, res) => {
  const noteId = Number(req.params.id);
  const info = db.prepare(
    "DELETE FROM notes WHERE id = ? AND user_id = ?"
  ).run(noteId, req.userId);
  if (info.changes === 0) return res.status(404).json({ error: "Note not found" });
  return res.json({ ok: true });
});

// Tasks endpoints
app.get("/api/tasks", authMiddleware, (req, res) => {
  const rows = db.prepare(
    "SELECT id, title, completed, created_at, updated_at FROM tasks WHERE user_id = ? ORDER BY updated_at DESC"
  ).all(req.userId);
  return res.json({ tasks: rows });
});

app.post("/api/tasks", authMiddleware, (req, res) => {
  const { title } = req.body || {};
  if (!title) return res.status(400).json({ error: "title is required" });
  const info = db.prepare(
    "INSERT INTO tasks (user_id, title, completed) VALUES (?, ?, 0)"
  ).run(req.userId, title);
  const task = db.prepare(
    "SELECT id, title, completed, created_at, updated_at FROM tasks WHERE id = ?"
  ).get(info.lastInsertRowid);
  return res.status(201).json({ task });
});

app.put("/api/tasks/:id", authMiddleware, (req, res) => {
  const taskId = Number(req.params.id);
  const { title, completed } = req.body || {};
  const existing = db.prepare(
    "SELECT id FROM tasks WHERE id = ? AND user_id = ?"
  ).get(taskId, req.userId);
  if (!existing) return res.status(404).json({ error: "Task not found" });
  const completedValue = completed === undefined ? null : completed ? 1 : 0;
  db.prepare(
    "UPDATE tasks SET title = COALESCE(?, title), completed = COALESCE(?, completed) WHERE id = ? AND user_id = ?"
  ).run(title ?? null, completedValue, taskId, req.userId);
  const updated = db.prepare(
    "SELECT id, title, completed, created_at, updated_at FROM tasks WHERE id = ?"
  ).get(taskId);
  return res.json({ task: updated });
});

app.delete("/api/tasks/:id", authMiddleware, (req, res) => {
  const taskId = Number(req.params.id);
  const info = db.prepare(
    "DELETE FROM tasks WHERE id = ? AND user_id = ?"
  ).run(taskId, req.userId);
  if (info.changes === 0) return res.status(404).json({ error: "Task not found" });
  return res.json({ ok: true });
});

// Fallback route to serve index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/signin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "signin.html"));
});

app.get("/signup", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "signup.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

