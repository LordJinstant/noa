const express = require('express');
const http = require('http');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { Server } = require('socket.io');

// Load .env from the project folder (works even if process is started from another cwd)
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config(); // also allow default lookup

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'Jinjin28821.';
// Always resolve DB relative to this file so Contabo/PM2 cwd cannot break paths
const USERS_DB = path.isAbsolute(process.env.USERS_DB || '')
  ? process.env.USERS_DB
  : path.join(__dirname, process.env.USERS_DB || 'users.db');

// Contabo / Nginx reverse proxy
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));


app.get('/api/health', (req, res) => {
  const admins = [];
  let i = 1;
  while (process.env[`SUPER_ADMIN_${i}_USERNAME`]) {
    admins.push(process.env[`SUPER_ADMIN_${i}_USERNAME`]);
    i++;
  }
  let dbOk = false;
  try {
    usersDb.prepare('SELECT 1').get();
    dbOk = true;
  } catch (e) {}
  res.json({
    ok: true,
    time: new Date().toISOString(),
    db: dbOk ? 'ok' : 'fail',
    dbPath: USERS_DB,
    envLoaded: Boolean(process.env.JWT_SECRET) || admins.length > 0,
    superAdminsConfigured: admins,
    node: process.version,
    cwd: process.cwd(),
    dirname: __dirname
  });
});

app.get('/platform', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'platform.html'));
});

const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

const usersDb = new Database(USERS_DB);

usersDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    school TEXT DEFAULT 'Not specified',
    role TEXT NOT NULL DEFAULT 'student',
    bio TEXT DEFAULT '',
    image TEXT DEFAULT '',
    joined TEXT NOT NULL
  );
`);

const columns = usersDb.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);
if (!columns.includes('bio')) {
  usersDb.exec(`ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''`);
}
if (!columns.includes('image')) {
  usersDb.exec(`ALTER TABLE users ADD COLUMN image TEXT DEFAULT ''`);
}
if (!columns.includes('grade')) {
  usersDb.exec(`ALTER TABLE users ADD COLUMN grade TEXT DEFAULT ''`);
}
if (!columns.includes('owner_staff_id')) {
  usersDb.exec(`ALTER TABLE users ADD COLUMN owner_staff_id INTEGER`);
}
if (!columns.includes('phone')) {
  usersDb.exec(`ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''`);
}
if (!columns.includes('subjects')) {
  usersDb.exec(`ALTER TABLE users ADD COLUMN subjects TEXT DEFAULT '[]'`);
}

// Students following staff (also appear on that staff's student list)
usersDb.exec(`
  CREATE TABLE IF NOT EXISTS staff_follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    staff_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(student_id, staff_id)
  );
`);
try {
  usersDb.exec(`CREATE INDEX IF NOT EXISTS idx_staff_follows_staff ON staff_follows(staff_id)`);
  usersDb.exec(`CREATE INDEX IF NOT EXISTS idx_staff_follows_student ON staff_follows(student_id)`);
} catch (e) {}

// Assessments / scores table
usersDb.exec(`
  CREATE TABLE IF NOT EXISTS assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    student_name TEXT NOT NULL,
    grade TEXT,
    subject TEXT NOT NULL,
    score REAL NOT NULL,
    supposed_score REAL NOT NULL,
    percentage REAL NOT NULL,
    assessed_at TEXT NOT NULL,
    uploaded_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

usersDb.exec(`
  CREATE TABLE IF NOT EXISTS staff_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    student_name TEXT,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(staff_id, student_id)
  );
`);
try {
  usersDb.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_ratings_unique ON staff_ratings(staff_id, student_id)`);
} catch (e) {}


usersDb.exec(`
  CREATE TABLE IF NOT EXISTS msg_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'staff',
    owner_id INTEGER,
    owner_name TEXT DEFAULT '',
    title TEXT NOT NULL,
    closed INTEGER DEFAULT 0,
    created_by INTEGER,
    created_by_role TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

usersDb.exec(`
  CREATE TABLE IF NOT EXISTS msg_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL,
    sender_id INTEGER,
    sender_name TEXT DEFAULT '',
    sender_role TEXT DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    attachment_url TEXT DEFAULT '',
    attachment_name TEXT DEFAULT '',
    attachment_type TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);
try {
  const msgCols = usersDb.prepare(`PRAGMA table_info(msg_messages)`).all().map(c => c.name);
  if (!msgCols.includes('attachment_url')) usersDb.exec(`ALTER TABLE msg_messages ADD COLUMN attachment_url TEXT DEFAULT ''`);
  if (!msgCols.includes('attachment_name')) usersDb.exec(`ALTER TABLE msg_messages ADD COLUMN attachment_name TEXT DEFAULT ''`);
  if (!msgCols.includes('attachment_type')) usersDb.exec(`ALTER TABLE msg_messages ADD COLUMN attachment_type TEXT DEFAULT ''`);
  if (!msgCols.includes('reply_to_id')) usersDb.exec(`ALTER TABLE msg_messages ADD COLUMN reply_to_id INTEGER DEFAULT NULL`);
  // Remove empty ghost rows that inflate message counts
  usersDb.exec(`
    DELETE FROM msg_messages
    WHERE (body IS NULL OR trim(body) = '')
      AND (attachment_url IS NULL OR trim(attachment_url) = '')
  `);
} catch (e) {}

usersDb.exec(`
  CREATE TABLE IF NOT EXISTS msg_channel_reads (
    user_key TEXT NOT NULL,
    channel_id INTEGER NOT NULL,
    last_read_id INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_key, channel_id)
  );
`);

// Temporary mute: user cannot post messages until muted_until
usersDb.exec(`
  CREATE TABLE IF NOT EXISTS msg_mutes (
    user_id INTEGER PRIMARY KEY,
    muted_until TEXT NOT NULL,
    reason TEXT DEFAULT '',
    muted_by INTEGER,
    muted_by_name TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

function getActiveMsgMute(userId) {
  if (userId == null) return null;
  try {
    const row = usersDb.prepare(`SELECT * FROM msg_mutes WHERE user_id = ?`).get(Number(userId));
    if (!row || !row.muted_until) return null;
    const until = Date.parse(row.muted_until);
    if (!Number.isFinite(until) || until <= Date.now()) {
      usersDb.prepare(`DELETE FROM msg_mutes WHERE user_id = ?`).run(Number(userId));
      return null;
    }
    return row;
  } catch (e) {
    return null;
  }
}



// In-memory live class rooms: code -> { host, title, createdAt, sharedFile }

function resolveStaffDbId(decoded) {
  if (!decoded) return null;
  if (decoded.id && decoded.type !== 'admin') return Number(decoded.id);
  // admin-created staff may live in users table by username
  if (decoded.username) {
    const row = usersDb.prepare(
      `SELECT id, role FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)`
    ).get(decoded.username, decoded.username);
    if (row && String(row.role).toLowerCase() === 'staff') return Number(row.id);
  }
  return null;
}

function isStaffLikeRole(decoded) {
  const role = String(decoded.role || '').toLowerCase();
  return role === 'staff' || role === 'staff_pending';
}

function isAdminLikeRole(decoded) {
  const role = String(decoded.role || '').toLowerCase();
  return role === 'super_admin' || role === 'admin' || role === 'moderator' || decoded.type === 'admin';
}

const liveClasses = new Map();

/** Persist live/closed class sessions for admin monitoring */
function loadClassHistory() {
  try {
    const data = readJson('class-history.json');
    return Array.isArray(data.sessions) ? data.sessions : [];
  } catch (e) {
    return [];
  }
}
function saveClassHistory(sessions) {
  // Keep last ~500 sessions to avoid unbounded growth
  const trimmed = (sessions || []).slice(-500);
  writeJson('class-history.json', { sessions: trimmed });
}
function upsertClassHistory(entry) {
  const sessions = loadClassHistory();
  const idx = sessions.findIndex(s => String(s.code).toUpperCase() === String(entry.code).toUpperCase() && !s.endedAt);
  if (idx >= 0) {
    sessions[idx] = { ...sessions[idx], ...entry };
  } else {
    sessions.push(entry);
  }
  saveClassHistory(sessions);
}
function closeClassHistory(code) {
  const sessions = loadClassHistory();
  const upper = String(code).toUpperCase();
  let changed = false;
  sessions.forEach(s => {
    if (String(s.code).toUpperCase() === upper && !s.endedAt) {
      s.endedAt = new Date().toISOString();
      s.status = 'closed';
      changed = true;
    }
  });
  if (changed) saveClassHistory(sessions);
}



const resolveDataFile = (file) => {
  if (path.isAbsolute(file)) return file;
  return path.join(__dirname, file);
};

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(resolveDataFile(file), 'utf8'));
  } catch (e) {
    return String(file).includes('posts') ? { posts: [] } : { admins: [] };
  }
};

const writeJson = (file, data) => {
  fs.writeFileSync(resolveDataFile(file), JSON.stringify(data, null, 2));
};

// Safe bcrypt compare — never throws on plain-text / malformed env hashes
async function safeBcryptCompare(plain, hashed) {
  if (!plain || !hashed) return false;
  const h = String(hashed).trim();
  // If env still has a plain password (not a bcrypt hash), compare directly
  if (!h.startsWith('$2a$') && !h.startsWith('$2b$') && !h.startsWith('$2y$')) {
    console.warn('WARNING: password is not a bcrypt hash — using plain compare. Hash it for production.');
    return plain === h;
  }
  try {
    return await bcrypt.compare(plain, h);
  } catch (e) {
    console.error('bcrypt.compare failed:', e.message);
    return false;
  }
}

const tickets = [];

app.post('/api/register', async (req, res) => {
  const { username, password, name, school, email, grade, phone, gender, dob } = req.body;

  if (!username || !password || !name) {
    return res.status(400).json({ msg: 'Username, password and name are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ msg: 'Password must be at least 6 characters' });
  }

  try {
    const exists = usersDb.prepare(`
      SELECT id FROM users WHERE username = ? OR email = ?
    `).get(username, email || username);

    if (exists) {
      return res.status(409).json({ msg: 'Username or email already taken' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const joined = new Date().toISOString().split('T')[0];
    const gradeVal = (grade || '').toString().trim();

    usersDb.prepare(`
      INSERT INTO users (username, email, password, name, school, role, grade, joined)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      username,
      email || username,
      hashedPassword,
      name,
      school || 'Not specified',
      'student',
      gradeVal,
      joined
    );

    return res.status(201).json({
      msg: 'Account created successfully! You can now login.',
      user: { name, username, role: 'student', grade: gradeVal, school: school || 'Not specified' }
    });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ msg: 'Server error' });
  }
});

app.post('/api/register-staff', upload.single('image'), async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim();
  const phone = (req.body.phone || '').trim();
  const bio = (req.body.bio || '').trim();

  if (!name || !email || !phone) {
    return res.status(400).json({ msg: 'Name, email and phone are required' });
  }

  try {
    const exists = usersDb.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
    if (exists) return res.status(409).json({ msg: 'Email already registered' });

    const joined = new Date().toISOString().split('T')[0];
    const defaultPassword = await bcrypt.hash('staff12345', 10);
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : '';

    const info = usersDb.prepare(`
      INSERT INTO users (username, email, password, name, school, role, bio, image, joined)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(email, email, defaultPassword, name, phone, 'staff_pending', bio, imageUrl, joined);

    tickets.unshift({
      id: Date.now(),
      type: 'staff_application',
      title: 'New Staff Application',
      message: `${name} has submitted a staff application.`,
      name,
      email,
      phone,
      bio,
      staffId: info.lastInsertRowid,
      status: 'pending',
      time: new Date().toLocaleString()
    });

    return res.status(201).json({
      msg: 'Application submitted successfully. We will contact you.',
      staffId: info.lastInsertRowid
    });
  } catch (err) {
    console.error('Register staff error:', err);
    return res.status(500).json({ msg: 'Server error: ' + err.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password, type } = req.body;

  if (!username || !password) {
    return res.status(400).json({ msg: 'Username/email and password are required' });
  }

  // type is UI hint: "admin" | "student" | "staff"
  const loginHint = String(type || '').toLowerCase();
  const ident = String(username).trim();
  const identLower = ident.toLowerCase();

  try {
    // 1) Env super admins
    const superAdmins = [];
    let i = 1;
    while (process.env[`SUPER_ADMIN_${i}_USERNAME`]) {
      superAdmins.push({
        username: process.env[`SUPER_ADMIN_${i}_USERNAME`],
        email: process.env[`SUPER_ADMIN_${i}_EMAIL`],
        name: process.env[`SUPER_ADMIN_${i}_NAME`],
        password: process.env[`SUPER_ADMIN_${i}_PASSWORD`]
      });
      i++;
    }
    const superAdmin = superAdmins.find(a =>
      (a.username && String(a.username).toLowerCase() === identLower) ||
      (a.email && String(a.email).toLowerCase() === identLower)
    );
    if (superAdmin) {
      const match = await safeBcryptCompare(password, superAdmin.password);
      if (!match) return res.status(401).json({ msg: 'Invalid credentials' });
      const token = jwt.sign(
        { id: 1, username: superAdmin.username, role: 'super_admin', type: 'admin' },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      return res.json({
        token,
        user: {
          id: 1,
          name: superAdmin.name || 'Super Admin',
          username: superAdmin.username,
          role: 'super_admin',
          type: 'admin',
          avatar: '',
          image: '',
          joined: ''
        }
      });
    }

    // 2) Admin / Moderator from Create New Admin (admins.json)
    const data = readJson('admins.json');
    const adminAccount = (data.admins || []).find(u =>
      (u.username && String(u.username).toLowerCase() === identLower) ||
      (u.email && String(u.email).toLowerCase() === identLower)
    );
    if (adminAccount) {
      const match = await safeBcryptCompare(password, adminAccount.password);
      if (!match) return res.status(401).json({ msg: 'Invalid credentials' });
      const role = String(adminAccount.role || 'admin').toLowerCase();
      const token = jwt.sign(
        { id: adminAccount.id, username: adminAccount.username, role, type: 'admin' },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      const adminAvatar = adminAccount.image || adminAccount.img || adminAccount.avatar || '';
      return res.json({
        token,
        user: {
          id: adminAccount.id,
          name: adminAccount.name,
          username: adminAccount.username,
          email: adminAccount.email,
          role,
          type: 'admin',
          avatar: adminAvatar,
          image: adminAvatar,
          joined: adminAccount.createdAt ? String(adminAccount.createdAt).slice(0, 10) : ''
        }
      });
    }

    // 3) Staff (users table) — Login as Admin; frontend still routes to dashboard
    const staffAccount = usersDb.prepare(`
      SELECT * FROM users
      WHERE (lower(username) = lower(?) OR lower(email) = lower(?))
        AND lower(role) = 'staff'
    `).get(ident, ident);

    if (staffAccount && (loginHint === 'admin' || loginHint === 'staff' || !loginHint)) {
      const match = await safeBcryptCompare(password, staffAccount.password);
      if (!match) return res.status(401).json({ msg: 'Invalid credentials' });
      const token = jwt.sign(
        { id: staffAccount.id, username: staffAccount.username, role: 'staff', type: 'staff' },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      const staffAvatar = staffAccount.image || '';
      return res.json({
        token,
        user: {
          id: staffAccount.id,
          name: staffAccount.name,
          username: staffAccount.username,
          email: staffAccount.email,
          role: 'staff',
          type: 'staff',
          school: staffAccount.school,
          avatar: staffAvatar,
          image: staffAvatar,
          joined: staffAccount.joined || '',
          bio: staffAccount.bio || ''
        }
      });
    }

    // Admin button: do not accept pure students
    if (loginHint === 'admin') {
      return res.status(401).json({
        msg: 'Invalid credentials. Staff use Admin login; students use Student login.'
      });
    }

    // 4) Students (+ pending) on Student login
    const account = usersDb.prepare(`
      SELECT * FROM users
      WHERE (lower(username) = lower(?) OR lower(email) = lower(?))
        AND lower(role) IN ('student', 'staff_pending')
    `).get(ident, ident);

    if (!account) {
      return res.status(401).json({ msg: 'Invalid credentials' });
    }

    const match = await safeBcryptCompare(password, account.password);
    if (!match) return res.status(401).json({ msg: 'Invalid credentials' });

    const token = jwt.sign(
      { id: account.id, username: account.username, role: account.role, type: 'student' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const studentAvatar = account.image || '';
    return res.json({
      token,
      user: {
        id: account.id,
        name: account.name,
        username: account.username,
        email: account.email,
        role: account.role,
        type: 'student',
        school: account.school,
        grade: account.grade,
        avatar: studentAvatar,
        image: studentAvatar,
        joined: account.joined || ''
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ msg: 'Server error during login', detail: String(err.message || err) });
  }
});

/** Current user profile (includes avatar) — keeps ID card / sidebar in sync after login or photo updates */
app.get('/api/me', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const role = String(decoded.role || '').toLowerCase();
    const username = decoded.username;

    // Super admin from env
    if (role === 'super_admin') {
      return res.json({
        id: decoded.id || 1,
        name: process.env.SUPER_ADMIN_NAME || 'Super Admin',
        username: username || process.env.SUPER_ADMIN_USERNAME || '',
        email: process.env.SUPER_ADMIN_EMAIL || '',
        role: 'super_admin',
        type: 'admin',
        avatar: '',
        image: '',
        joined: ''
      });
    }

    // Admin / moderator from admins.json
    if (role === 'admin' || role === 'moderator' || decoded.type === 'admin') {
      const data = readJson('admins.json');
      const adminAccount = (data.admins || []).find(u =>
        (u.id != null && String(u.id) === String(decoded.id)) ||
        (u.username && String(u.username).toLowerCase() === String(username || '').toLowerCase())
      );
      if (adminAccount) {
        const adminAvatar = adminAccount.image || adminAccount.img || adminAccount.avatar || '';
        return res.json({
          id: adminAccount.id,
          name: adminAccount.name,
          username: adminAccount.username,
          email: adminAccount.email,
          role: String(adminAccount.role || role).toLowerCase(),
          type: 'admin',
          avatar: adminAvatar,
          image: adminAvatar,
          joined: adminAccount.createdAt ? String(adminAccount.createdAt).slice(0, 10) : ''
        });
      }
      // Fall through: may still be a users-table staff account that logged in with type admin
    }

    // Staff / student from users table
    let row = null;
    if (decoded.id != null) {
      row = usersDb.prepare(`
        SELECT id, username, email, name, school, role, bio, image, joined, grade, phone
        FROM users WHERE id = ?
      `).get(decoded.id);
    }
    if (!row && username) {
      row = usersDb.prepare(`
        SELECT id, username, email, name, school, role, bio, image, joined, grade, phone
        FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)
      `).get(username, username);
    }
    if (!row) {
      return res.status(404).json({ msg: 'User profile not found' });
    }

    const avatar = row.image || '';
    return res.json({
      id: row.id,
      name: row.name,
      username: row.username,
      email: row.email,
      role: row.role,
      type: String(row.role).toLowerCase() === 'staff' ? 'staff' : (decoded.type || 'student'),
      school: row.school,
      grade: row.grade || '',
      phone: row.phone || '',
      bio: row.bio || '',
      avatar,
      image: avatar,
      joined: row.joined || ''
    });
  } catch (err) {
    console.error('/api/me error:', err);
    return res.status(401).json({ msg: 'Invalid or expired token' });
  }
});

app.get('/api/admins', (req, res) => {
  try {
    const superAdmin = process.env.SUPER_ADMIN_USERNAME ? {
      id: 1,
      name: process.env.SUPER_ADMIN_NAME || 'Super Admin',
      email: process.env.SUPER_ADMIN_EMAIL || '',
      username: process.env.SUPER_ADMIN_USERNAME,
      role: 'super_admin',
      diamond: true,
      img: process.env.SUPER_ADMIN_IMG || null
    } : null;

    let otherAdmins = [];
    try {
      const data = readJson('admins.json');
      otherAdmins = (data.admins || []).map(a => ({
        id: a.id,
        username: a.username,
        email: a.email,
        name: a.name,
        role: a.role || 'admin',
        source: 'admins.json',
        img: a.image || a.img || a.avatar || null,
        avatar: a.image || a.img || a.avatar || null
      }));
    } catch (e) {}

    // Approved staff from users DB (created via Staff option or approved applications)
    try {
      const staffRows = usersDb.prepare(`
        SELECT id, username, email, name, role, joined, image
        FROM users WHERE role = 'staff' ORDER BY name ASC
      `).all();
      for (const s of staffRows) {
        otherAdmins.push({
          id: s.id,
          username: s.username,
          email: s.email,
          name: s.name,
          role: 'staff',
          source: 'users',
          joined: s.joined,
          img: s.image || null,
          avatar: s.image || null
        });
      }
    } catch (e) {}

    return res.json({
      superAdmin,
      admins: otherAdmins
    });
  } catch (err) {
    console.error('Admins error:', err);
    return res.status(500).json({ msg: 'Failed to load admin list' });
  }
});

app.post('/api/admins', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Only env super_admins (and admin type tokens) may create accounts here
    if (decoded.type !== 'admin' && decoded.role !== 'super_admin') {
      return res.status(403).json({ msg: 'Only super administrators can create accounts here' });
    }

    const { username, email, password, name, role = 'admin' } = req.body;
    const allowedRoles = ['admin', 'moderator', 'staff'];
    const roleNorm = String(role || 'admin').toLowerCase();
    if (!allowedRoles.includes(roleNorm)) {
      return res.status(400).json({ msg: 'Role must be admin, moderator, or staff' });
    }

    if (!username || !email || !password || !name) {
      return res.status(400).json({ msg: 'Username, email, password and name are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ msg: 'Password must be at least 6 characters' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Staff → users table as approved staff (dashboard Host Class)
    if (roleNorm === 'staff') {
      const existsUser = usersDb.prepare(
        `SELECT id, role FROM users WHERE username = ? OR email = ?`
      ).get(username, email);
      if (existsUser) {
        if (existsUser.role === 'staff') {
          return res.status(409).json({ msg: 'This staff account already exists' });
        }
        // Promote pending/student to approved staff and set password
        usersDb.prepare(`
          UPDATE users SET role = 'staff', password = ?, name = COALESCE(?, name), email = COALESCE(?, email)
          WHERE id = ?
        `).run(hashedPassword, name, email, existsUser.id);
        return res.status(200).json({
          msg: 'User promoted to approved Staff',
          admin: { id: existsUser.id, username, email, name, role: 'staff' }
        });
      }

      const joined = new Date().toISOString().split('T')[0];
      const info = usersDb.prepare(`
        INSERT INTO users (username, email, password, name, school, role, bio, image, joined)
        VALUES (?, ?, ?, ?, ?, 'staff', '', '', ?)
      `).run(username, email, hashedPassword, name, 'Staff', joined);

      return res.status(201).json({
        msg: 'Staff account created successfully',
        admin: { id: info.lastInsertRowid, username, email, name, role: 'staff' }
      });
    }

    // Admin / Moderator → admins.json
    const data = readJson('admins.json');
    const exists = (data.admins || []).find(a => a.username === username || a.email === email);
    if (exists) {
      return res.status(409).json({ msg: 'Username or email already exists among admins' });
    }

    // Also block collision with users table
    const userCollision = usersDb.prepare(
      `SELECT id FROM users WHERE username = ? OR email = ?`
    ).get(username, email);
    if (userCollision) {
      return res.status(409).json({ msg: 'Username or email already used by a student/staff account' });
    }

    const newAdmin = {
      id: Date.now(),
      username,
      email,
      password: hashedPassword,
      name,
      role: roleNorm,
      createdAt: new Date().toISOString()
    };

    data.admins = data.admins || [];
    data.admins.push(newAdmin);
    writeJson('admins.json', data);

    return res.status(201).json({
      msg: roleNorm === 'moderator' ? 'Moderator created successfully' : 'Admin created successfully',
      admin: { id: newAdmin.id, username, email, name, role: roleNorm }
    });
  } catch (err) {
    console.error('Create admin error:', err);
    return res.status(500).json({ msg: 'Server error: ' + (err.message || 'unknown') });
  }
});

app.get('/api/posts', (req, res) => {
  const data = readJson('posts.json');
  return res.json((data.posts || []).slice().reverse());
});

app.post('/api/posts', upload.single('image'), async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'admin') return res.status(403).json({ msg: 'Only admins can create posts' });

    const { title, excerpt, content } = req.body;
    const image = req.file ? `/uploads/${req.file.filename}` : null;

    const postsData = readJson('posts.json');
    postsData.posts = postsData.posts || [];

    const newPost = {
      id: Date.now(),
      title,
      excerpt,
      content,
      image,
      author: decoded.username,
      date: new Date().toISOString().split('T')[0]
    };

    postsData.posts.push(newPost);
    writeJson('posts.json', postsData);

    return res.json({ msg: 'Post published successfully', post: newPost });
  } catch (err) {
    console.error('Post create error:', err);
    return res.status(401).json({ msg: 'Invalid or expired token' });
  }
});

app.put('/api/posts/:id', upload.single('image'), (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  if (!token) return res.status(401).json({ msg: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'admin') {
      return res.status(403).json({ msg: 'Only admins can edit posts' });
    }

    const { title, excerpt, content } = req.body;
    if (!title || !excerpt || !content) {
      return res.status(400).json({ msg: 'Title, excerpt and content are required' });
    }

    const data = readJson('posts.json');
    data.posts = data.posts || [];
    const index = data.posts.findIndex(p => String(p.id) === String(req.params.id));

    if (index === -1) return res.status(404).json({ msg: 'Post not found' });

    data.posts[index] = {
      ...data.posts[index],
      title,
      excerpt,
      content,
      image: req.file ? `/uploads/${req.file.filename}` : data.posts[index].image,
      editedAt: new Date().toISOString()
    };

    writeJson('posts.json', data);

    return res.json({ msg: 'Post updated successfully', post: data.posts[index] });
  } catch (err) {
    console.error('JWT error:', err.message);
    return res.status(401).json({ msg: 'Invalid or expired token' });
  }
});

app.delete('/api/posts/:id', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'admin') return res.status(403).json({ msg: 'Admins only' });

    const data = readJson('posts.json');
    data.posts = (data.posts || []).filter(p => String(p.id) !== String(req.params.id));
    writeJson('posts.json', data);

    return res.json({ msg: 'Post deleted successfully' });
  } catch (err) {
    console.error('Delete post error:', err);
    return res.status(401).json({ msg: 'Invalid token' });
  }
});

app.get('/api/users', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'admin') return res.status(403).json({ msg: 'Only admins can view users' });

    const users = usersDb.prepare(`
      SELECT id, username, email, name, school, role, bio, image as avatar, joined
      FROM users
    `).all();

    return res.json(users);
  } catch (err) {
    console.error('Get users error:', err);
    return res.status(401).json({ msg: 'Invalid or expired token' });
  }
});

/** Student IDs visible for a given staff (added + followers) */
function studentIdsForStaff(staffId) {
  const sid = Number(staffId);
  if (!sid) return [];
  const owned = usersDb.prepare(`
    SELECT id FROM users WHERE lower(role) = 'student' AND owner_staff_id = ?
  `).all(sid).map(r => r.id);
  const followed = usersDb.prepare(`
    SELECT student_id AS id FROM staff_follows WHERE staff_id = ?
  `).all(sid).map(r => r.id);
  return [...new Set([...owned, ...followed])];
}

app.get('/api/public-directory', (req, res) => {
  try {
    let viewer = null;
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      try { viewer = jwt.verify(token, JWT_SECRET); } catch (e) {}
    }

    // ALL staff (create-admin + approved applications) — same role filter
    const staffRows = usersDb.prepare(`
      SELECT id, username, email, name, school, role, bio, image as avatar, joined, grade, phone, subjects
      FROM users WHERE lower(role) = 'staff' ORDER BY name COLLATE NOCASE
    `).all();

    // Which staff the viewing student follows + follower counts per staff
    let followedStaffIds = new Set();
    const followerCountMap = {};
    try {
      ensureStaffFollowsTable();
      usersDb.prepare(`SELECT staff_id, COUNT(*) AS c FROM staff_follows GROUP BY staff_id`)
        .all()
        .forEach(r => { followerCountMap[Number(r.staff_id)] = Number(r.c) || 0; });
      if (viewer && String(viewer.role || '').toLowerCase() === 'student' && viewer.id) {
        usersDb.prepare(`SELECT staff_id FROM staff_follows WHERE student_id = ?`)
          .all(viewer.id)
          .forEach(r => followedStaffIds.add(Number(r.staff_id)));
      }
    } catch (e) {}

    let studentSql = `
      SELECT id, username, email, name, school, role, bio, image as avatar, joined, grade, phone, owner_staff_id
      FROM users WHERE lower(role) = 'student'`;
    const params = [];

    const viewerRole = viewer ? String(viewer.role || '').toLowerCase() : '';
    const isStudentViewer = viewerRole === 'student';
    const isStaffOnly = viewer && isStaffLikeRole(viewer) && !isAdminLikeRole(viewer);

    if (isStaffOnly) {
      // Staff: students they added OR students who follow them
      const sid = resolveStaffDbId(viewer);
      if (sid) {
        studentSql += ` AND (
          owner_staff_id = ?
          OR id IN (SELECT student_id FROM staff_follows WHERE staff_id = ?)
        )`;
        params.push(sid, sid);
      } else {
        studentSql += ` AND 0`;
      }
    } else if (isStudentViewer) {
      // Students: only peers under their own staff OR under staff they follow
      const meId = viewer.id;
      const me = usersDb.prepare(`SELECT owner_staff_id FROM users WHERE id = ?`).get(meId);
      const myOwner = me && me.owner_staff_id ? Number(me.owner_staff_id) : null;
      const followedStaff = usersDb.prepare(`
        SELECT staff_id FROM staff_follows WHERE student_id = ?
      `).all(meId).map(r => Number(r.staff_id));
      const staffScope = [...new Set([myOwner, ...followedStaff].filter(Boolean))];
      if (staffScope.length) {
        const placeholders = staffScope.map(() => '?').join(',');
        studentSql += ` AND (
          owner_staff_id IN (${placeholders})
          OR id IN (SELECT student_id FROM staff_follows WHERE staff_id IN (${placeholders}))
          OR id = ?
        )`;
        params.push(...staffScope, ...staffScope, meId);
      } else {
        // No staff link yet — only themselves
        studentSql += ` AND id = ?`;
        params.push(meId);
      }
    }
    // Admin / moderator / no token: all students (existing behaviour for admin)
    studentSql += ` ORDER BY name`;
    const studentRows = usersDb.prepare(studentSql).all(...params);

    // Attach STANDARD ratings on the server so every staff uses identical formula
    function parseSubjects(raw) {
      if (!raw) return [];
      if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
      try {
        const j = JSON.parse(raw);
        if (Array.isArray(j)) return j.map(String).filter(Boolean);
      } catch (e) {}
      return String(raw).split(/[,;|]/).map(s => s.trim()).filter(Boolean);
    }

    const staff = staffRows.map(u => {
      const stats = (typeof computeStaffRating === 'function')
        ? computeStaffRating(u.id)
        : { avg: 0, total: 0, points: 0, stars: 0, sum: 0 };
      return {
        id: u.id,
        name: u.name,
        username: u.username,
        email: u.email,
        role: 'staff',
        school: u.school,
        department: u.school,
        bio: u.bio,
        avatar: u.avatar,
        joined: u.joined,
        type: 'staff',
        subjects: parseSubjects(u.subjects),
        following: followedStaffIds.has(Number(u.id)),
        followerCount: followerCountMap[Number(u.id)] || 0,
        ratingAvg: stats.avg,
        ratingTotal: stats.total,
        ratingSum: stats.sum,
        ratingPoints: stats.points,
        ratingStars: stats.stars,
        pointsToNext: stats.pointsToNext,
        ratingMethod: stats.method || 'cumulative_points'
      };
    });
    const students = studentRows.map(u => ({
      id: u.id,
      name: u.name,
      username: u.username,
      email: u.email,
      role: u.role,
      school: u.school,
      grade: u.grade || '',
      phone: u.phone || '',
      avatar: u.avatar,
      joined: u.joined,
      owner_staff_id: u.owner_staff_id,
      type: 'student'
    }));
    return res.json({ staff, students });
  } catch (err) {
    console.error('public-directory', err);
    return res.status(500).json({ msg: 'Failed to load directory' });
  }
});


// ---- Staff follow (students) ----
app.get('/api/staff/:id/follow-status', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const staffId = parseInt(req.params.id, 10);
    if (!staffId) return res.status(400).json({ msg: 'Invalid staff' });
    const role = String(decoded.role || '').toLowerCase();
    if (role !== 'student') {
      return res.json({ following: false, canFollow: false });
    }
    const row = usersDb.prepare(`
      SELECT id FROM staff_follows WHERE student_id = ? AND staff_id = ?
    `).get(decoded.id, staffId);
    return res.json({ following: !!row, canFollow: true });
  } catch (e) {
    return res.status(401).json({ msg: 'Invalid token' });
  }
});

app.post('/api/staff/:id/follow', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (String(decoded.role || '').toLowerCase() !== 'student') {
      return res.status(403).json({ msg: 'Only students can follow staff' });
    }
    const staffId = parseInt(req.params.id, 10);
    const staff = usersDb.prepare(`
      SELECT id, name FROM users WHERE id = ? AND lower(role) = 'staff'
    `).get(staffId);
    if (!staff) return res.status(404).json({ msg: 'Staff not found' });
    usersDb.prepare(`
      INSERT OR IGNORE INTO staff_follows (student_id, staff_id, created_at)
      VALUES (?, ?, datetime('now'))
    `).run(decoded.id, staffId);
    return res.json({ msg: 'Following ' + (staff.name || 'staff'), following: true, staffId });
  } catch (e) {
    console.error('follow', e);
    return res.status(500).json({ msg: 'Could not follow' });
  }
});

app.delete('/api/staff/:id/follow', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (String(decoded.role || '').toLowerCase() !== 'student') {
      return res.status(403).json({ msg: 'Only students can unfollow staff' });
    }
    const staffId = parseInt(req.params.id, 10);
    usersDb.prepare(`
      DELETE FROM staff_follows WHERE student_id = ? AND staff_id = ?
    `).run(decoded.id, staffId);
    return res.json({ msg: 'Unfollowed', following: false, staffId });
  } catch (e) {
    return res.status(500).json({ msg: 'Could not unfollow' });
  }
});

function ensureStaffFollowsTable() {
  try {
    usersDb.exec(`
      CREATE TABLE IF NOT EXISTS staff_follows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        staff_id INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(student_id, staff_id)
      );
    `);
  } catch (e) {}
}

/** Shared: list students linked to a user id (owner_staff_id or follow) */
function listStudentsForMember(memberId) {
  ensureStaffFollowsTable();
  const id = Number(memberId);
  if (!id) return { member: null, students: [] };

  const member = usersDb.prepare(`
    SELECT id, name, username, role, image as avatar FROM users WHERE id = ?
  `).get(id);

  let students = [];
  try {
    students = usersDb.prepare(`
      SELECT u.id, u.name, u.username, u.email, u.grade, u.school,
             u.image as avatar, u.owner_staff_id,
             CASE WHEN u.owner_staff_id = ? THEN 'added' ELSE 'follower' END AS link
      FROM users u
      WHERE lower(u.role) = 'student'
        AND (
          u.owner_staff_id = ?
          OR u.id IN (SELECT student_id FROM staff_follows WHERE staff_id = ?)
        )
      ORDER BY lower(u.name)
    `).all(id, id, id);
  } catch (sqlErr) {
    // Fallback without follows table if something is wrong
    console.error('listStudentsForMember sql', sqlErr);
    students = usersDb.prepare(`
      SELECT u.id, u.name, u.username, u.email, u.grade, u.school,
             u.image as avatar, u.owner_staff_id, 'added' AS link
      FROM users u
      WHERE lower(u.role) = 'student' AND u.owner_staff_id = ?
      ORDER BY lower(u.name)
    `).all(id);
  }

  return {
    member: member || { id, name: 'Member', username: '', role: '' },
    students
  };
}

function requireAdminOrSelfStaff(req, res, targetId) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    res.status(401).json({ msg: 'Login required' });
    return null;
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const isAdmin =
      isAdminLikeRole(decoded) ||
      decoded.type === 'admin' ||
      ['super_admin', 'admin', 'moderator'].includes(String(decoded.role || '').toLowerCase());
    const selfStaff = resolveStaffDbId(decoded);
    if (!isAdmin && Number(selfStaff) !== Number(targetId) && Number(decoded.id) !== Number(targetId)) {
      res.status(403).json({ msg: 'Not allowed to view this list' });
      return null;
    }
    return decoded;
  } catch (e) {
    res.status(401).json({ msg: 'Invalid or expired token' });
    return null;
  }
}

/** Students belonging to a staff (owner + followers) — admin/moderator or that staff */
app.get('/api/staff/:id/students', (req, res) => {
  try {
    const staffId = parseInt(req.params.id, 10);
    if (!Number.isFinite(staffId)) {
      return res.status(400).json({ msg: 'Invalid staff id' });
    }
    // Avoid clash with /api/staff/students (literal path)
    if (String(req.params.id).toLowerCase() === 'students') {
      return res.status(404).json({ msg: 'Not found' });
    }
    if (!requireAdminOrSelfStaff(req, res, staffId)) return;

    const { member, students } = listStudentsForMember(staffId);
    return res.json({
      staff: { id: member.id, name: member.name, username: member.username, role: member.role },
      count: students.length,
      students
    });
  } catch (e) {
    console.error('staff students', e);
    return res.status(500).json({ msg: 'Failed to load students: ' + (e.message || 'server error') });
  }
});

/** Alias used by admin Manage Users (same payload) */
app.get('/api/users/:id/students', (req, res) => {
  try {
    const memberId = parseInt(req.params.id, 10);
    if (!Number.isFinite(memberId)) {
      return res.status(400).json({ msg: 'Invalid user id' });
    }
    if (!requireAdminOrSelfStaff(req, res, memberId)) return;

    const { member, students } = listStudentsForMember(memberId);
    return res.json({
      staff: { id: member.id, name: member.name, username: member.username, role: member.role },
      count: students.length,
      students
    });
  } catch (e) {
    console.error('users students', e);
    return res.status(500).json({ msg: 'Failed to load students: ' + (e.message || 'server error') });
  }
});

app.delete('/api/users/:id', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'admin') return res.status(403).json({ msg: 'Only admins can delete users' });

    const info = usersDb.prepare(`DELETE FROM users WHERE id = ?`).run(req.params.id);

    if (info.changes === 0) {
      return res.status(404).json({ msg: 'User not found' });
    }

    return res.json({ msg: 'User deleted successfully' });
  } catch (err) {
    console.error('Delete user error:', err);
    return res.status(401).json({ msg: 'Invalid or expired token' });
  }
});


/** Admin/moderator: set profile picture for any listed user (staff, admin, moderator, student) */
app.post('/api/users/:id/avatar', upload.single('image'), (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const role = String(decoded.role || '').toLowerCase();
    const allowed =
      role === 'super_admin' ||
      role === 'admin' ||
      role === 'moderator' ||
      decoded.type === 'admin';
    if (!allowed) {
      return res.status(403).json({ msg: 'Only admins and moderators can update profile pictures' });
    }

    if (!req.file) {
      return res.status(400).json({ msg: 'Please select an image file' });
    }

    const userId = parseInt(req.params.id, 10);
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ msg: 'Invalid user id' });
    }

    const imageUrl = `/uploads/${req.file.filename}`;

    // Prefer users table (staff / students)
    const existing = usersDb.prepare(`SELECT id, image FROM users WHERE id = ?`).get(userId);
    if (existing) {
      usersDb.prepare(`UPDATE users SET image = ? WHERE id = ?`).run(imageUrl, userId);
      return res.json({
        msg: 'Profile picture updated',
        avatar: imageUrl,
        id: userId
      });
    }

    // Admins / moderators live in admins.json — store image there too
    const data = readJson('admins.json');
    const idx = (data.admins || []).findIndex(a => String(a.id) === String(userId));
    if (idx >= 0) {
      data.admins[idx].image = imageUrl;
      data.admins[idx].avatar = imageUrl;
      data.admins[idx].img = imageUrl;
      writeJson('admins.json', data);
      return res.json({
        msg: 'Profile picture updated',
        avatar: imageUrl,
        id: userId
      });
    }

    return res.status(404).json({ msg: 'User not found' });
  } catch (err) {
    console.error('Avatar upload error:', err);
    return res.status(401).json({ msg: 'Invalid or expired token' });
  }
});

app.get('/api/dashboard-stats', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'No token' });

  try {
    jwt.verify(token, JWT_SECRET);

    const totalUsers = usersDb.prepare(`SELECT COUNT(*) as count FROM users`).get().count;
    const pendingStaff = usersDb.prepare(
      `SELECT COUNT(*) as count FROM users WHERE role = 'staff_pending'`
    ).get().count;
    // Staff / admin / moderator / super_admin accounts for the Admins card
    const totalAdmins = usersDb.prepare(
      `SELECT COUNT(*) as count FROM users WHERE lower(role) IN ('super_admin','admin','moderator','staff')`
    ).get().count;
    const totalPosts = (readJson('posts.json').posts || []).length;
    const openTickets = Array.isArray(tickets)
      ? tickets.filter(t => String(t.status || 'pending').toLowerCase() !== 'resolved').length
      : 0;

    return res.json({
      users: totalUsers,
      pendingUsers: pendingStaff,
      admins: totalAdmins,
      posts: totalPosts,
      tickets: tickets.length,
      openTickets: openTickets
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    return res.status(401).json({ msg: 'Invalid token' });
  }
});

/** Build date buckets for platform activity chart */
function buildActivityBuckets(period, fromStr, toStr) {
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  let start = new Date(now);
  let end = new Date(now);
  let grain = 'day'; // day | week | month

  const p = String(period || 'week').toLowerCase();
  if (p === 'custom' && fromStr && toStr) {
    start = new Date(fromStr);
    end = new Date(toStr);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    const days = Math.max(1, Math.ceil((end - start) / 86400000));
    if (days > 120) grain = 'month';
    else if (days > 45) grain = 'week';
    else grain = 'day';
  } else if (p === 'month') {
    start.setDate(start.getDate() - 29);
    grain = 'day';
  } else if (p === '3months' || p === '3m') {
    start.setMonth(start.getMonth() - 3);
    grain = 'week';
  } else if (p === '6months' || p === '6m') {
    start.setMonth(start.getMonth() - 6);
    grain = 'week';
  } else if (p === 'year' || p === 'yearly') {
    start.setFullYear(start.getFullYear() - 1);
    grain = 'month';
  } else {
    // week (default)
    start.setDate(start.getDate() - 6);
    grain = 'day';
  }
  start.setHours(0, 0, 0, 0);

  const buckets = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const bStart = new Date(cursor);
    let bEnd = new Date(cursor);
    let label = '';
    if (grain === 'day') {
      bEnd.setHours(23, 59, 59, 999);
      label = bStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      cursor.setDate(cursor.getDate() + 1);
    } else if (grain === 'week') {
      bEnd.setDate(bEnd.getDate() + 6);
      bEnd.setHours(23, 59, 59, 999);
      if (bEnd > end) bEnd = new Date(end);
      label = bStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      cursor.setDate(cursor.getDate() + 7);
    } else {
      bEnd = new Date(bStart.getFullYear(), bStart.getMonth() + 1, 0, 23, 59, 59, 999);
      if (bEnd > end) bEnd = new Date(end);
      label = bStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      cursor.setMonth(cursor.getMonth() + 1);
      cursor.setDate(1);
    }
    buckets.push({
      label,
      start: bStart.toISOString().slice(0, 10),
      end: bEnd.toISOString().slice(0, 10)
    });
    if (buckets.length > 400) break;
  }
  return { buckets, grain, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

app.get('/api/dashboard-activity', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'No token' });
  try {
    jwt.verify(token, JWT_SECRET);
    const period = String(req.query.period || 'week').toLowerCase();
    const { buckets, grain, start, end } = buildActivityBuckets(period, req.query.from, req.query.to);

    // New signups per bucket (users.joined is typically YYYY-MM-DD)
    const signupRows = usersDb.prepare(`
      SELECT substr(joined, 1, 10) AS d, COUNT(*) AS c
      FROM users
      WHERE joined IS NOT NULL AND joined != ''
        AND substr(joined, 1, 10) >= ? AND substr(joined, 1, 10) <= ?
      GROUP BY substr(joined, 1, 10)
    `).all(start, end);
    const signupsByDay = {};
    signupRows.forEach(r => { signupsByDay[r.d] = r.c; });

    // Active users: distinct people who messaged, assessed, or rated in range
    const activeKeySet = {};
    function markActive(day, key) {
      if (!day || !key) return;
      const d = String(day).slice(0, 10);
      if (!activeKeySet[d]) activeKeySet[d] = new Set();
      activeKeySet[d].add(String(key));
    }

    try {
      usersDb.prepare(`
        SELECT substr(created_at, 1, 10) AS d, sender_id AS uid, sender_name AS uname
        FROM msg_messages
        WHERE created_at IS NOT NULL
          AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?
      `).all(start, end).forEach(r => markActive(r.d, r.uid || r.uname));
    } catch (e) {}

    try {
      usersDb.prepare(`
        SELECT substr(COALESCE(assessed_at, created_at), 1, 10) AS d,
               student_id AS uid, student_name AS uname
        FROM assessments
        WHERE substr(COALESCE(assessed_at, created_at), 1, 10) >= ?
          AND substr(COALESCE(assessed_at, created_at), 1, 10) <= ?
      `).all(start, end).forEach(r => markActive(r.d, r.uid || r.uname));
    } catch (e) {}

    try {
      usersDb.prepare(`
        SELECT substr(created_at, 1, 10) AS d, student_id AS uid, staff_id AS sid
        FROM staff_ratings
        WHERE created_at IS NOT NULL
          AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?
      `).all(start, end).forEach(r => {
        markActive(r.d, r.uid);
        markActive(r.d, r.sid);
      });
    } catch (e) {}

    function inBucket(day, b) {
      return day >= b.start && day <= b.end;
    }

    const labels = [];
    const signups = [];
    const active = [];

    buckets.forEach(b => {
      labels.push(b.label);
      let s = 0;
      Object.keys(signupsByDay).forEach(d => {
        if (inBucket(d, b)) s += signupsByDay[d];
      });
      signups.push(s);

      const union = new Set();
      Object.keys(activeKeySet).forEach(d => {
        if (inBucket(d, b)) activeKeySet[d].forEach(k => union.add(k));
      });
      active.push(union.size);
    });

    return res.json({
      period,
      grain,
      from: start,
      to: end,
      labels,
      signups,
      active,
      totals: {
        signups: signups.reduce((a, b) => a + b, 0),
        activePeak: active.length ? Math.max.apply(null, active) : 0
      }
    });
  } catch (err) {
    console.error('Dashboard activity error:', err);
    return res.status(401).json({ msg: 'Invalid token' });
  }
});

app.get('/api/tickets', (req, res) => {
  return res.json(tickets);
});

app.post('/api/tickets', (req, res) => {
  const newTicket = {
    id: Date.now(),
    ...req.body,
    status: 'pending',
    time: new Date().toLocaleString()
  };
  tickets.push(newTicket);
  return res.status(201).json(newTicket);
});

app.post('/api/tickets/:id/approve', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'No token' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const actorRole = String(decoded.role || '').toLowerCase();
    const canApprove =
      actorRole === 'super_admin' ||
      actorRole === 'admin' ||
      decoded.type === 'admin';
    if (!canApprove) {
      return res.status(403).json({ msg: 'Only admins can approve applications' });
    }

    const ticketId = parseInt(req.params.id, 10);
    const ticket = tickets.find(t => t.id === ticketId);

    if (!ticket || ticket.type !== 'staff_application') {
      return res.status(404).json({ msg: 'Ticket not found' });
    }

    // Approve as: staff | admin | moderator (default staff)
    const body = req.body || {};
    const targetRole = String(body.role || 'staff').toLowerCase();
    if (!['staff', 'admin', 'moderator'].includes(targetRole)) {
      return res.status(400).json({ msg: 'Role must be staff, admin, or moderator' });
    }

    const pending = usersDb.prepare(`
      SELECT * FROM users WHERE id = ? AND lower(role) = 'staff_pending'
    `).get(ticket.staffId);

    if (!pending) {
      return res.status(400).json({ msg: 'User already approved or not found' });
    }

    // Optional login credentials set by admin at approval time
    let loginUsername = String(body.username || '').trim();
    const plainPassword = String(body.password || '').trim();
    if (!loginUsername) {
      loginUsername = pending.username || pending.email || '';
    }
    if (plainPassword && plainPassword.length < 6) {
      return res.status(400).json({ msg: 'Password must be at least 6 characters' });
    }

    // Username uniqueness (other users + admins.json)
    const clashUser = usersDb.prepare(`
      SELECT id FROM users WHERE lower(username) = lower(?) AND id != ?
    `).get(loginUsername, pending.id);
    if (clashUser) {
      return res.status(409).json({ msg: 'Username already taken by another user' });
    }
    const adminsDataCheck = readJson('admins.json');
    const clashAdmin = (adminsDataCheck.admins || []).find(a =>
      String(a.username || '').toLowerCase() === loginUsername.toLowerCase()
    );
    if (clashAdmin) {
      return res.status(409).json({ msg: 'Username already taken by an admin/moderator' });
    }

    let hashedPassword = pending.password;
    if (plainPassword) {
      hashedPassword = await bcrypt.hash(plainPassword, 10);
    }

    // Subjects selected at approval (for staff mainly)
    let subjectsArr = [];
    if (Array.isArray(body.subjects)) {
      subjectsArr = body.subjects.map(s => String(s).trim()).filter(Boolean);
    } else if (typeof body.subjects === 'string' && body.subjects.trim()) {
      subjectsArr = body.subjects.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
    }
    const subjectsJson = JSON.stringify(subjectsArr);

    if (targetRole === 'staff') {
      try {
        usersDb.prepare(`
          UPDATE users SET role = 'staff', username = ?, password = ?, subjects = ? WHERE id = ?
        `).run(loginUsername, hashedPassword, subjectsJson, pending.id);
      } catch (colErr) {
        usersDb.prepare(`
          UPDATE users SET role = 'staff', username = ?, password = ? WHERE id = ?
        `).run(loginUsername, hashedPassword, pending.id);
      }
    } else {
      // Promote application to admin / moderator → admins.json, remove pending user row
      const data = readJson('admins.json');
      const exists = (data.admins || []).find(a =>
        String(a.username).toLowerCase() === loginUsername.toLowerCase() ||
        String(a.email || '').toLowerCase() === String(pending.email || '').toLowerCase()
      );
      if (exists) {
        return res.status(409).json({ msg: 'An admin/moderator with this email or username already exists' });
      }
      const newAdmin = {
        id: Date.now(),
        username: loginUsername,
        email: pending.email,
        password: hashedPassword,
        name: pending.name,
        role: targetRole,
        image: pending.image || '',
        avatar: pending.image || '',
        createdAt: new Date().toISOString()
      };
      data.admins = data.admins || [];
      data.admins.push(newAdmin);
      writeJson('admins.json', data);
      usersDb.prepare(`DELETE FROM users WHERE id = ?`).run(pending.id);
    }

    ticket.status = 'approved';
    ticket.approvedRole = targetRole;
    ticket.approvedUsername = loginUsername;
    ticket.approvedAt = new Date().toLocaleString();

    return res.json({
      msg: `Application approved as ${targetRole}`,
      role: targetRole,
      username: loginUsername
    });
  } catch (err) {
    console.error('Approve ticket error:', err);
    return res.status(500).json({ msg: 'Server error' });
  }
});

/**
 * Promote / demote a team member.
 * Body: { role: 'staff' | 'admin' | 'moderator' }
 * Works for users-table staff and admins.json admin/moderator entries.
 */
app.post('/api/users/:id/role', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const actorRole = String(decoded.role || '').toLowerCase();
    const canChange =
      actorRole === 'super_admin' ||
      actorRole === 'admin' ||
      decoded.type === 'admin';
    if (!canChange) {
      return res.status(403).json({ msg: 'Only admins can change roles' });
    }

    const targetRole = String((req.body && req.body.role) || '').toLowerCase();
    if (!['staff', 'admin', 'moderator'].includes(targetRole)) {
      return res.status(400).json({ msg: 'Role must be staff, admin, or moderator' });
    }

    const userId = req.params.id;
    const numericId = parseInt(userId, 10);

    // 1) Try users table (staff / pending / student)
    const dbUser = usersDb.prepare(`SELECT * FROM users WHERE id = ?`).get(numericId);
    if (dbUser) {
      const current = String(dbUser.role || '').toLowerCase();
      if (current === 'super_admin') {
        return res.status(403).json({ msg: 'Cannot change super admin role' });
      }

      if (targetRole === 'staff') {
        usersDb.prepare(`UPDATE users SET role = 'staff' WHERE id = ?`).run(dbUser.id);
        return res.json({
          msg: `${dbUser.name || dbUser.username} is now Staff`,
          id: dbUser.id,
          role: 'staff',
          source: 'users'
        });
      }

      // staff/pending/student → admin or moderator: move into admins.json
      const data = readJson('admins.json');
      const collision = (data.admins || []).find(a =>
        String(a.username).toLowerCase() === String(dbUser.username).toLowerCase() ||
        String(a.email || '').toLowerCase() === String(dbUser.email || '').toLowerCase()
      );
      if (collision) {
        return res.status(409).json({ msg: 'Username or email already exists among admins' });
      }
      const newAdmin = {
        id: Date.now(),
        username: dbUser.username || dbUser.email,
        email: dbUser.email,
        password: dbUser.password,
        name: dbUser.name,
        role: targetRole,
        image: dbUser.image || '',
        avatar: dbUser.image || '',
        createdAt: new Date().toISOString()
      };
      data.admins = data.admins || [];
      data.admins.push(newAdmin);
      writeJson('admins.json', data);
      usersDb.prepare(`DELETE FROM users WHERE id = ?`).run(dbUser.id);
      return res.json({
        msg: `${newAdmin.name || newAdmin.username} is now ${targetRole}`,
        id: newAdmin.id,
        role: targetRole,
        source: 'admins.json'
      });
    }

    // 2) Try admins.json (admin / moderator)
    const data = readJson('admins.json');
    const idx = (data.admins || []).findIndex(a => String(a.id) === String(userId));
    if (idx < 0) {
      return res.status(404).json({ msg: 'User not found' });
    }
    const adminRow = data.admins[idx];
    const currentAdminRole = String(adminRow.role || 'admin').toLowerCase();
    if (currentAdminRole === 'super_admin') {
      return res.status(403).json({ msg: 'Cannot change super admin role' });
    }

    if (targetRole === 'admin' || targetRole === 'moderator') {
      data.admins[idx].role = targetRole;
      writeJson('admins.json', data);
      return res.json({
        msg: `${adminRow.name || adminRow.username} is now ${targetRole}`,
        id: adminRow.id,
        role: targetRole,
        source: 'admins.json'
      });
    }

    // Demote admin/moderator → staff in users table
    const existsUser = usersDb.prepare(
      `SELECT id FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)`
    ).get(adminRow.username, adminRow.email || adminRow.username);
    if (existsUser) {
      usersDb.prepare(`UPDATE users SET role = 'staff' WHERE id = ?`).run(existsUser.id);
      data.admins.splice(idx, 1);
      writeJson('admins.json', data);
      return res.json({
        msg: `${adminRow.name || adminRow.username} is now Staff`,
        id: existsUser.id,
        role: 'staff',
        source: 'users'
      });
    }

    const joined = new Date().toISOString().split('T')[0];
    const info = usersDb.prepare(`
      INSERT INTO users (username, email, password, name, school, role, bio, image, joined)
      VALUES (?, ?, ?, ?, ?, 'staff', '', ?, ?)
    `).run(
      adminRow.username,
      adminRow.email || adminRow.username,
      adminRow.password,
      adminRow.name || adminRow.username,
      'Staff',
      adminRow.image || adminRow.avatar || '',
      joined
    );
    data.admins.splice(idx, 1);
    writeJson('admins.json', data);
    return res.json({
      msg: `${adminRow.name || adminRow.username} is now Staff`,
      id: info.lastInsertRowid,
      role: 'staff',
      source: 'users'
    });
  } catch (err) {
    console.error('Change role error:', err);
    return res.status(401).json({ msg: 'Invalid or expired token' });
  }
});

app.delete('/api/admins/:id', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'super_admin') {
      return res.status(403).json({ msg: 'Only super admin can delete other admins' });
    }

    const id = parseInt(req.params.id);

    const data = readJson('admins.json');
    data.admins = (data.admins || []).filter(a => a.id !== id);

    const adminFound = (data.admins || []).length;

    if (adminFound) {
      writeJson('admins.json', data);
      return res.json({ msg: 'Admin deleted successfully' });
    }

    const deleteResult = usersDb.prepare(`
      DELETE FROM users WHERE id = ? AND role IN ('staff', 'staff_pending')
    `).run(id);

    if (deleteResult.changes > 0) {
      return res.json({ msg: 'Staff member deleted successfully' });
    }

    return res.status(404).json({ msg: 'Admin/Staff not found' });
  } catch (err) {
    console.error('Delete admin error:', err);
    return res.status(401).json({ msg: 'Invalid or expired token' });
  }
});


// ===================== ASSESSMENTS =====================

// Roles allowed to host classes / submit assessments (approved staff + env admins)
function isHostRole(decoded) {
  if (!decoded) return false;
  const role = String(decoded.role || '').toLowerCase();
  return role === 'super_admin' || role === 'admin' || role === 'moderator' || role === 'staff' || decoded.type === 'admin';
}

function requireHostAuth(req, res) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    res.status(401).json({ msg: 'Login required' });
    return null;
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!isHostRole(decoded)) {
      res.status(403).json({ msg: 'Only approved staff and administrators can perform this action' });
      return null;
    }
    return decoded;
  } catch (e) {
    res.status(401).json({ msg: 'Invalid or expired token' });
    return null;
  }
}


app.get('/api/students-list', (req, res) => {
  try {
    let viewer = null;
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      try { viewer = jwt.verify(token, JWT_SECRET); } catch (e) {}
    }
    let sql = `SELECT id, name, username, email, school, grade, phone, owner_staff_id FROM users WHERE role = 'student'`;
    const params = [];
    if (viewer && isStaffLikeRole(viewer) && !isAdminLikeRole(viewer)) {
      const sid = resolveStaffDbId(viewer);
      if (sid) {
        sql += ` AND (owner_staff_id = ? OR id IN (SELECT student_id FROM staff_follows WHERE staff_id = ?))`;
        params.push(sid, sid);
      } else sql += ` AND 0`;
    }
    sql += ` ORDER BY name`;
    const rows = usersDb.prepare(sql).all(...params);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
});

app.get('/api/assessments', (req, res) => {
  try {
    const { period = 'all', studentId, grade } = req.query;
    let sql = `SELECT * FROM assessments WHERE 1=1`;
    const params = [];

    if (studentId) {
      sql += ` AND student_id = ?`;
      params.push(studentId);
    }
    if (grade) {
      sql += ` AND grade = ?`;
      params.push(grade);
    }

    // Period filter (based on assessed_at date)
    const now = new Date();
    if (period === 'week') {
      const d = new Date(now); d.setDate(d.getDate() - 7);
      sql += ` AND date(assessed_at) >= date(?)`;
      params.push(d.toISOString().split('T')[0]);
    } else if (period === 'month') {
      const d = new Date(now); d.setMonth(d.getMonth() - 1);
      sql += ` AND date(assessed_at) >= date(?)`;
      params.push(d.toISOString().split('T')[0]);
    } else if (period === '3months') {
      const d = new Date(now); d.setMonth(d.getMonth() - 3);
      sql += ` AND date(assessed_at) >= date(?)`;
      params.push(d.toISOString().split('T')[0]);
    } else if (period === '6months') {
      const d = new Date(now); d.setMonth(d.getMonth() - 6);
      sql += ` AND date(assessed_at) >= date(?)`;
      params.push(d.toISOString().split('T')[0]);
    } else if (period === 'year') {
      const d = new Date(now); d.setFullYear(d.getFullYear() - 1);
      sql += ` AND date(assessed_at) >= date(?)`;
      params.push(d.toISOString().split('T')[0]);
    }

    sql += ` ORDER BY assessed_at DESC, id DESC`;
    const rows = usersDb.prepare(sql).all(...params);
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: 'Failed to load assessments' });
  }
});

app.get('/api/my-assessments', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { period = 'all', subject } = req.query;
    let sql = `SELECT * FROM assessments WHERE (student_id = ? OR lower(student_name) = lower(?))`;
    const params = [decoded.id, decoded.username || decoded.name || ''];

    const now = new Date();
    if (period === 'week') {
      const d = new Date(now); d.setDate(d.getDate() - 7);
      sql += ` AND date(assessed_at) >= date(?)`;
      params.push(d.toISOString().split('T')[0]);
    } else if (period === 'month') {
      const d = new Date(now); d.setMonth(d.getMonth() - 1);
      sql += ` AND date(assessed_at) >= date(?)`;
      params.push(d.toISOString().split('T')[0]);
    } else if (period === '3months') {
      const d = new Date(now); d.setMonth(d.getMonth() - 3);
      sql += ` AND date(assessed_at) >= date(?)`;
      params.push(d.toISOString().split('T')[0]);
    } else if (period === '6months') {
      const d = new Date(now); d.setMonth(d.getMonth() - 6);
      sql += ` AND date(assessed_at) >= date(?)`;
      params.push(d.toISOString().split('T')[0]);
    } else if (period === 'year') {
      const d = new Date(now); d.setFullYear(d.getFullYear() - 1);
      sql += ` AND date(assessed_at) >= date(?)`;
      params.push(d.toISOString().split('T')[0]);
    }
    if (subject && String(subject).trim()) {
      sql += ` AND lower(subject) = lower(?)`;
      params.push(String(subject).trim());
    }
    sql += ` ORDER BY assessed_at ASC`;
    const rows = usersDb.prepare(sql).all(...params);
    return res.json(rows);
  } catch (err) {
    return res.status(401).json({ msg: 'Invalid token' });
  }
});

app.post('/api/assessments', (req, res) => {
  const decoded = requireHostAuth(req, res);
  if (!decoded) return;
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    const insert = usersDb.prepare(`
      INSERT INTO assessments (student_id, student_name, grade, subject, score, supposed_score, percentage, assessed_at, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const results = [];
    const findStudent = usersDb.prepare(`SELECT id, name, grade FROM users WHERE role = 'student' AND (lower(name) = lower(?) OR lower(username) = lower(?) OR id = ?)`);

    for (const item of items) {
      const name = (item.name || item.NAMES || item.student_name || '').trim();
      const grade = (item.grade || item.GRADES || '').trim();
      const subject = (item.subject || item.SUBJECTS || 'Mathematics').trim();
      const score = parseFloat(item.score || item.SCORE || 0);
      const supposed = parseFloat(item.supposed_score || item['SUPPOSED SCORE'] || item.supposed || 100);
      if (!name || isNaN(score) || isNaN(supposed) || supposed <= 0) continue;

      const pct = Math.round((score / supposed) * 1000) / 10; // one decimal
      let studentId = item.student_id || null;
      const found = findStudent.get(name, name, studentId || 0);
      if (found) studentId = found.id;

      const assessedAt = item.date || item.assessed_at || new Date().toISOString().split('T')[0];
      const info = insert.run(studentId, name, grade || (found && found.grade) || '', subject, score, supposed, pct, assessedAt, decoded.username || 'system');
      results.push({ id: info.lastInsertRowid, name, percentage: pct });
    }

    return res.status(201).json({ msg: `Saved ${results.length} assessment(s)`, results });
  } catch (err) {
    console.error('Assessment upload error:', err);
    return res.status(500).json({ msg: 'Server error: ' + err.message });
  }
});

app.get('/api/performance-summary', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const rows = usersDb.prepare(`
      SELECT percentage, assessed_at, subject
      FROM assessments
      WHERE student_id = ? OR lower(student_name) = lower(?)
      ORDER BY assessed_at ASC
    `).all(decoded.id, decoded.username || '');

    if (!rows.length) {
      return res.json({ overall: 0, count: 0, trend: [], bySubject: {} });
    }
    const overall = Math.round(rows.reduce((s, r) => s + r.percentage, 0) / rows.length);
    const bySubject = {};
    rows.forEach(r => {
      if (!bySubject[r.subject]) bySubject[r.subject] = [];
      bySubject[r.subject].push(r.percentage);
    });
    return res.json({
      overall,
      count: rows.length,
      trend: rows.map(r => ({ date: r.assessed_at, score: r.percentage, subject: r.subject })),
      bySubject
    });
  } catch (err) {
    return res.status(401).json({ msg: 'Invalid token' });
  }
});


// ===================== STAFF RATINGS =====================
// REAL cumulative rating (same for create-admin + approved staff):
//
// Each student vote ADDS points equal to the stars they chose:
//   1★ → +1 point, 2★ → +2, … 5★ → +5
// One vote per student (UNIQUE). Re-rating REPLACES that student's points
// (not stacked), so one person cannot spam.
//
// Displayed stars advance only when total points cross thresholds
// (a single 5★ vote cannot jump the staff to 5 stars).
//
// Thresholds (points required to show that star level):
//   1.0★ ≥ 1    1.5★ ≥ 5     2.0★ ≥ 10    2.5★ ≥ 18
//   3.0★ ≥ 28   3.5★ ≥ 42    4.0★ ≥ 60    4.5★ ≥ 85
//   5.0★ ≥ 120

const STAR_POINT_THRESHOLDS = [
  { stars: 0,   min: 0 },
  { stars: 1,   min: 1 },
  { stars: 1.5, min: 5 },
  { stars: 2,   min: 10 },
  { stars: 2.5, min: 18 },
  { stars: 3,   min: 28 },
  { stars: 3.5, min: 42 },
  { stars: 4,   min: 60 },
  { stars: 4.5, min: 85 },
  { stars: 5,   min: 120 }
];

function starsFromPoints(totalPoints) {
  const p = Number(totalPoints) || 0;
  let level = 0;
  for (const t of STAR_POINT_THRESHOLDS) {
    if (p >= t.min) level = t.stars;
  }
  return level;
}

function nextStarThreshold(totalPoints) {
  const p = Number(totalPoints) || 0;
  for (const t of STAR_POINT_THRESHOLDS) {
    if (t.min > p) return { nextStars: t.stars, pointsNeeded: t.min, pointsRemaining: t.min - p };
  }
  return { nextStars: 5, pointsNeeded: 120, pointsRemaining: 0 };
}

function computeStaffRating(staffId) {
  const sid = Number(staffId);
  if (!sid) {
    return {
      avg: 0, total: 0, sum: 0, points: 0, stars: 0,
      bayesian: 0, breakdown: [], method: 'cumulative_points'
    };
  }

  const row = usersDb.prepare(`
    SELECT
      COALESCE(SUM(CAST(rating AS REAL)), 0) AS sum_rating,
      COUNT(*) AS total
    FROM staff_ratings
    WHERE staff_id = ?
      AND student_id IS NOT NULL
      AND rating >= 1 AND rating <= 5
  `).get(sid);

  const total = Number(row && row.total) || 0;
  const sum = Number(row && row.sum_rating) || 0;
  // Points = sum of all star values contributed by students
  const points = sum;
  const stars = starsFromPoints(points);
  const avg = total > 0 ? Math.round((sum / total) * 10) / 10 : 0;
  const next = nextStarThreshold(points);

  const breakdown = usersDb.prepare(`
    SELECT rating, COUNT(*) AS count
    FROM staff_ratings
    WHERE staff_id = ? AND student_id IS NOT NULL AND rating >= 1 AND rating <= 5
    GROUP BY rating
    ORDER BY rating DESC
  `).all(sid);

  return {
    avg,
    total,
    sum,
    points,
    stars,
    nextStars: next.nextStars,
    pointsToNext: next.pointsRemaining,
    breakdown,
    method: 'cumulative_points',
    thresholds: STAR_POINT_THRESHOLDS
  };
}

function isRateableStaff(staffId) {
  const row = usersDb.prepare(
    `SELECT id FROM users WHERE id = ? AND lower(trim(role)) = 'staff'`
  ).get(Number(staffId));
  return !!row;
}

app.get('/api/staff-ratings', (req, res) => {
  try {
    let ids = [];
    if (req.query.ids) {
      ids = String(req.query.ids).split(',').map(x => parseInt(x, 10)).filter(Boolean);
    } else {
      ids = usersDb.prepare(`SELECT id FROM users WHERE lower(trim(role)) = 'staff'`).all().map(r => r.id);
    }

    // If a student is logged in, attach their vote per staff so UI matches
    let studentId = null;
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.id && String(decoded.role || '').toLowerCase() === 'student') {
          studentId = Number(decoded.id);
        }
      } catch (e) {}
    }

    const out = {};
    for (const id of ids) {
      if (!isRateableStaff(id)) {
        out[id] = { avg: 0, total: 0, sum: 0, points: 0, stars: 0, myRating: null, method: 'cumulative_points' };
        continue;
      }
      const stats = computeStaffRating(id);
      let myRating = null;
      if (studentId) {
        const mine = usersDb.prepare(
          `SELECT rating FROM staff_ratings WHERE staff_id = ? AND student_id = ?`
        ).get(id, studentId);
        if (mine) myRating = Number(mine.rating);
      }
      out[id] = Object.assign({}, stats, { myRating });
    }
    return res.json(out);
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
});

app.get('/api/staff-ratings/:staffId', (req, res) => {
  try {
    const staffId = parseInt(req.params.staffId, 10);
    if (!staffId) return res.status(400).json({ msg: 'Invalid staff id', stars: 0, points: 0, total: 0 });

    if (!isRateableStaff(staffId)) {
      return res.status(404).json({ msg: 'Staff not found', stars: 0, points: 0, total: 0, staffId });
    }

    const stats = computeStaffRating(staffId);
    let myRating = null;
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.id && String(decoded.role || '').toLowerCase() === 'student') {
          const mine = usersDb.prepare(
            `SELECT rating FROM staff_ratings WHERE staff_id = ? AND student_id = ?`
          ).get(staffId, Number(decoded.id));
          if (mine) myRating = Number(mine.rating);
        }
      } catch (e) {}
    }
    return res.json({
      staffId,
      avg: stats.avg,
      total: stats.total,
      sum: stats.sum,
      points: stats.points,
      stars: stats.stars,
      nextStars: stats.nextStars,
      pointsToNext: stats.pointsToNext,
      breakdown: stats.breakdown,
      method: stats.method,
      myRating
    });
  } catch (err) {
    return res.status(500).json({ msg: err.message, stars: 0, points: 0 });
  }
});

app.post('/api/staff-ratings', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required to rate staff' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type === 'admin') {
      return res.status(403).json({ msg: 'Only students can rate staff' });
    }
    const studentId = Number(decoded.id);
    if (!studentId) {
      return res.status(400).json({ msg: 'Invalid student session — log in again' });
    }

    const studentRow = usersDb.prepare(
      `SELECT id, role, name, username FROM users WHERE id = ?`
    ).get(studentId);
    if (!studentRow || String(studentRow.role).toLowerCase() !== 'student') {
      return res.status(403).json({
        msg: 'Only registered students can rate. Each vote adds 1–5 points toward star thresholds.'
      });
    }

    const staffId = parseInt((req.body || {}).staff_id, 10);
    const r = parseInt((req.body || {}).rating, 10);
    if (!staffId || !Number.isFinite(r) || r < 1 || r > 5) {
      return res.status(400).json({ msg: 'staff_id and rating 1–5 required' });
    }
    if (!isRateableStaff(staffId)) {
      return res.status(404).json({ msg: 'Staff not found (must be approved/created staff)' });
    }
    if (staffId === studentId) {
      return res.status(403).json({ msg: 'You cannot rate yourself' });
    }

    // Upsert: this student's contribution is exactly `r` points (1–5), not stacked
    usersDb.prepare(`
      INSERT INTO staff_ratings (staff_id, student_id, student_name, rating)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(staff_id, student_id) DO UPDATE SET
        rating = excluded.rating,
        student_name = excluded.student_name,
        created_at = datetime('now')
    `).run(
      staffId,
      studentId,
      studentRow.name || studentRow.username || 'Student',
      r
    );

    const stats = computeStaffRating(staffId);
    return res.json({
      msg: 'Saved. Your ' + r + '★ added ' + r + ' point(s). Stars unlock by total points, not a single vote.',
      staffId,
      avg: stats.avg,
      total: stats.total,
      sum: stats.sum,
      points: stats.points,
      stars: stats.stars,
      nextStars: stats.nextStars,
      pointsToNext: stats.pointsToNext,
      myRating: r,
      method: stats.method
    });
  } catch (err) {
    console.error('Rating error:', err);
    return res.status(500).json({ msg: 'Rating failed: ' + err.message });
  }
});

// ===================== LIVE CLASS ROOMS =====================
app.post('/api/classes/start', (req, res) => {
  const decoded = requireHostAuth(req, res);
  if (!decoded) return;
  let host = decoded.name || decoded.username || 'Host';
  const hostId = decoded.id != null ? String(decoded.id) : '';
  const code = (req.body.code || '').trim().toUpperCase() || ('NOA-' + Math.random().toString(36).slice(2, 8).toUpperCase());
  if (liveClasses.has(code)) {
    return res.status(409).json({ msg: 'Class code already in use. Choose another.' });
  }
  const createdAt = new Date().toISOString();
  liveClasses.set(code, {
    host,
    hostId,
    title: req.body.title || 'Olympiad Class',
    createdAt,
    participants: [],
    banned: [], // names / userIds / emails that cannot rejoin this code
    sharedFile: null
  });
  upsertClassHistory({
    code,
    host,
    hostId,
    title: req.body.title || 'Olympiad Class',
    createdAt,
    status: 'live',
    endedAt: null
  });
  return res.json({ msg: 'Class started', code, host });
});

/** Admin / moderator: list ongoing + closed classes in a time window */
app.get('/api/classes/monitor', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!isAdminLikeRole(decoded)) {
      return res.status(403).json({ msg: 'Only admins and moderators can monitor classes' });
    }

    let hours = parseFloat(req.query.hours);
    if (!Number.isFinite(hours) || hours <= 0) hours = 24;
    hours = Math.min(hours, 24 * 90); // max 90 days
    const cutoff = Date.now() - hours * 60 * 60 * 1000;

    // Ongoing from live map
    const ongoing = [];
    liveClasses.forEach((room, code) => {
      const started = new Date(room.createdAt || 0).getTime();
      ongoing.push({
        code,
        host: room.host || 'Host',
        hostId: room.hostId || '',
        title: room.title || 'Olympiad Class',
        createdAt: room.createdAt,
        endedAt: null,
        status: 'live',
        participants: (room.participants || []).length
      });
    });
    // Sort latest started first
    ongoing.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Closed from history within window (and not still live)
    const liveCodes = new Set(ongoing.map(o => String(o.code).toUpperCase()));
    const closed = loadClassHistory()
      .filter(s => {
        if (!s) return false;
        const code = String(s.code || '').toUpperCase();
        if (liveCodes.has(code) && !s.endedAt) return false;
        const ended = s.endedAt ? new Date(s.endedAt).getTime() : 0;
        const started = s.createdAt ? new Date(s.createdAt).getTime() : 0;
        const t = ended || started;
        return t >= cutoff && (s.status === 'closed' || s.endedAt);
      })
      .map(s => ({
        code: s.code,
        host: s.host || 'Host',
        hostId: s.hostId || '',
        title: s.title || 'Olympiad Class',
        createdAt: s.createdAt,
        endedAt: s.endedAt,
        status: 'closed',
        participants: s.participantsCount || 0
      }));
    closed.sort((a, b) => {
      const tb = new Date(b.endedAt || b.createdAt).getTime();
      const ta = new Date(a.endedAt || a.createdAt).getTime();
      return tb - ta;
    });

    return res.json({ hours, ongoing, closed });
  } catch (e) {
    return res.status(401).json({ msg: 'Invalid or expired token' });
  }
});

app.get('/api/classes/:code', (req, res) => {
  const room = liveClasses.get(req.params.code.toUpperCase());
  if (!room) return res.status(404).json({ msg: 'Class not found or has ended' });
  return res.json({ code: req.params.code.toUpperCase(), ...room });
});

app.post('/api/classes/:code/join', (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = liveClasses.get(code);
  if (!room) return res.status(404).json({ msg: 'Class not found. Check the code with your host.' });
  const name = (req.body.name || 'Participant').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const userId = req.body.userId != null ? String(req.body.userId) : '';
  const banned = room.banned || [];
  const blocked =
    banned.includes(name.toLowerCase()) ||
    (email && banned.includes(email)) ||
    (userId && banned.includes('id:' + userId));
  if (blocked) {
    return res.status(403).json({ msg: 'You were removed from this class and cannot rejoin this code.' });
  }
  if (!room.participants.includes(name)) room.participants.push(name);
  return res.json({ msg: 'Joined', code, host: room.host, title: room.title, participants: room.participants });
});

app.post('/api/classes/:code/share', (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = liveClasses.get(code);
  if (!room) return res.status(404).json({ msg: 'Class not found' });
  room.sharedFile = req.body.file || null; // { name, url or dataUrl }
  return res.json({ msg: 'File shared', sharedFile: room.sharedFile });
});

app.delete('/api/classes/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = liveClasses.get(code);
  if (room) {
    closeClassHistory(code);
    // Also stamp participant count on the closed history row
    try {
      const sessions = loadClassHistory();
      const row = sessions.find(s => String(s.code).toUpperCase() === code && s.endedAt);
      if (row) {
        row.participantsCount = (room.participants || []).length;
        row.title = room.title || row.title;
        row.host = room.host || row.host;
        saveClassHistory(sessions);
      }
    } catch (e) {}
  } else {
    closeClassHistory(code);
  }
  liveClasses.delete(code);
  return res.json({ msg: 'Class ended' });
});

app.get('/api/top-assessments', (req, res) => {
  try {
    const subject = (req.query.subject || '').trim();
    const grade = (req.query.grade || '').trim();
    const nameQ = (req.query.name || '').trim();
    const period = (req.query.period || 'all').trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);

    let viewer = null;
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      try { viewer = jwt.verify(token, JWT_SECRET); } catch (e) { viewer = null; }
    }

    let sql = `
      SELECT a.student_name, a.subject, a.percentage, a.score, a.supposed_score, a.assessed_at, a.grade, a.student_id, a.uploaded_by
      FROM assessments a
      WHERE 1=1`;
    const params = [];

    // Staff: students they added OR students who follow them
    if (viewer && isStaffLikeRole(viewer) && !isAdminLikeRole(viewer)) {
      ensureStaffFollowsTable();
      const sid = resolveStaffDbId(viewer);
      if (sid) {
        sql += ` AND (
          a.student_id IN (
            SELECT id FROM users WHERE role = 'student' AND (
              owner_staff_id = ?
              OR id IN (SELECT student_id FROM staff_follows WHERE staff_id = ?)
            )
          )
          OR (
            a.student_id IS NULL
            AND lower(COALESCE(a.student_name, '')) IN (
              SELECT lower(name) FROM users WHERE role = 'student' AND (
                owner_staff_id = ?
                OR id IN (SELECT student_id FROM staff_follows WHERE staff_id = ?)
              )
            )
          )
        )`;
        params.push(sid, sid, sid, sid);
      } else {
        return res.json([]);
      }
    }

    if (subject) {
      sql += ` AND lower(a.subject) = lower(?)`;
      params.push(subject);
    }
    if (grade) {
      sql += ` AND lower(COALESCE(a.grade, '')) = lower(?)`;
      params.push(grade);
    }
    if (nameQ) {
      sql += ` AND lower(COALESCE(a.student_name, '')) LIKE lower(?)`;
      params.push('%' + nameQ + '%');
    }

    const now = new Date();
    if (period === 'week') {
      const d = new Date(now); d.setDate(d.getDate() - 7);
      sql += ` AND date(a.assessed_at) >= date(?)`;
      params.push(d.toISOString().split('T')[0]);
    } else if (period === 'month') {
      const d = new Date(now); d.setMonth(d.getMonth() - 1);
      sql += ` AND date(a.assessed_at) >= date(?)`;
      params.push(d.toISOString().split('T')[0]);
    } else if (period === '3months') {
      const d = new Date(now); d.setMonth(d.getMonth() - 3);
      sql += ` AND date(a.assessed_at) >= date(?)`;
      params.push(d.toISOString().split('T')[0]);
    } else if (period === '6months') {
      const d = new Date(now); d.setMonth(d.getMonth() - 6);
      sql += ` AND date(a.assessed_at) >= date(?)`;
      params.push(d.toISOString().split('T')[0]);
    } else if (period === 'year') {
      const d = new Date(now); d.setFullYear(d.getFullYear() - 1);
      sql += ` AND date(a.assessed_at) >= date(?)`;
      params.push(d.toISOString().split('T')[0]);
    }

    sql += ` ORDER BY a.percentage DESC, a.assessed_at DESC LIMIT ?`;
    params.push(limit);
    const rows = usersDb.prepare(sql).all(...params);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
});

/** Total unread message count across all channels the user can see */
app.get('/api/messages/unread-total', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const role = String(decoded.role || '').toLowerCase();
    let channelIds = [];

    if (role === 'super_admin' || role === 'admin' || role === 'moderator' || decoded.type === 'admin') {
      const staffUsers = usersDb.prepare(`SELECT id, name, username FROM users WHERE role = 'staff'`).all();
      for (const su of staffUsers) {
        const ch = ensureStaffChannel(su.id, su.name || su.username);
        channelIds.push(ch.id);
      }
      usersDb.prepare(`SELECT id FROM msg_channels WHERE type = 'broadcast'`).all()
        .forEach(r => channelIds.push(r.id));
    } else if (role === 'staff') {
      const sid = resolveStaffDbId(decoded) || decoded.id;
      const row = usersDb.prepare(`SELECT name FROM users WHERE id = ?`).get(sid);
      const ch = ensureStaffChannel(sid, (row && row.name) || decoded.username);
      channelIds.push(ch.id);
      usersDb.prepare(`SELECT id FROM msg_channels WHERE type = 'broadcast' AND closed = 0`).all()
        .forEach(r => channelIds.push(r.id));
    } else {
      // student: unread across followed staff + owner staff channels
      const visibleStaffIds = getStudentVisibleStaffIds(decoded.id);
      for (const sid of visibleStaffIds) {
        const staff = usersDb.prepare(
          `SELECT id, name, username FROM users WHERE id = ? AND lower(role) = 'staff'`
        ).get(sid);
        if (staff) {
          const ch = ensureStaffChannel(staff.id, staff.name || staff.username);
          channelIds.push(ch.id);
        }
      }
      usersDb.prepare(`SELECT id FROM msg_channels WHERE type = 'broadcast' AND closed = 0`).all()
        .forEach(r => channelIds.push(r.id));
    }

    channelIds = [...new Set(channelIds.filter(Boolean))];
    const userKey = decoded.id != null
      ? 'u:' + String(decoded.id)
      : 'u:' + String(decoded.username || 'anon');

    let total = 0;
    for (const cid of channelIds) {
      const readRow = usersDb.prepare(
        `SELECT last_read_id FROM msg_channel_reads WHERE user_key = ? AND channel_id = ?`
      ).get(userKey, cid);
      const lastRead = Number(readRow && readRow.last_read_id) || 0;
      const unreadRow = usersDb.prepare(`
        SELECT COUNT(1) as c FROM msg_messages
        WHERE channel_id = ? AND id > ?
          AND (
            length(trim(COALESCE(body, ''))) > 0
            OR length(trim(COALESCE(attachment_url, ''))) > 0
          )
      `).get(cid, lastRead);
      total += Number(unreadRow && unreadRow.c) || 0;
    }
    return res.json({ unread: total });
  } catch (err) {
    return res.status(401).json({ msg: 'Invalid token' });
  }
});


// ===================== AI KNOWLEDGE ASSISTANT (V5 — HYPER-HUMAN) =====================
const AI_DB_FILE = path.join(__dirname, 'database.json');
const AI_CONV_FILE = path.join(__dirname, 'ai-conversations.json');

function readAiDb() {
  try { return JSON.parse(fs.readFileSync(AI_DB_FILE, 'utf8')); }
  catch (e) { return { behaviorals: '', behavior: null, knowledge: [] }; }
}
function writeAiDb(data) { fs.writeFileSync(AI_DB_FILE, JSON.stringify(data, null, 2)); }
function readAiConv() {
  try { return JSON.parse(fs.readFileSync(AI_CONV_FILE, 'utf8')); }
  catch (e) { return { conversations: [] }; }
}
function writeAiConv(data) { fs.writeFileSync(AI_CONV_FILE, JSON.stringify(data, null, 2)); }

const AI_CONV_TTL_MS = 24 * 60 * 60 * 1000;

function conversationLastActivity(conv) {
  if (!conv) return 0;
  if (conv.updatedAt) { const t = Date.parse(conv.updatedAt); if (!Number.isNaN(t)) return t; }
  const msgs = conv.messages || [];
  if (msgs.length) { const t = Date.parse(msgs[msgs.length - 1].at || ''); if (!Number.isNaN(t)) return t; }
  if (conv.createdAt) { const t = Date.parse(conv.createdAt); if (!Number.isNaN(t)) return t; }
  return 0;
}
function isConversationExpired(conv) {
  const last = conversationLastActivity(conv);
  if (!last) return true;
  return (Date.now() - last) > AI_CONV_TTL_MS;
}
function pruneExpiredConversations(store) {
  const data = store || readAiConv();
  data.conversations = data.conversations || [];
  const before = data.conversations.length;
  data.conversations = data.conversations.filter(c => !isConversationExpired(c));
  if (data.conversations.length !== before) writeAiConv(data);
  return data;
}
function getActiveConversation(store, { conversationId, visitorId }) {
  const data = pruneExpiredConversations(store);
  let conv = null;
  if (conversationId) {
    conv = (data.conversations || []).find(c => c.id === conversationId);
    if (conv && isConversationExpired(conv)) conv = null;
  }
  if (!conv && visitorId) {
    conv = (data.conversations || []).find(c => c.visitorId === visitorId && c.status !== 'closed' && !isConversationExpired(c));
  }
  return { store: data, conv };
}

// ===================== SEMANTIC FOUNDATION =====================

function tokenize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
}

function normalize(text) {
  return String(text || '').toLowerCase().trim().replace(/[.!?]+$/g, '');
}

function extractEntities(text) {
  const lower = String(text || '').toLowerCase();
  return {
    wantsHuman: /\b(moderator|human|agent|support|real person|talk to someone|speak to|live chat|operator|representative)\b/.test(lower),
    isGreeting: /^(hi|hello|hey|greetings|good morning|good afternoon|good evening|howdy|what's up|sup|yo)\b/i.test(lower),
    isThanks: /\b(thanks|thank you|appreciate|grateful|cheers|thx)\b/i.test(lower),
    isGoodbye: /\b(bye|goodbye|see you|later|farewell|take care|catch you)\b/i.test(lower),
    isQuestion: /\b(what|how|when|where|why|who|which|can|could|would|will|is|are|does|do|should)\b/i.test(lower) || lower.includes('?'),
    wantsPricing: /\b(price|cost|fee|pricing|payment|pay|cheap|expensive|discount|promo|money|dollar)\b/i.test(lower),
    wantsContact: /\b(contact|email|phone|call|reach|address|location|visit|find us)\b/i.test(lower),
    wantsRegistration: /\b(register|sign up|enroll|join|apply|registration|form|signup|admission)\b/i.test(lower),
    urgency: /\b(urgent|asap|emergency|immediately|quick|fast|hurry|deadline|now|today)\b/i.test(lower),
    negative: /\b(not working|broken|error|problem|issue|complaint|bad|worst|terrible|angry|frustrated|disappointed|unhappy)\b/i.test(lower),
    comparison: /\b(compare|difference|versus|vs|better|best|or|between)\b/i.test(lower),
    quantity: /\b(many|much|number|count|how many|how much|limit|capacity|slot|space)\b/i.test(lower)
  };
}

// ===================== CONVERSATION CONTEXT ENGINE =====================

function buildContext(conv) {
  const messages = (conv?.messages || []).slice(-10);
  const context = {
    turnCount: messages.filter(m => m.role === 'user').length,
    lastTopic: null,
    mentionedEntities: new Set(),
    toldFacts: new Set(),
    userEmotion: 'neutral',
    pendingQuestion: null,
    lastQuestionType: 'general',
    knowledgeItemsUsed: new Set(),
    pronounReferents: []
  };

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const text = String(m.text || '');

    if (m.role === 'user') {
      if (/\b(thanks|thank|awesome|great|amazing|love|perfect|excellent)\b/i.test(text)) context.userEmotion = 'positive';
      else if (/\b(confused|lost|don't understand|unclear|what do you mean|huh)\b/i.test(text)) context.userEmotion = 'confused';
      else if (/\b(angry|frustrated|annoyed|terrible|awful|hate|worst|useless)\b/i.test(text)) context.userEmotion = 'frustrated';
      else if (/\b(urgent|asap|emergency|immediately|hurry)\b/i.test(text)) context.userEmotion = 'urgent';

      context.lastQuestionType = detectQuestionType(text);

      const entities = extractMentions(text);
      if (entities.length) {
        context.mentionedEntities = new Set([...context.mentionedEntities, ...entities]);
        context.pronounReferents = [...entities, ...context.pronounReferents].slice(0, 5);
      }
    } else if (m.role === 'assistant') {
      const facts = text.split(/[.!?]+/).map(s => normalize(s)).filter(s => s.length > 10);
      facts.forEach(f => context.toldFacts.add(f));
      const ourEntities = extractMentions(text);
      ourEntities.forEach(e => context.pronounReferents.unshift(e));
      context.pronounReferents = context.pronounReferents.slice(0, 5);
    }
  }

  return context;
}

function extractMentions(text) {
  const lower = text.toLowerCase();
  const mentions = [];
  const patterns = [
    /\b(registration|registering|signing up|enrollment)\b/i,
    /\b(classes|courses|programs|workshops|lessons)\b/i,
    /\b(portal|website|platform|site|form)\b/i,
    /\b(payment|fee|cost|price|money)\b/i,
    /\b(contact|email|phone|call|address)\b/i,
    /\b(deadline|schedule|date|time|duration)\b/i,
    /\b(exam|test|competition|assessment|certificate)\b/i,
    /\b(moderator|human|support|agent)\b/i
  ];
  for (const p of patterns) {
    const m = lower.match(p);
    if (m) mentions.push(m[1] || m[0]);
  }
  return [...new Set(mentions)];
}

function detectQuestionType(text) {
  const lower = text.toLowerCase().trim();
  if (/^(what|what's)\b/.test(lower)) return 'definition';
  if (/^how\b/.test(lower) || /\b(steps?|process|procedure|way to|guide)\b/i.test(lower)) return 'process';
  if (/^when\b/.test(lower) || /\b(deadline|date|time|schedule|duration|how long)\b/i.test(lower)) return 'time';
  if (/^where\b/.test(lower) || /\b(location|address|place|venue|find|reach)\b/i.test(lower)) return 'location';
  if (/^why\b/.test(lower) || /\b(reason|cause|because|purpose)\b/i.test(lower)) return 'reason';
  if (/^who\b/.test(lower) || /\b(person|contact|team|staff|instructor|teacher)\b/i.test(lower)) return 'person';
  if (/^(compare|difference|versus|vs|better|best|or)\b/i.test(lower)) return 'comparison';
  if (/\b(price|cost|fee|how much|payment|pay|pricing)\b/i.test(lower)) return 'pricing';
  if (/^(can|could|would|will|is|are|does|do|should)\b/.test(lower)) return 'confirmation';
  if (/\b(how many|number of|count|quantity|limit)\b/i.test(lower)) return 'quantity';
  return 'general';
}

// ===================== COREFERENCE RESOLUTION =====================

function resolveCoreference(question, context) {
  let resolved = question;
  const lower = question.toLowerCase();

  const isReferenceHeavy = /^\s*(what about|how about|and|what|how|when|where|why|who|is|are|does|do|can|could)\s+(it|that|this|they|them|those|the)\b/i.test(lower) ||
    /^\s*(it|that|this|they|them)\b/i.test(lower);

  if (!isReferenceHeavy && !/\b(it|that|this|they|them|those)\b/i.test(lower)) {
    return question;
  }

  const referent = context.pronounReferents[0] || context.lastTopic || 'that';

  if (context.lastQuestionType === 'pricing' && /\b(it|that|this)\b/i.test(lower)) {
    resolved = resolved.replace(/\b(it|that|this)\b/gi, 'the cost');
  } else if (context.lastQuestionType === 'time' && /\b(it|that|this)\b/i.test(lower)) {
    resolved = resolved.replace(/\b(it|that|this)\b/gi, 'the schedule');
  } else if (context.lastQuestionType === 'process' && /\b(it|that|this)\b/i.test(lower)) {
    resolved = resolved.replace(/\b(it|that|this)\b/gi, 'the process');
  } else if (context.lastQuestionType === 'location' && /\b(it|that|this)\b/gi.test(lower)) {
    resolved = resolved.replace(/\b(it|that|this)\b/gi, 'the location');
  } else if (referent) {
    resolved = resolved.replace(/\b(it|that|this)\b/gi, referent);
    resolved = resolved.replace(/\b(they|them|those)\b/gi, referent + 's');
  }

  return resolved;
}

// ===================== RETRIEVAL ENGINE =====================

function rankKnowledge(question, knowledge, context) {
  const qTokens = tokenize(question);
  const qLower = question.toLowerCase();
  const scored = [];

  for (const item of knowledge || []) {
    const text = String(item.text || '');
    const textLower = text.toLowerCase();
    const kw = (item.keywords || []).map(k => String(k).toLowerCase());
    let score = 0;

    for (const t of qTokens) {
      if (textLower.includes(t)) score += 2;
      if (kw.some(k => k.includes(t) || t.includes(k))) score += 3;
    }

    for (const k of kw) {
      if (k.length > 2 && qLower.includes(k)) score += 5;
    }

    if (textLower.length > 20) {
      const snippet = textLower.slice(0, 40);
      if (qLower.includes(snippet.slice(0, 15))) score += 3;
    }

    if (context && context.mentionedEntities.size) {
      const itemEntities = extractMentions(text);
      const overlap = itemEntities.filter(e => context.mentionedEntities.has(e));
      score += overlap.length * 2;
    }

    if (context && context.knowledgeItemsUsed.has(item.id)) score *= 0.7;

    if (score > 0) scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ===================== KNOWLEDGE ASSIMILATION ENGINE =====================

function extractMeaningUnits(text) {
  const raw = String(text || '');
  let units = raw.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 5);

  const refined = [];
  for (const unit of units) {
    if (unit.length > 100 && (unit.includes(',') || unit.includes(';'))) {
      const clauses = unit.split(/[,;]+/).map(c => c.trim()).filter(c => c.length > 15 && /[a-z]{3,}/i.test(c));
      if (clauses.length >= 2) {
        refined.push(...clauses);
        continue;
      }
    }
    refined.push(unit);
  }
  return refined;
}

function comprehendUnit(unit) {
  const lower = unit.toLowerCase();

  let type = 'fact';
  if (/\b(must|need|required|necessary|have to|should)\b/i.test(lower)) type = 'requirement';
  if (/\b(can|may|able to|option|choice)\b/i.test(lower)) type = 'permission';
  if (/\b(will|going to|shall|expect)\b/i.test(lower)) type = 'prediction';
  if (/\b(before|after|during|when|once|until)\b/i.test(lower)) type = 'temporal';
  if (/\b(because|since|due to|reason|why)\b/i.test(lower)) type = 'causal';
  if (/\b(if|unless|provided that|assuming)\b/i.test(lower)) type = 'conditional';
  if (/\b(\$\d+|\d+\s*dollars?|cost|fee|price|payment)\b/i.test(lower)) type = 'financial';

  let core = unit
    .replace(/\b(please|kindly|simply|just|basically|actually|in fact|of course|note that|be advised that)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const entities = [];
  const entityPatterns = [
    { regex: /\b(regist\w+|enroll\w+|sign\w+\s*up)\b/gi, type: 'action', canonical: 'registration' },
    { regex: /\b(class\w+|course\w+|program\w+|workshop\w+)\b/gi, type: 'subject', canonical: 'classes' },
    { regex: /\b(portal|website|platform|site|form)\b/gi, type: 'tool', canonical: 'portal' },
    { regex: /\b(payment|fee|cost|price|money|\$\d+)\b/gi, type: 'financial', canonical: 'payment' },
    { regex: /\b(email|phone|call|contact|address)\b/gi, type: 'contact', canonical: 'contact' },
    { regex: /\b(deadline|schedule|date|time|duration)\b/gi, type: 'temporal', canonical: 'schedule' },
    { regex: /\b(student\w+|learner\w+|participant\w+)\b/gi, type: 'actor', canonical: 'student' },
    { regex: /\b(confirm\w+|verif\w+|approv\w+)\b/gi, type: 'action', canonical: 'confirmation' }
  ];

  for (const ep of entityPatterns) {
    const matches = lower.match(ep.regex);
    if (matches) entities.push({ text: matches[0], type: ep.type, canonical: ep.canonical });
  }

  return { original: unit, core, type, entities: [...new Map(entities.map(e => [e.canonical, e])).values()] };
}

function assimilateKnowledge(rankedItems, questionType, context) {
  if (!rankedItems.length || rankedItems[0].score < 3) return null;

  const items = rankedItems.slice(0, 3).map(r => r.item);
  const allUnits = [];

  for (const item of items) {
    const units = extractMeaningUnits(item.text);
    for (const unit of units) {
      const understood = comprehendUnit(unit);
      allUnits.push({ ...understood, sourceId: item.id });
    }
  }

  const unique = [];
  const seen = new Set();
  for (const unit of allUnits) {
    const sig = tokenize(unit.core).sort().join(' ');
    if (!seen.has(sig)) {
      seen.add(sig);
      unique.push(unit);
    }
  }

  const typePriority = {
    process: ['requirement', 'permission', 'temporal'],
    definition: ['fact', 'permission'],
    time: ['temporal', 'requirement'],
    location: ['fact'],
    reason: ['causal', 'fact'],
    comparison: ['fact', 'permission'],
    pricing: ['financial', 'requirement'],
    confirmation: ['permission', 'requirement', 'fact'],
    quantity: ['fact', 'requirement'],
    general: ['fact', 'requirement', 'permission', 'temporal', 'financial', 'causal']
  };

  const priorities = typePriority[questionType] || typePriority.general;
  unique.sort((a, b) => {
    const aIdx = priorities.indexOf(a.type);
    const bIdx = priorities.indexOf(b.type);
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });

  const count = context && context.turnCount > 3 ? 3 : 2;
  const selected = unique.slice(0, count);

  return {
    units: selected,
    primaryTopic: selected[0]?.entities[0]?.canonical || 'this',
    questionType,
    sources: [...new Set(selected.map(u => u.sourceId))]
  };
}


function applyBehavioralsDirectives(reply, db, context) {
  let text = String(reply || '').trim();
  if (!text) return text;
  const directives = String((db && db.behaviorals) || '');
  const profile = parseBehavioralStyle(db);

  // Concise: cap sentences if behaviorals/verbosity demand it
  if (profile.verbosity === 'concise' || /concise|brief|2–5|2-5 short/i.test(directives)) {
    const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (parts.length > 5) text = parts.slice(0, 5).join(' ');
  }

  // Warm tone soft opener if empathy high and reply is abrupt
  if (profile.tone === 'warm' && profile.empathy === 'high' && text.length < 40 && !/[.!?]$/.test(text)) {
    text = text + '.';
  }

  // Knowledge-only reminder already in templates; strip accidental self-contradiction repeats
  return text.replace(/\s+/g, ' ').trim();
}

function sentenceKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function dedupeAgainstHistory(reply, context) {
  const text = String(reply || '').trim();
  if (!text) return text;
  const hist = [];
  try {
    const msgs = (context && context.messages) || [];
    for (const m of msgs) {
      if (m.role === 'assistant' || m.role === 'ai' || m.role === 'bot') {
        String(m.text || m.body || '').split(/(?<=[.!?])\s+/).forEach(p => {
          const k = sentenceKey(p);
          if (k.length > 12) hist.push(k);
        });
      }
    }
    if (context && Array.isArray(context.recentAssistantSentences)) {
      context.recentAssistantSentences.forEach(k => hist.push(k));
    }
  } catch (e) {}

  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const kept = [];
  const seen = new Set(hist);
  for (const p of parts) {
    const k = sentenceKey(p);
    if (k.length > 12 && seen.has(k)) continue;
    if (k.length > 12) seen.add(k);
    kept.push(p);
  }
  let out = kept.join(' ').trim() || text;
  // Also avoid consecutive identical sentences inside this reply
  const final = [];
  let prev = '';
  for (const p of out.split(/(?<=[.!?])\s+/).filter(Boolean)) {
    const k = sentenceKey(p);
    if (k && k === prev) continue;
    final.push(p);
    prev = k;
  }
  out = final.join(' ').trim();
  if (context) {
    context.recentAssistantSentences = context.recentAssistantSentences || [];
    final.forEach(p => {
      const k = sentenceKey(p);
      if (k.length > 12) context.recentAssistantSentences.push(k);
    });
    if (context.recentAssistantSentences.length > 40) {
      context.recentAssistantSentences = context.recentAssistantSentences.slice(-40);
    }
  }
  return out;
}


// ===================== BEHAVIORAL PROFILE ENGINE =====================
// ENHANCED: reads structured `db.behavior` first; falls back to parsing `db.behaviorals` text.

function parseBehavioralStyle(db) {
  // If the database has a structured behavior object, use it directly.
  if (db && db.behavior && typeof db.behavior === 'object') {
    const b = db.behavior;
    return {
      register: b.register || 'neutral',
      tone: b.tone || 'neutral',
      energy: b.energy || 'moderate',
      empathy: b.empathy || 'standard',
      verbosity: b.verbosity || 'normal',
      confidence: b.confidence || 'assured',
      vocabulary: b.vocabulary || 'standard',
      punctuation: b.punctuation || 'standard',
      personality: Array.isArray(b.personality) ? b.personality :
        (typeof b.personality === 'string' ? [b.personality] : [])
    };
  }

  // Otherwise, parse the behaviorals text string as before.
  const style = String((db && db.behaviorals) || '').toLowerCase();
  return {
    register: style.includes('formal') || style.includes('professional') ? 'formal' : style.includes('casual') || style.includes('informal') ? 'casual' : 'neutral',
    tone: style.includes('warm') || style.includes('friendly') ? 'warm' : style.includes('cold') || style.includes('clinical') ? 'cold' : 'neutral',
    energy: style.includes('enthusiastic') || style.includes('energetic') || style.includes('excited') ? 'high' : style.includes('calm') || style.includes('mellow') ? 'low' : 'moderate',
    empathy: style.includes('empathetic') || style.includes('caring') || style.includes('understanding') ? 'high' : 'standard',
    verbosity: style.includes('concise') || style.includes('brief') || style.includes('short') ? 'concise' : style.includes('detailed') || style.includes('thorough') || style.includes('verbose') ? 'verbose' : 'normal',
    confidence: style.includes('tentative') || style.includes('hesitant') ? 'tentative' : style.includes('authoritative') || style.includes('expert') ? 'authoritative' : 'assured',
    vocabulary: style.includes('simple') || style.includes('plain') ? 'simple' : style.includes('rich') || style.includes('sophisticated') ? 'rich' : style.includes('technical') ? 'technical' : 'standard',
    punctuation: style.includes('expressive') || style.includes('emotional') ? 'expressive' : 'standard',
    personality: ['playful', 'witty', 'serious', 'scholarly', 'mentor', 'coach', 'cheerful', 'patient'].filter(p => style.includes(p))
  };
}

// ===================== DISCOURSE PLANNING =====================

function planDiscourse(assimilation, profile, context) {
  if (!assimilation) return null;

  const plan = {
    segments: [],
    tone: profile.tone,
    energy: profile.energy,
    empathy: profile.empathy,
    register: profile.register
  };

  const { units, questionType } = assimilation;

  if (context.turnCount <= 1) {
    plan.segments.push({ type: 'opening', content: 'greeting_contextual' });
  } else if (context.userEmotion === 'confused') {
    plan.segments.push({ type: 'opening', content: 'clarification_support' });
  } else if (context.userEmotion === 'frustrated') {
    plan.segments.push({ type: 'opening', content: 'empathy_acknowledgment' });
  } else if (context.userEmotion === 'urgent') {
    plan.segments.push({ type: 'opening', content: 'urgency_recognition' });
  }

  if (questionType === 'process') {
    plan.segments.push({ type: 'content', style: 'steps', units });
  } else if (questionType === 'definition') {
    plan.segments.push({ type: 'content', style: 'explanation', units });
  } else if (questionType === 'comparison') {
    plan.segments.push({ type: 'content', style: 'contrast', units });
  } else if (questionType === 'pricing') {
    plan.segments.push({ type: 'content', style: 'financial', units });
  } else {
    plan.segments.push({ type: 'content', style: 'narrative', units });
  }

  if (context.userEmotion !== 'frustrated' && context.userEmotion !== 'urgent') {
    plan.segments.push({ type: 'closing', content: 'offer_more_help' });
  }

  return plan;
}

// ===================== NATURAL LANGUAGE GENERATOR =====================

const VOCABULARY_BANKS = {
  formal: {
    openers: ['With regard to', 'Regarding', 'In relation to', 'Concerning', 'Pertaining to'],
    transitions: ['Furthermore,', 'Subsequently,', 'In addition,', 'Moreover,', 'It is also worth noting that'],
    closers: ['Should you require further clarification, please do not hesitate to inquire.', 'I remain available for any additional questions.', 'Please reach out should you need further assistance.'],
    hedges: ['It appears that', 'One may find that', 'It is suggested that'],
    actors: { student: 'the student', registration: 'the registration process', classes: 'the courses', portal: 'the online portal', payment: 'the remittance' }
  },
  casual: {
    openers: ['So,', 'Well,', 'Okay,', 'Alright,', 'Here\'s the thing —'],
    transitions: ['Also,', 'Plus,', 'And another thing,', 'Oh, and', 'By the way,'],
    closers: ['Let me know if you need anything else!', 'Hit me up if you\'re stuck.', 'Holler if you need more help.'],
    hedges: ['It seems like', 'Looks like', 'Sounds like'],
    actors: { student: 'you', registration: 'signing up', classes: 'the classes', portal: 'the website', payment: 'the fee' }
  },
  neutral: {
    openers: ['Regarding', 'About', 'For', 'On'],
    transitions: ['Additionally,', 'Also,', 'Plus,', 'Moreover,'],
    closers: ['Let me know if you have other questions.', 'Feel free to ask if you need more info.', 'I\'m here if you need anything else.'],
    hedges: ['It seems that', 'It looks like'],
    actors: { student: 'students', registration: 'registration', classes: 'classes', portal: 'the portal', payment: 'payment' }
  }
};

const DISCOURSE_MARKERS = {
  requirement: ['You\'ll need to', 'Make sure you', 'Don\'t forget to', 'It\'s important that you', 'Ensure you'],
  permission: ['You can', 'You\'re able to', 'Feel free to', 'You have the option to', 'It\'s possible to'],
  temporal: ['Before that,', 'Afterwards,', 'Once that\'s done,', 'Next,', 'Then,', 'Finally,'],
  causal: ['That\'s because', 'The reason is', 'This is due to', 'It works this way —'],
  financial: ['The cost is', 'You\'ll pay', 'The fee comes to', 'Pricing is set at'],
  conditional: ['If so,', 'In that case,', 'Should that apply,'],
  prediction: ['You can expect', 'You\'ll receive', 'It will', 'The outcome should be']
};

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function realizeUnit(unit, profile, index, total, usedPhrases) {
  const bank = VOCABULARY_BANKS[profile.register] || VOCABULARY_BANKS.neutral;
  let text = unit.core;

  const synonymMap = {
    'register': ['sign up', 'enroll', 'join', 'get enrolled'],
    'enroll': ['register', 'sign up', 'join'],
    'sign up': ['register', 'enroll', 'apply'],
    'apply': ['submit an application', 'send in a request', 'put in for'],
    'visit': ['go to', 'head to', 'access', 'check out'],
    'fill out': ['complete', 'enter details in', 'provide information for'],
    'complete': ['finish', 'finalize', 'wrap up'],
    'pay': ['make payment', 'cover the fee', 'settle the cost'],
    'contact': ['reach out to', 'get in touch with', 'connect with'],
    'call': ['phone', 'dial'],
    'email': ['send an email to', 'reach by email'],
    'submit': ['send in', 'turn in', 'hand in'],
    'confirm': ['verify', 'validate', 'make sure'],
    'receive': ['get', 'obtain', 'be given'],
    'need': ['require', 'must have', 'will need'],
    'must': ['need to', 'have to', 'are required to'],
    'can': ['are able to', 'may', 'have the option to'],
    'help': ['assist', 'support', 'guide'],
    'provide': ['offer', 'give', 'make available'],
    'include': ['cover', 'contain', 'feature'],
    'allow': ['let', 'enable', 'permit'],
    'teach': ['instruct', 'educate', 'train'],
    'learn': ['study', 'pick up', 'get trained in'],
    'start': ['begin', 'kick off', 'get started'],
    'begin': ['start', 'commence'],
    'end': ['finish', 'conclude', 'wrap up'],
    'check': ['look at', 'review', 'verify'],
    'download': ['get', 'grab', 'save'],
    'student': ['learner', 'participant', 'candidate'],
    'teacher': ['instructor', 'educator', 'tutor'],
    'class': ['course', 'program', 'session'],
    'course': ['class', 'program', 'training'],
    'portal': ['website', 'platform', 'site'],
    'website': ['site', 'portal', 'platform'],
    'form': ['application', 'document'],
    'payment': ['fee settlement', 'transaction'],
    'fee': ['cost', 'charge', 'price'],
    'price': ['cost', 'fee', 'rate'],
    'cost': ['price', 'fee', 'expense'],
    'email': ['electronic mail', 'message'],
    'phone': ['telephone', 'mobile'],
    'address': ['location', 'venue', 'place'],
    'deadline': ['due date', 'cutoff', 'closing date'],
    'schedule': ['timetable', 'calendar'],
    'confirmation': ['verification', 'acknowledgment'],
    'certificate': ['credential', 'certification'],
    'result': ['outcome', 'score'],
    'account': ['profile', 'membership'],
    'password': ['login credential', 'access code'],
    'online': ['on the web', 'digitally', 'virtually'],
    'required': ['necessary', 'needed', 'mandatory'],
    'necessary': ['required', 'needed'],
    'important': ['crucial', 'essential', 'key'],
    'easy': ['simple', 'straightforward'],
    'difficult': ['challenging', 'hard', 'complex'],
    'available': ['accessible', 'on hand', 'ready'],
    'free': ['at no cost', 'complimentary'],
    'quick': ['fast', 'rapid', 'swift'],
    'detailed': ['thorough', 'comprehensive'],
    'new': ['fresh', 'recent'],
    'old': ['previous', 'past'],
    'first': ['initial', 'starting'],
    'next': ['subsequent', 'following'],
    'last': ['final', 'closing'],
    'before': ['prior to', 'ahead of'],
    'after': ['following', 'once'],
    'during': ['throughout', 'in the course of'],
    'through': ['via', 'by way of']
  };

  const words = text.split(/\b/);
  text = words.map(word => {
    const wLower = word.toLowerCase();
    const alts = synonymMap[wLower];
    if (!alts) return word;
    const fresh = alts.find(a => !usedPhrases.has(a.toLowerCase())) || alts[Math.floor(Math.random() * alts.length)];
    usedPhrases.add(fresh.toLowerCase());
    return word[0] === word[0].toUpperCase() ? fresh.charAt(0).toUpperCase() + fresh.slice(1) : fresh;
  }).join('');

  const markers = DISCOURSE_MARKERS[unit.type];
  if (markers && index > 0) {
    const marker = markers[index % markers.length];
    text = `${marker} ${text.charAt(0).toLowerCase() + text.slice(1)}`;
  } else if (index === 0 && unit.type === 'requirement') {
    const reqStarters = profile.register === 'formal'
      ? ['It is required that ', 'Please note that ', 'Be advised that ']
      : ['Just so you know, ', 'Heads up — ', 'Important: '];
    text = reqStarters[Date.now() % reqStarters.length] + text.charAt(0).toLowerCase() + text.slice(1);
  }

  const passiveMatch = text.match(/\b(is|are|was|were)\s+(\w+ed)\s+(by|to|for|with)\b/i);
  if (passiveMatch && Math.random() > 0.6) {
    text = text.replace(new RegExp(`\\b${passiveMatch[1]}\\s+${passiveMatch[2]}\\b`, 'i'), passiveMatch[2]);
  }

  if (profile.register === 'formal') {
    text = text.replace(/\b(don't|can't|won't|shouldn't|couldn't|wouldn't|isn't|aren't|haven't|hasn't|it's|that's|here's|there's|what's|let's)\b/gi, m => ({
      "don't": 'do not', "can't": 'cannot', "won't": 'will not', "shouldn't": 'should not',
      "couldn't": 'could not', "wouldn't": 'would not', "isn't": 'is not', "aren't": 'are not',
      "haven't": 'have not', "hasn't": 'has not', "it's": 'it is', "that's": 'that is',
      "here's": 'here is', "there's": 'there is', "what's": 'what is', "let's": 'let us'
    })[m.toLowerCase()] || m);
  } else if (profile.register === 'casual') {
    text = text.replace(/\b(utilize|assist|inquire|purchase|obtain|require|regarding|therefore|however|furthermore|moreover)\b/gi, m => ({
      'utilize': 'use', 'assist': 'help', 'inquire': 'ask', 'purchase': 'buy', 'obtain': 'get',
      'require': 'need', 'regarding': 'about', 'therefore': 'so', 'however': 'but',
      'furthermore': 'also', 'moreover': 'plus'
    })[m.toLowerCase()] || m);
  }

  if (profile.vocabulary === 'simple') {
    const simpleMap = { 'utilize': 'use', 'assist': 'help', 'inquire': 'ask', 'purchase': 'buy', 'obtain': 'get', 'require': 'need', 'sufficient': 'enough', 'additional': 'more', 'approximately': 'about', 'comprehensive': 'complete', 'demonstrate': 'show' };
    for (const [k, v] of Object.entries(simpleMap)) {
      text = text.replace(new RegExp(`\\b${k}\\b`, 'gi'), v);
    }
  } else if (profile.vocabulary === 'rich') {
    const richMap = { 'use': 'utilize', 'help': 'assist', 'ask': 'inquire', 'buy': 'purchase', 'get': 'obtain', 'need': 'require', 'enough': 'sufficient', 'more': 'additional', 'about': 'regarding', 'complete': 'comprehensive', 'show': 'demonstrate' };
    for (const [k, v] of Object.entries(richMap)) {
      text = text.replace(new RegExp(`\\b${k}\\b`, 'gi'), v);
    }
  }

  text = text.trim();
  if (!/[.!?]$/.test(text)) text += '.';
  text = text.charAt(0).toUpperCase() + text.slice(1);

  return text;
}

function generateFromPlan(plan, profile, context) {
  const bank = VOCABULARY_BANKS[profile.register] || VOCABULARY_BANKS.neutral;
  const usedPhrases = new Set();
  const parts = [];

  for (const segment of plan.segments) {
    if (segment.type === 'opening') {
      if (segment.content === 'greeting_contextual') {
        if (profile.energy === 'high') {
          parts.push(pickRandom(['Hey! Great to hear from you.', 'Hi there! Excited to help out.', 'Hello! Ready when you are.']));
        } else if (profile.register === 'formal') {
          parts.push(pickRandom(['Thank you for reaching out.', 'I appreciate your inquiry.', 'Welcome. I shall assist you.']));
        } else {
          parts.push(pickRandom(['Hey! How can I help?', 'Hi there! What do you need?', 'Hello! I\'m here to help.']));
        }
      } else if (segment.content === 'clarification_support') {
        parts.push(pickRandom([
          'No worries, let me break this down more clearly.',
          'I can see how that might be confusing — let me explain.',
          'Totally get it. Let me make this clearer.'
        ]));
      } else if (segment.content === 'empathy_acknowledgment') {
        parts.push(pickRandom([
          'I completely understand your frustration, and I\'m here to help fix this.',
          'I hear you, and I want to make sure we get this sorted out properly.',
          'That sounds really frustrating. Let me help you with that right away.'
        ]));
      } else if (segment.content === 'urgency_recognition') {
        parts.push(pickRandom([
          'I understand this is time-sensitive, so I\'ll get straight to the point.',
          'Got it — let me give you the quickest answer possible.',
          'Understood. Here\'s what you need to know immediately.'
        ]));
      }
    }

    else if (segment.type === 'content') {
      const units = segment.units || [];
      const style = segment.style;

      if (style === 'steps' && units.length >= 2) {
        if (profile.register === 'formal' || context.userEmotion === 'confused') {
          parts.push('Here is the procedure:');
          units.forEach((u, i) => {
            const stepNum = ['First,', 'Second,', 'Third,', 'Finally,'][i] || 'Next,';
            parts.push(`${stepNum} ${realizeUnit(u, profile, i, units.length, usedPhrases).replace(/^[A-Z][a-z]+\s*,\s*/i, '')}`);
          });
        } else {
          const opener = pickRandom(bank.openers);
          parts.push(`${opener} ${realizeUnit(units[0], profile, 0, units.length, usedPhrases)}`);
          for (let i = 1; i < units.length; i++) {
            const transition = pickRandom(bank.transitions);
            parts.push(`${transition} ${realizeUnit(units[i], profile, i, units.length, usedPhrases)}`);
          }
        }
      } else if (style === 'contrast' && units.length >= 2) {
        parts.push(realizeUnit(units[0], profile, 0, units.length, usedPhrases));
        parts.push(`On the other hand, ${realizeUnit(units[1], profile, 1, units.length, usedPhrases).replace(/^[A-Z]/, c => c.toLowerCase())}`);
        if (units[2]) {
          parts.push(`Ultimately, ${realizeUnit(units[2], profile, 2, units.length, usedPhrases).replace(/^[A-Z]/, c => c.toLowerCase())}`);
        }
      } else {
        const opener = pickRandom(bank.openers);
        const firstUnit = realizeUnit(units[0], profile, 0, units.length, usedPhrases);

        if (profile.register === 'casual' && Math.random() > 0.5) {
          parts.push(`${opener} ${firstUnit}`);
        } else {
          parts.push(firstUnit);
        }

        for (let i = 1; i < units.length; i++) {
          if (Math.random() > 0.3) {
            const transition = pickRandom(bank.transitions);
            parts.push(`${transition} ${realizeUnit(units[i], profile, i, units.length, usedPhrases)}`);
          } else {
            parts.push(realizeUnit(units[i], profile, i, units.length, usedPhrases));
          }
        }
      }
    }

    else if (segment.type === 'closing') {
      if (segment.content === 'offer_more_help') {
        parts.push(pickRandom(bank.closers));
      }
    }
  }

  let text = parts.join(' ');
  text = text.replace(/\s+/g, ' ').trim();

  if (profile.personality.includes('playful') && context.userEmotion !== 'frustrated') {
    if (!text.endsWith('!') && !text.endsWith('?')) text += ' 😊';
  }
  if ((profile.personality.includes('mentor') || profile.personality.includes('coach')) && context.userEmotion !== 'frustrated') {
    if (!/got this|you can do/i.test(text)) text += " You've got this!";
  }

  return text;
}

// ===================== SOCIAL INTENT HANDLERS =====================

const SOCIAL_RESPONSES = {
  greeting: {
    formal: ['Welcome to SIMCC. How may I be of assistance today?', 'Good day. I am your NOA Assistant, ready to provide information.', 'Hello. I would be delighted to help you with any inquiries.'],
    casual: ['Hey there! Welcome to SIMCC! What\'s up?', 'Hi! Awesome to see you here. What can I do for you?', 'Hello! I\'m your assistant — hit me with your questions!'],
    neutral: ['Hello! I am the NOA Assistant. How can I help?', 'Hi there! I can help with SIMCC info. What do you need?', 'Welcome! I\'m here to answer your questions.']
  },
  thanks: {
    formal: ['You are most welcome. It is my pleasure to assist.', 'I am glad I could be of service.', 'Thank you for your courtesy. I remain at your disposal.'],
    casual: ['You got it! Anytime.', 'No worries! Happy to help.', 'Anytime! That\'s what I\'m here for.'],
    neutral: ['You are welcome!', 'Happy to help!', 'Glad I could assist.']
  },
  goodbye: {
    formal: ['Thank you for your time. Please return should you need further assistance.', 'Farewell. We hope to be of service again.', 'Goodbye, and wishing you every success.'],
    casual: ['Take care! Come back anytime.', 'See ya! Good luck!', 'Bye for now!'],
    neutral: ['Goodbye! Chat again anytime.', 'Take care!', 'See you later!']
  },
  lowConfidence: {
    formal: ['I do not have sufficient information on that matter. A moderator would provide the most accurate guidance. Please share your contact details, and I shall arrange that for you.', 'That inquiry extends beyond my current knowledge. I recommend consulting with a moderator. Kindly provide your name, email, and phone number above.', 'I am unable to furnish a complete answer. Would you prefer to speak with a moderator? Please confirm your contact information.'],
    casual: ['Hmm, I don\'t have the full scoop on that. A moderator would know way more — want me to hook you up? Just drop your details above.', 'That\'s a solid question, but I\'m drawing a blank. A real person could help better! Fill in your contact info and I\'ll ping them.', 'I wish I knew that off the top of my head, but I don\'t. A moderator totally would though! Share your details above.'],
    neutral: ['I don\'t have that information yet. A moderator can help. Please share your contact details.', 'That question is beyond my current knowledge. I can connect you with a moderator.', 'I\'m not equipped to answer that fully. Want me to bring in a moderator?']
  },
  handoff: {
    formal: [' I have escalated this to a moderator. Please ensure your contact details are complete.', ' A moderator has been notified. Kindly confirm your information so they may reach you.', ' This is being handled by our team. Please verify your contact details.'],
    casual: [' I\'ve sent this to a moderator. Make sure your info is filled in!', ' A real person is on the way! Drop your details above.', ' Moderator notified! Fill in your contact info.'],
    neutral: [' I\'ve notified a moderator. Please confirm your details above.', ' A moderator will be in touch. Make sure your info is provided.', ' This has been escalated. Please share your contact information.']
  }
};

// ===================== MAIN REPLY BUILDER =====================

function buildAiReply(question, db, conv) {
  const context = buildContext(conv);
  const resolvedQuestion = resolveCoreference(question, context);
  const entities = extractEntities(resolvedQuestion);
  const qType = detectQuestionType(resolvedQuestion);
  const profile = parseBehavioralStyle(db);

  if (entities.isGreeting) {
    return { reply: pickRandom(SOCIAL_RESPONSES.greeting[profile.register]), confidence: 10, matched: [] };
  }
  if (entities.isThanks) {
    return { reply: pickRandom(SOCIAL_RESPONSES.thanks[profile.register]), confidence: 10, matched: [] };
  }
  if (entities.isGoodbye) {
    return { reply: pickRandom(SOCIAL_RESPONSES.goodbye[profile.register]), confidence: 10, matched: [] };
  }

  const ranked = rankKnowledge(resolvedQuestion, db.knowledge, context);
  const assimilation = assimilateKnowledge(ranked, qType, context);

  if (!assimilation) {
    return {
      reply: pickRandom(SOCIAL_RESPONSES.lowConfidence[profile.register]),
      confidence: 0,
      matched: []
    };
  }

  assimilation.sources.forEach(id => context.knowledgeItemsUsed.add(id));

  const plan = planDiscourse(assimilation, profile, context);
  let reply = generateFromPlan(plan, profile, context);

  // Enforce written behaviorals as constraints (always)
  reply = applyBehavioralsDirectives(reply, db, context);

  // Never repeat a sentence already used in this conversation
  reply = dedupeAgainstHistory(reply, context);

  if (entities.wantsHuman) {
    reply += pickRandom(SOCIAL_RESPONSES.handoff[profile.register]);
  }

  if (!entities.wantsHuman && !entities.isGoodbye && !entities.isThanks) {
    const escalations = {
      formal: ' If you would prefer personalized assistance, our moderators are available below.',
      casual: ' Wanna talk to a human instead? Just hit that moderator button!',
      neutral: ' Need a moderator? Click below anytime.'
    };
    if (!/moderator|human|real person/i.test(reply)) {
      reply += escalations[profile.register] || escalations.neutral;
    }
  }

  return {
    reply,
    confidence: ranked[0]?.score || 0,
    matched: ranked.slice(0, 3).map(r => ({ id: r.item.id, score: r.score }))
  };
}

function summarizeConversation(messages) {
  const lines = (messages || []).slice(-12).map(m => {
    const who = m.role === 'user' ? 'User' : (m.role === 'moderator' ? 'Moderator' : 'AI');
    return who + ': ' + String(m.text || '').slice(0, 160);
  });
  return lines.join('\n').slice(0, 1200);
}

// ===================== AUTH MIDDLEWARE =====================

function requireAdminOrMod(req, res) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) { res.status(401).json({ msg: 'Login required' }); return null; }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const role = String(decoded.role || '').toLowerCase();
    if (role === 'super_admin' || role === 'admin' || role === 'moderator' || decoded.type === 'admin') return decoded;
    res.status(403).json({ msg: 'Admins and moderators only' });
    return null;
  } catch (e) {
    res.status(401).json({ msg: 'Invalid token' });
    return null;
  }
}

function requireSuperAdminOnly(req, res) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) { res.status(401).json({ msg: 'Login required' }); return null; }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role === 'super_admin') return decoded;
    res.status(403).json({ msg: 'Only super administrators can train the AI' });
    return null;
  } catch (e) {
    res.status(401).json({ msg: 'Invalid token' });
    return null;
  }
}

// ===================== ADMIN ENDPOINTS =====================

app.get('/api/ai/database', (req, res) => {
  if (!requireSuperAdminOnly(req, res)) return;
  return res.json(readAiDb());
});

app.post('/api/ai/train', (req, res) => {
  if (!requireSuperAdminOnly(req, res)) return;
  try {
    const { text, keywords } = req.body || {};
    const body = String(text || '').trim();
    if (!body || body.length < 8) return res.status(400).json({ msg: 'Training text must be at least 8 characters' });
    const db = readAiDb();
    db.knowledge = db.knowledge || [];
    const id = Date.now();
    const autoKw = tokenize(body).slice(0, 12);
    const extra = Array.isArray(keywords) ? keywords : String(keywords || '').split(',').map(s => s.trim()).filter(Boolean);
    db.knowledge.push({ id, text: body, keywords: [...new Set([...extra, ...autoKw])], addedAt: new Date().toISOString().split('T')[0] });
    writeAiDb(db);
    return res.json({ msg: 'Knowledge trained', count: db.knowledge.length, entry: db.knowledge[db.knowledge.length - 1] });
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
});

app.put('/api/ai/behaviorals', (req, res) => {
  if (!requireSuperAdminOnly(req, res)) return;
  try {
    const attitude = String((req.body && req.body.behaviorals) || '').trim();
    if (!attitude) return res.status(400).json({ msg: 'Attitude / behavioral text required' });
    const db = readAiDb();
    db.behaviorals = attitude;
    writeAiDb(db);
    return res.json({ msg: 'Behavioral attitude saved', behaviorals: db.behaviorals });
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
});

app.delete('/api/ai/knowledge/:id', (req, res) => {
  if (!requireSuperAdminOnly(req, res)) return;
  const db = readAiDb();
  const id = Number(req.params.id);
  db.knowledge = (db.knowledge || []).filter(k => k.id !== id);
  writeAiDb(db);
  return res.json({ msg: 'Deleted', count: db.knowledge.length });
});

// ===================== PUBLIC CHAT ENDPOINTS =====================

app.post('/api/ai/chat', (req, res) => {
  try {
    const { message, visitorId, name, email, phone, conversationId } = req.body || {};
    const text = String(message || '').trim();
    if (!text) return res.status(400).json({ msg: 'Message required' });

    const db = readAiDb();
    let { store, conv } = getActiveConversation(readAiConv(), { conversationId, visitorId });
    store.conversations = store.conversations || [];
    const expiredRestart = conversationId && !conv;

    if (!conv) {
      conv = {
        id: 'c' + Date.now() + Math.random().toString(36).slice(2, 7),
        visitorId: visitorId || ('v' + Date.now()),
        name: name || '',
        email: email || '',
        phone: phone || '',
        messages: [],
        summary: '',
        status: 'ai',
        unreadModerator: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      store.conversations.unshift(conv);
    }

    if (name) conv.name = String(name).trim();
    if (email) conv.email = String(email).trim();
    if (phone) conv.phone = String(phone).trim();

    conv.messages.push({ role: 'user', text, at: new Date().toISOString() });

    const entities = extractEntities(text);
    const wantsHuman = entities.wantsHuman;

    let replyObj;
    let ephemeral = false;
    if (conv.status === 'handoff' || conv.status === 'open') {
      replyObj = {
        reply: "You're in the moderator queue. A moderator will reply here soon. You can keep adding details.",
        confidence: 0,
        matched: []
      };
      ephemeral = true;
      conv.unreadModerator = true;
    } else {
      replyObj = buildAiReply(text, db, conv);
      if (wantsHuman) {
        conv.status = 'handoff';
        conv.unreadModerator = true;
        conv.summary = summarizeConversation(conv.messages);
      }
    }

    // Ephemeral queue notices are shown once in the UI only — not saved in the thread
    if (!ephemeral) {
      conv.messages.push({ role: 'assistant', text: replyObj.reply, at: new Date().toISOString() });
    }
    conv.updatedAt = new Date().toISOString();
    conv.summary = summarizeConversation(conv.messages);
    writeAiConv(store);

    return res.json({
      reply: replyObj.reply,
      confidence: replyObj.confidence,
      ephemeral: ephemeral,
      conversationId: conv.id,
      visitorId: conv.visitorId,
      status: conv.status,
      needsContact: !(conv.name && conv.email && conv.phone),
      restarted: !!expiredRestart,
      expiresInHours: 24
    });
  } catch (err) {
    console.error('AI chat error:', err);
    return res.status(500).json({ msg: err.message });
  }
});

app.post('/api/ai/handoff', (req, res) => {
  try {
    const { conversationId, name, email, phone } = req.body || {};
    const store = pruneExpiredConversations(readAiConv());
    const conv = (store.conversations || []).find(c => c.id === conversationId);
    if (!conv || isConversationExpired(conv)) {
      return res.status(410).json({ msg: 'Conversation expired after 24 hours of inactivity. Start a new chat.', expired: true });
    }
    if (name) conv.name = String(name).trim();
    if (email) conv.email = String(email).trim();
    if (phone) conv.phone = String(phone).trim();
    conv.status = 'handoff';
    conv.unreadModerator = true;
    conv.summary = summarizeConversation(conv.messages);
    conv.messages.push({ role: 'assistant', text: 'A moderator has been notified. They will continue this conversation with you shortly.', at: new Date().toISOString() });
    conv.updatedAt = new Date().toISOString();
    writeAiConv(store);
    return res.json({ msg: 'Moderator notified', conversation: { id: conv.id, status: conv.status } });
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
});

app.get('/api/ai/my-conversations', (req, res) => {
  try {
    const visitorId = req.query.visitorId;
    if (!visitorId) return res.status(400).json({ msg: 'visitorId required' });
    const store = pruneExpiredConversations(readAiConv());
    const list = (store.conversations || [])
      .filter(c => c.visitorId === visitorId && !isConversationExpired(c))
      .map(c => ({ id: c.id, status: c.status, name: c.name, updatedAt: c.updatedAt, preview: (c.messages || []).slice(-1)[0]?.text?.slice(0, 80) || '', expiresInHours: 24 }));
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
});

app.get('/api/ai/conversation/:id', (req, res) => {
  try {
    const store = pruneExpiredConversations(readAiConv());
    const conv = (store.conversations || []).find(c => c.id === req.params.id);
    if (!conv || isConversationExpired(conv)) {
      return res.status(410).json({ msg: 'Conversation expired after 24 hours of inactivity. Start a new chat.', expired: true });
    }
    const visitorId = req.query.visitorId;
    const token = req.headers.authorization?.split(' ')[1];
    let isStaff = false;
    if (token) {
      try {
        const d = jwt.verify(token, JWT_SECRET);
        const role = String(d.role || '').toLowerCase();
        isStaff = role === 'super_admin' || role === 'admin' || role === 'moderator' || d.type === 'admin';
      } catch (e) {}
    }
    if (!isStaff && conv.visitorId !== visitorId) {
      return res.status(403).json({ msg: 'Forbidden' });
    }
    return res.json(conv);
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
});

app.get('/api/ai/inbox', (req, res) => {
  if (!requireAdminOrMod(req, res)) return;
  const store = pruneExpiredConversations(readAiConv());
  const list = (store.conversations || [])
    .filter(c => !isConversationExpired(c) && (c.status === 'handoff' || c.status === 'open' || c.unreadModerator))
    .map(c => ({ id: c.id, name: c.name || 'Visitor', email: c.email || '', phone: c.phone || '', status: c.status, unreadModerator: !!c.unreadModerator, summary: c.summary || '', updatedAt: c.updatedAt, messageCount: (c.messages || []).length }));
  return res.json(list);
});

app.get('/api/ai/unread-count', (req, res) => {
  if (!requireAdminOrMod(req, res)) return;
  const store = pruneExpiredConversations(readAiConv());
  const count = (store.conversations || []).filter(c => c.unreadModerator && !isConversationExpired(c)).length;
  return res.json({ count });
});

app.post('/api/ai/reply', (req, res) => {
  const decoded = requireAdminOrMod(req, res);
  if (!decoded) return;
  try {
    const { conversationId, message } = req.body || {};
    const text = String(message || '').trim();
    if (!conversationId || !text) return res.status(400).json({ msg: 'conversationId and message required' });
    const store = pruneExpiredConversations(readAiConv());
    const conv = (store.conversations || []).find(c => c.id === conversationId);
    if (!conv || isConversationExpired(conv)) {
      return res.status(410).json({ msg: 'Conversation expired after 24 hours of inactivity.', expired: true });
    }
    conv.messages.push({ role: 'moderator', text, at: new Date().toISOString(), by: decoded.username || decoded.name || 'Moderator' });
    conv.status = 'open';
    conv.unreadModerator = false;
    conv.updatedAt = new Date().toISOString();
    conv.summary = summarizeConversation(conv.messages);
    writeAiConv(store);
    return res.json({ msg: 'Reply sent', conversation: conv });
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
});

app.post('/api/ai/inbox/read', (req, res) => {
  if (!requireAdminOrMod(req, res)) return;
  const { conversationId } = req.body || {};
  const store = readAiConv();
  const conv = (store.conversations || []).find(c => c.id === conversationId);
  if (conv) {
    conv.unreadModerator = false;
    writeAiConv(store);
  }
  return res.json({ msg: 'ok' });
});


// ===================== WEBRTC ICE CONFIG (STUN + TURN for cross-network) =====================
app.get('/api/webrtc-config', (req, res) => {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Public TURN relays (help when peers are on different networks / strict NAT)
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turns:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ];
  // Optional private TURN from .env (recommended for production)
  // TURN_URLS=turn:your.server:3478,turns:your.server:5349
  // TURN_USERNAME=...
  // TURN_CREDENTIAL=...
  const turnUrls = (process.env.TURN_URLS || '').split(',').map(u => u.trim()).filter(Boolean);
  const turnUser = process.env.TURN_USERNAME || '';
  const turnCred = process.env.TURN_CREDENTIAL || '';
  turnUrls.forEach(url => {
    iceServers.push({
      urls: url,
      username: turnUser,
      credential: turnCred
    });
  });
  return res.json({
    iceServers,
    iceCandidatePoolSize: 10,
    iceTransportPolicy: 'all'
  });
});

// ===================== CLASS SUMMARIES =====================
const CLASS_SUM_FILE = path.join(__dirname, 'class-summaries.json');
function readClassSummaries() {
  try { return JSON.parse(fs.readFileSync(CLASS_SUM_FILE, 'utf8')); }
  catch (e) { return { summaries: [] }; }
}
function writeClassSummaries(data) {
  fs.writeFileSync(CLASS_SUM_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/class-summaries', (req, res) => {
  try {
    const data = readClassSummaries();
    const list = (data.summaries || []).slice().sort((a, b) =>
      String(b.date || '').localeCompare(String(a.date || ''))
    );
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
});

app.get('/api/class-summaries/:id', (req, res) => {
  const data = readClassSummaries();
  const item = (data.summaries || []).find(s => String(s.id) === String(req.params.id));
  if (!item) return res.status(404).json({ msg: 'Summary not found' });
  return res.json(item);
});

app.post('/api/class-summaries', (req, res) => {
  const decoded = requireHostAuth(req, res);
  if (!decoded) return;
  const { topic, date, details, fullSummary, classCode, hostName } = req.body || {};
  if (!(topic || '').trim()) return res.status(400).json({ msg: 'Topic is required' });
  const data = readClassSummaries();
  data.summaries = data.summaries || [];
  const item = {
    id: 'CS-' + Date.now().toString(36).toUpperCase(),
    topic: String(topic).trim(),
    date: (date || new Date().toISOString().slice(0, 10)).trim(),
    details: String(details || '').trim(),
    fullSummary: String(fullSummary || details || '').trim(),
    classCode: (classCode || '').toString().toUpperCase(),
    hostName: hostName || decoded.username || decoded.name || 'Host',
    authorId: decoded.id || null,
    authorUsername: decoded.username || '',
    authorRole: decoded.role || '',
    createdAt: new Date().toISOString()
  };
  data.summaries.unshift(item);
  writeClassSummaries(data);
  return res.status(201).json(item);
});

function canManageClassSummary(decoded, item) {
  if (!decoded || !item) return false;
  const role = String(decoded.role || '').toLowerCase();
  if (role === 'super_admin' || role === 'admin' || decoded.type === 'admin' && role !== 'moderator') {
    // super admin + admin always
    if (role === 'super_admin' || role === 'admin') return true;
  }
  if (role === 'super_admin' || role === 'admin') return true;
  // author (staff/moderator who wrote it)
  if (item.authorId != null && decoded.id != null && String(item.authorId) === String(decoded.id)) return true;
  if (item.authorUsername && decoded.username &&
      String(item.authorUsername).toLowerCase() === String(decoded.username).toLowerCase()) return true;
  // moderators: treat as admin-level for summaries
  if (role === 'moderator') return true;
  return false;
}

app.put('/api/class-summaries/:id', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const data = readClassSummaries();
    const idx = (data.summaries || []).findIndex(s => String(s.id) === String(req.params.id));
    if (idx < 0) return res.status(404).json({ msg: 'Summary not found' });
    const item = data.summaries[idx];
    if (!canManageClassSummary(decoded, item)) {
      return res.status(403).json({ msg: 'Only the author or an admin can edit this summary' });
    }
    const { topic, date, details, fullSummary } = req.body || {};
    if (topic != null) item.topic = String(topic).trim();
    if (date != null) item.date = String(date).trim();
    if (details != null) item.details = String(details).trim();
    if (fullSummary != null) item.fullSummary = String(fullSummary).trim();
    item.updatedAt = new Date().toISOString();
    data.summaries[idx] = item;
    writeClassSummaries(data);
    return res.json(item);
  } catch (err) {
    return res.status(401).json({ msg: err.message });
  }
});

app.delete('/api/class-summaries/:id', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const data = readClassSummaries();
    const idx = (data.summaries || []).findIndex(s => String(s.id) === String(req.params.id));
    if (idx < 0) return res.status(404).json({ msg: 'Summary not found' });
    const item = data.summaries[idx];
    if (!canManageClassSummary(decoded, item)) {
      return res.status(403).json({ msg: 'Only the author or an admin can delete this summary' });
    }
    data.summaries.splice(idx, 1);
    writeClassSummaries(data);
    return res.json({ msg: 'Summary deleted', id: req.params.id });
  } catch (err) {
    return res.status(401).json({ msg: err.message });
  }
});


// ===================== SOCKET.IO + WEBRTC SIGNALING =====================
// Room map: code -> Map(socketId -> { name, isHost })
const socketRooms = new Map();

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join-room', ({ code, name, isHost, userId, email, username }) => {
    if (!code) return;
    const roomCode = String(code).toUpperCase();
    socket.data.roomCode = roomCode;
    socket.data.name = name || 'Participant';
    socket.data.isHost = !!isHost;
    socket.data.userId = userId != null ? String(userId) : '';
    socket.data.email = (email || '').toLowerCase();
    socket.data.username = username || '';

    // Ban check for this class code
    if (typeof liveClasses !== 'undefined' && liveClasses.has(roomCode)) {
      const lc = liveClasses.get(roomCode);
      const banned = lc.banned || [];
      const blocked =
        banned.includes(String(socket.data.name).toLowerCase()) ||
        (socket.data.email && banned.includes(socket.data.email)) ||
        (socket.data.userId && banned.includes('id:' + socket.data.userId));
      if (blocked) {
        socket.emit('kicked', { reason: 'You were removed from this class and cannot rejoin this code.' });
        return;
      }
    }

    socket.join(roomCode);

    if (!socketRooms.has(roomCode)) socketRooms.set(roomCode, new Map());
    const room = socketRooms.get(roomCode);

    const peers = [];
    room.forEach((info, id) => {
      peers.push({
        id,
        name: info.name,
        isHost: info.isHost,
        email: info.email,
        username: info.username,
        userId: info.userId
      });
    });

    room.set(socket.id, {
      name: socket.data.name,
      isHost: socket.data.isHost,
      email: socket.data.email,
      username: socket.data.username,
      userId: socket.data.userId
    });

    socket.emit('room-peers', { peers, code: roomCode });
    socket.to(roomCode).emit('user-joined', {
      id: socket.id,
      name: socket.data.name,
      isHost: socket.data.isHost,
      email: socket.data.email,
      username: socket.data.username,
      userId: socket.data.userId
    });

    if (typeof liveClasses !== 'undefined' && liveClasses.has(roomCode)) {
      const lc = liveClasses.get(roomCode);
      if (!lc.participants.includes(socket.data.name)) {
        lc.participants.push(socket.data.name);
      }
    }

    console.log(`${socket.data.name} joined room ${roomCode} (${room.size} in room)`);
  });

  socket.on('kick-participant', ({ code, targetId, name }) => {
    if (!code || !targetId) return;
    const roomCode = String(code).toUpperCase();
    if (!socket.data.isHost || socket.data.roomCode !== roomCode) return;

    const room = socketRooms.get(roomCode);
    const targetInfo = room ? room.get(targetId) : null;
    const targetName = (targetInfo && targetInfo.name) || name || 'Participant';

    if (typeof liveClasses !== 'undefined' && liveClasses.has(roomCode)) {
      const lc = liveClasses.get(roomCode);
      lc.banned = lc.banned || [];
      const keys = [
        String(targetName).toLowerCase(),
        targetInfo && targetInfo.email,
        targetInfo && targetInfo.userId ? ('id:' + targetInfo.userId) : null
      ].filter(Boolean);
      keys.forEach(k => {
        if (!lc.banned.includes(k)) lc.banned.push(k);
      });
      lc.participants = (lc.participants || []).filter(p => p !== targetName);
    }

    io.to(targetId).emit('kicked', {
      reason: 'You were removed from this class by the host. You cannot rejoin this class code.'
    });
    socket.to(roomCode).emit('participant-kicked', { id: targetId, name: targetName });

    if (room) room.delete(targetId);
    const targetSock = io.sockets.sockets.get(targetId);
    if (targetSock) {
      targetSock.leave(roomCode);
      targetSock.data.roomCode = null;
    }
  });

  // WebRTC signaling relay (offer / answer / ice-candidate)
  socket.on('signal', ({ to, data }) => {
    if (!to || !data) return;
    io.to(to).emit('signal', { from: socket.id, data });
  });

  // Whiteboard stroke sync
  socket.on('wb-draw', ({ code, stroke }) => {
    if (!code) return;
    socket.to(String(code).toUpperCase()).emit('wb-draw', { from: socket.id, stroke });
  });

  socket.on('wb-clear', ({ code }) => {
    if (!code) return;
    socket.to(String(code).toUpperCase()).emit('wb-clear', { from: socket.id });
  });

  // File share announce
  socket.on('file-share', ({ code, file }) => {
    if (!code) return;
    socket.to(String(code).toUpperCase()).emit('file-share', { from: socket.id, file });
  });

  socket.on('board-permission', ({ code, allowed }) => {
    if (!code) return;
    socket.to(String(code).toUpperCase()).emit('board-permission', {
      from: socket.id,
      allowed: !!allowed
    });
  });

  socket.on('class-chat', ({ code, text, name }) => {
    if (!code || !(text || '').trim()) return;
    const roomCode = String(code).toUpperCase();
    const payload = {
      text: String(text).trim().slice(0, 1000),
      name: name || socket.data.name || 'Participant',
      at: new Date().toISOString(),
      from: socket.id
    };
    io.to(roomCode).emit('class-chat', payload);
  });

  socket.on('class-event', ({ code, event, detail }) => {
    if (!code) return;
    const roomCode = String(code).toUpperCase();
    io.to(roomCode).emit('class-event', {
      event: event || 'note',
      detail: detail || '',
      name: socket.data.name || 'System',
      at: new Date().toISOString()
    });
  });

  socket.on('board-visibility', ({ code, open }) => {
    if (!code) return;
    socket.to(String(code).toUpperCase()).emit('board-visibility', {
      open: !!open,
      from: socket.id
    });
  });

  socket.on('leave-room', () => {
    leaveCurrentRoom(socket);
  });

  socket.on('disconnect', () => {
    leaveCurrentRoom(socket);
    console.log('Socket disconnected:', socket.id);
  });
});

function leaveCurrentRoom(socket) {
  const roomCode = socket.data.roomCode;
  if (!roomCode) return;
  const room = socketRooms.get(roomCode);
  if (room) {
    room.delete(socket.id);
    if (room.size === 0) socketRooms.delete(roomCode);
  }
  socket.to(roomCode).emit('user-left', { id: socket.id, name: socket.data.name });
  socket.leave(roomCode);
  socket.data.roomCode = null;
}


app.get('/api/gallery/:name', (req, res) => {
  const name = req.params.name;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return res.status(400).json({ msg: 'Invalid gallery name' });
  }

  const dir = path.join(__dirname, 'public', name);
  const imageExt = /\.(jpe?g|png|webp|gif|avif)$/i;

  try {
    if (!fs.existsSync(dir)) return res.json([]);
    const files = fs.readdirSync(dir)
      .filter(f => imageExt.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return res.json(files.map(f => `/${name}/${f}`));
  } catch (err) {
    console.error('Gallery list error:', err);
    return res.status(500).json({ msg: 'Failed to list gallery' });
  }
});




// ===================== PERFORMANCE CERTIFICATES (signed / anti-forgery) =====================
const CERT_FILE = path.join(__dirname, 'certificates.json');
const CERT_HMAC_SECRET = process.env.CERT_HMAC_SECRET || (JWT_SECRET + ':NOA-CERT-v1');

function readCerts() {
  try { return JSON.parse(fs.readFileSync(CERT_FILE, 'utf8')); }
  catch (e) { return { certificates: {} }; }
}
function writeCerts(data) {
  fs.writeFileSync(CERT_FILE, JSON.stringify(data, null, 2));
}

function bandFromPct(pct) {
  const p = Number(pct) || 0;
  if (p >= 95) return 'Outstanding';
  if (p >= 85) return 'Excellent';
  if (p >= 70) return 'Good';
  if (p >= 50) return 'Average';
  return 'Needs Improvement';
}

/** Canonical string of claims — any change breaks the signature */
function canonicalizeCertClaims(claims) {
  return JSON.stringify(claims, Object.keys(claims).sort());
}

function signCertClaims(claims) {
  const body = canonicalizeCertClaims(claims);
  const signature = crypto.createHmac('sha256', CERT_HMAC_SECRET).update(body).digest('hex');
  const contentHash = crypto.createHash('sha256').update(body).digest('hex');
  return { signature, contentHash, body };
}

function verifyCertRecord(record) {
  if (!record || !record.claims || !record.signature) {
    return { ok: false, reason: 'Missing signature block' };
  }
  const { signature, contentHash } = signCertClaims(record.claims);
  const sigOk = crypto.timingSafeEqual
    ? (record.signature.length === signature.length &&
       crypto.timingSafeEqual(Buffer.from(record.signature, 'hex'), Buffer.from(signature, 'hex')))
    : record.signature === signature;
  const hashOk = record.contentHash === contentHash;
  if (!sigOk || !hashOk) return { ok: false, reason: 'Signature mismatch — certificate may be forged or altered' };
  return { ok: true, reason: 'Valid' };
}

function publicCertView(record, req) {
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost';
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const verifyUrl = `${proto}://${host}/certificate.html?v=${encodeURIComponent(record.serial)}`;
  const v = verifyCertRecord(record);
  return {
    token: record.serial,
    serial: record.serial,
    issuedAt: record.claims.issuedAt,
    issuedAtIso: record.claims.issuedAtIso,
    student: record.claims.student,
    scores: record.claims.scores,
    subjectSummaries: record.claims.subjectSummaries || [],
    overall: record.claims.overall,
    band: record.claims.band,
    algorithm: record.algorithm,
    contentHash: record.contentHash,
    signature: record.signature,
    signatureShort: (record.signature || '').slice(0, 16) + '…' + (record.signature || '').slice(-8),
    issuer: record.claims.issuer,
    version: record.claims.version,
    verifyUrl,
    verified: v.ok,
    verifyStatus: v.reason,
    securityNote: 'This document is digitally signed with HMAC-SHA256. Altering name, scores, or dates invalidates the signature. Verify only via the official NOA URL.'
  };
}

function buildCertificateForStudent(studentRow) {
  if (!studentRow) return null;
  const scoresRaw = usersDb.prepare(`
    SELECT subject, score, supposed_score, percentage, assessed_at, grade
    FROM assessments
    WHERE student_id = ? OR lower(student_name) = lower(?)
    ORDER BY assessed_at DESC
  `).all(studentRow.id, studentRow.name || studentRow.username || '');

  const scores = scoresRaw.slice(0, 80).map(s => ({
    subject: s.subject,
    score: s.score,
    supposed_score: s.supposed_score,
    percentage: s.percentage,
    assessed_at: s.assessed_at,
    grade: s.grade,
    band: bandFromPct(s.percentage)
  }));

  // Overall score per subject (average of all attempts for that subject)
  const bySubject = {};
  scores.forEach(s => {
    const key = String(s.subject || 'General').trim() || 'General';
    if (!bySubject[key]) {
      bySubject[key] = { subject: key, sum: 0, count: 0, best: 0, lastDate: '', scores: [], supposedSum: 0, rawSum: 0 };
    }
    const pct = Number(s.percentage) || 0;
    const row = bySubject[key];
    row.sum += pct;
    row.count += 1;
    row.rawSum += Number(s.score) || 0;
    row.supposedSum += Number(s.supposed_score) || 0;
    if (pct > row.best) row.best = pct;
    if (!row.lastDate || String(s.assessed_at || '') > row.lastDate) row.lastDate = s.assessed_at || '';
  });
  const subjectSummaries = Object.keys(bySubject)
    .map(k => {
      const r = bySubject[k];
      const overallPct = Math.round((r.sum / r.count) * 10) / 10;
      return {
        subject: r.subject,
        attempts: r.count,
        overall: overallPct,
        best: r.best,
        lastDate: r.lastDate,
        totalScore: Math.round(r.rawSum * 10) / 10,
        totalOutOf: Math.round(r.supposedSum * 10) / 10,
        band: bandFromPct(overallPct)
      };
    })
    .sort((a, b) => (b.overall || 0) - (a.overall || 0));

  const pcts = scores.map(s => Number(s.percentage) || 0);
  const overall = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0;
  const issuedAtIso = new Date().toISOString();
  const issuedAt = issuedAtIso.split('T')[0];

  // High-entropy serial (not guessable from student id alone)
  const serial = 'NOA-CERT-' + crypto.randomBytes(12).toString('hex').toUpperCase();

  const claims = {
    version: 2,
    issuer: 'Nigeria Olympiad Academy (NOA)',
    serial,
    issuedAt,
    issuedAtIso,
    student: {
      id: studentRow.id,
      name: studentRow.name,
      username: studentRow.username,
      email: studentRow.email,
      school: studentRow.school,
      grade: studentRow.grade
    },
    scores,
    subjectSummaries,
    overall,
    band: bandFromPct(overall),
    scoreFingerprint: crypto
      .createHash('sha256')
      .update(JSON.stringify({ scores, subjectSummaries }))
      .digest('hex')
  };

  const { signature, contentHash } = signCertClaims(claims);
  const record = {
    serial,
    algorithm: 'HMAC-SHA256',
    contentHash,
    signature,
    claims,
    createdAt: issuedAtIso
  };

  const store = readCerts();
  store.certificates = store.certificates || {};
  store.certificates[serial] = record;
  store.certificates['latest:' + studentRow.id] = serial;
  writeCerts(store);
  return record;
}



// ===================== STAFF-OWNED STUDENTS =====================
app.get('/api/staff/students/template', (req, res) => {
  const csv = 'NAME,GRADE,EMAIL,PHONE,SCHOOL,USERNAME,PASSWORD\nAda Obi,Grade 7,ada@example.com,08012345678,Example College,adaobi,StudentPass1\nChidi Okeke,Grade 8,chidi@example.com,08087654321,Green School,chidiokeke,SecurePass9\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="staff_students_template.csv"');
  return res.send(csv);
});

app.get('/api/staff/students', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!isStaffLikeRole(decoded) && !isAdminLikeRole(decoded)) {
      return res.status(403).json({ msg: 'Staff only' });
    }
    ensureStaffFollowsTable();
    let rows;
    if (isAdminLikeRole(decoded) && !isStaffLikeRole(decoded)) {
      rows = usersDb.prepare(
        `SELECT id, name, username, email, phone, school, grade, owner_staff_id, joined FROM users WHERE role = 'student' ORDER BY name`
      ).all();
    } else {
      const sid = resolveStaffDbId(decoded);
      if (!sid) return res.json([]);
      // Students added by this staff OR students who follow this staff
      rows = usersDb.prepare(`
        SELECT id, name, username, email, phone, school, grade, owner_staff_id, joined,
          CASE WHEN owner_staff_id = ? THEN 'added' ELSE 'follower' END AS link
        FROM users
        WHERE role = 'student'
          AND (
            owner_staff_id = ?
            OR id IN (SELECT student_id FROM staff_follows WHERE staff_id = ?)
          )
        ORDER BY name COLLATE NOCASE
      `).all(sid, sid, sid);
    }
    return res.json(rows);
  } catch (e) {
    console.error('staff/students', e);
    return res.status(401).json({ msg: 'Invalid token' });
  }
});

app.post('/api/staff/students', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!isStaffLikeRole(decoded) && !isAdminLikeRole(decoded)) {
      return res.status(403).json({ msg: 'Only staff can add students to their platform' });
    }
    const sid = resolveStaffDbId(decoded);
    if (!sid && isStaffLikeRole(decoded)) {
      return res.status(400).json({ msg: 'Staff profile not found in users table. Use a staff account registered on the platform.' });
    }
    const ownerId = sid || resolveStaffDbId(decoded);
    const { name, grade, email, phone, school, username, password } = req.body || {};
    if (!(name || '').trim() || !(email || '').trim()) {
      return res.status(400).json({ msg: 'Name and email are required' });
    }
    if (!(username || '').trim()) {
      return res.status(400).json({ msg: 'Username is required for student login' });
    }
    if (!(password || '').trim() || String(password).length < 6) {
      return res.status(400).json({ msg: 'Password is required (min 6 characters)' });
    }
    const emailNorm = String(email).trim().toLowerCase();
    const usernameNorm = String(username).trim().toLowerCase().replace(/\s+/g, '');
    const existingEmail = usersDb.prepare(`SELECT id FROM users WHERE lower(email) = ?`).get(emailNorm);
    if (existingEmail) return res.status(409).json({ msg: 'A user with this email already exists' });
    const existingUser = usersDb.prepare(`SELECT id FROM users WHERE lower(username) = ?`).get(usernameNorm);
    if (existingUser) return res.status(409).json({ msg: 'Username already taken' });

    const hash = await bcrypt.hash(String(password).trim(), 10);
    const joined = new Date().toISOString().slice(0, 10);
    const info = usersDb.prepare(`
      INSERT INTO users (username, email, password, name, school, role, bio, image, joined, grade, owner_staff_id, phone)
      VALUES (?, ?, ?, ?, ?, 'student', '', '', ?, ?, ?, ?)
    `).run(
      usernameNorm,
      emailNorm,
      hash,
      String(name).trim(),
      String(school || 'Not specified').trim(),
      joined,
      String(grade || '').trim(),
      ownerId || null,
      String(phone || '').trim()
    );
    return res.status(201).json({
      msg: 'Student added to your platform',
      student: {
        id: info.lastInsertRowid,
        name: String(name).trim(),
        email: emailNorm,
        username: usernameNorm,
        grade: String(grade || '').trim(),
        phone: String(phone || '').trim(),
        school: String(school || '').trim()
      }
    });
  } catch (err) {
    console.error('add staff student', err);
    return res.status(500).json({ msg: err.message });
  }
});

app.post('/api/staff/students/csv', upload.single('file'), async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!isStaffLikeRole(decoded) && !isAdminLikeRole(decoded)) {
      return res.status(403).json({ msg: 'Staff only' });
    }
    const sid = resolveStaffDbId(decoded);
    if (!sid && isStaffLikeRole(decoded)) {
      return res.status(400).json({ msg: 'Staff profile not found' });
    }
    if (!req.file) return res.status(400).json({ msg: 'CSV file required' });
    const text = req.file.buffer ? req.file.buffer.toString('utf8') : fs.readFileSync(req.file.path, 'utf8');
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return res.status(400).json({ msg: 'CSV has no data rows' });
    const header = lines[0].toLowerCase();
    if (!header.includes('name') || !header.includes('email') || !header.includes('username') || !header.includes('password')) {
      return res.status(400).json({ msg: 'CSV must include NAME, EMAIL, USERNAME and PASSWORD columns' });
    }
    const cols = lines[0].split(',').map(c => c.trim().toLowerCase().replace(/^"|"$/g, ''));
    const idx = (key) => cols.findIndex(c => c === key || c === key + 's' || c.includes(key));
    const iName = idx('name');
    const iGrade = idx('grade');
    const iEmail = idx('email');
    const iPhone = idx('phone');
    const iSchool = idx('school');
    const iUser = cols.findIndex(c => c === 'username' || c === 'user name' || c === 'user');
    const iPass = cols.findIndex(c => c === 'password' || c === 'pass');
    let added = 0, skipped = 0;
    const created = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].match(/("([^"]|"")*"|[^,]*)/g).map(p => p.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
      const name = parts[iName] || '';
      const email = (parts[iEmail] || '').toLowerCase();
      const usernameRaw = iUser >= 0 ? (parts[iUser] || '') : '';
      const passwordRaw = iPass >= 0 ? (parts[iPass] || '') : '';
      if (!name || !email || !usernameRaw || !passwordRaw) { skipped++; continue; }
      if (String(passwordRaw).length < 6) { skipped++; continue; }
      const username = String(usernameRaw).trim().toLowerCase().replace(/\s+/g, '');
      if (usersDb.prepare(`SELECT id FROM users WHERE lower(email) = ?`).get(email)) { skipped++; continue; }
      if (usersDb.prepare(`SELECT id FROM users WHERE lower(username) = ?`).get(username)) { skipped++; continue; }
      const grade = iGrade >= 0 ? (parts[iGrade] || '') : '';
      const phone = iPhone >= 0 ? (parts[iPhone] || '') : '';
      const school = iSchool >= 0 ? (parts[iSchool] || 'Not specified') : 'Not specified';
      const hash = await bcrypt.hash(String(passwordRaw).trim(), 10);
      const joined = new Date().toISOString().slice(0, 10);
      const info = usersDb.prepare(`
        INSERT INTO users (username, email, password, name, school, role, bio, image, joined, grade, owner_staff_id, phone)
        VALUES (?, ?, ?, ?, ?, 'student', '', '', ?, ?, ?, ?)
      `).run(username, email, hash, name, school, joined, grade, sid || null, phone);
      added++;
      created.push({ id: info.lastInsertRowid, name, email, username });
    }
    return res.json({ msg: `Added ${added} student(s), skipped ${skipped}`, added, skipped, created });
  } catch (err) {
    console.error('staff csv', err);
    return res.status(500).json({ msg: err.message });
  }
});


app.get('/api/certificate/students', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const role = String(decoded.role || '').toLowerCase();
    const ok = role === 'super_admin' || role === 'admin' || role === 'moderator' || role === 'staff' || decoded.type === 'admin';
    if (!ok) return res.status(403).json({ msg: 'Staff or admin only' });

    const q = (req.query.q || '').trim().toLowerCase();
    const school = (req.query.school || '').trim().toLowerCase();
    const grade = (req.query.grade || '').trim().toLowerCase();

    let sql = `SELECT id, name, username, email, school, grade, owner_staff_id FROM users WHERE role = 'student'`;
    const params = [];
    if (role === 'staff') {
      ensureStaffFollowsTable();
      const sid = resolveStaffDbId(decoded);
      if (sid) {
        sql += ` AND (
          owner_staff_id = ?
          OR id IN (SELECT student_id FROM staff_follows WHERE staff_id = ?)
        )`;
        params.push(sid, sid);
      } else sql += ` AND 0`;
    }
    sql += ` ORDER BY name`;
    let rows = usersDb.prepare(sql).all(...params);

    if (q) {
      rows = rows.filter(r =>
        String(r.name || '').toLowerCase().includes(q) ||
        String(r.username || '').toLowerCase().includes(q) ||
        String(r.email || '').toLowerCase().includes(q)
      );
    }
    if (school) rows = rows.filter(r => String(r.school || '').toLowerCase().includes(school));
    if (grade) rows = rows.filter(r => String(r.grade || '').toLowerCase() === grade || String(r.grade || '').toLowerCase().includes(grade));
    return res.json(rows.slice(0, 300));
  } catch (err) {
    return res.status(401).json({ msg: 'Invalid token' });
  }
});

app.get('/api/certificate/for-student/:id', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const role = String(decoded.role || '').toLowerCase();
    const ok = role === 'super_admin' || role === 'admin' || role === 'moderator' || role === 'staff' || decoded.type === 'admin' ||
      (decoded.type !== 'admin' && String(decoded.id) === String(req.params.id));
    if (!ok) return res.status(403).json({ msg: 'Not allowed' });

    const student = usersDb.prepare(
      `SELECT id, name, username, email, school, grade FROM users WHERE id = ? AND role = 'student'`
    ).get(req.params.id);
    if (!student) return res.status(404).json({ msg: 'Student not found' });
    const record = buildCertificateForStudent(student);
    return res.json(publicCertView(record, req));
  } catch (err) {
    return res.status(401).json({ msg: 'Invalid token' });
  }
});



app.post('/api/certificate/bulk-zip', express.json({ limit: '2mb' }), (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const role = String(decoded.role || '').toLowerCase();
    const ok = role === 'super_admin' || role === 'admin' || role === 'moderator' || role === 'staff' || decoded.type === 'admin';
    if (!ok) return res.status(403).json({ msg: 'Staff or admin only' });

    let ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (!ids.length) return res.status(400).json({ msg: 'No student ids' });
    ids = ids.slice(0, 100);

    const staffId = role === 'staff' ? resolveStaffDbId(decoded) : null;
    const files = [];
    for (const id of ids) {
      const student = usersDb.prepare(
        `SELECT id, name, username, email, school, grade, owner_staff_id FROM users WHERE id = ? AND role = 'student'`
      ).get(id);
      if (!student) continue;
      if (staffId) {
        ensureStaffFollowsTable();
        const linked =
          Number(student.owner_staff_id) === Number(staffId) ||
          !!usersDb.prepare(
            `SELECT 1 FROM staff_follows WHERE staff_id = ? AND student_id = ?`
          ).get(staffId, student.id);
        if (!linked) continue;
      }
      const record = buildCertificateForStudent(student);
      const view = publicCertView(record, req);
      const safeName = String(student.name || student.username || 'student').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40);
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Certificate - ${safeName}</title></head><body>
<h1>NOA Performance Certificate</h1>
<p><strong>${student.name}</strong> (${student.email || ''})</p>
<p>School: ${student.school || '—'} · Grade: ${student.grade || '—'}</p>
<p>Overall: ${view.overall}% · Band: ${(view.band && view.band.label) || ''}</p>
<p>Serial: ${view.serial || ''}</p>
<p>Verify: ${view.verifyUrl || ''}</p>
<table border="1" cellpadding="6" cellspacing="0"><tr><th>Subject</th><th>Score</th><th>%</th><th>Date</th></tr>
${(view.scores || []).map(r => `<tr><td>${r.subject||''}</td><td>${r.score}/${r.supposed_score}</td><td>${r.percentage}</td><td>${r.assessed_at||''}</td></tr>`).join('')}
</table>
</body></html>`;
      files.push({ name: `certificate_${safeName}_${student.id}.html`, content: html });
    }
    if (!files.length) return res.status(404).json({ msg: 'No certificates generated' });

    // Minimal ZIP (store only) without external deps
    function crc32(buf) {
      let c = ~0;
      for (let i = 0; i < buf.length; i++) {
        c ^= buf[i];
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
      }
      return ~c >>> 0;
    }
    function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; }
    function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b; }
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const nameBuf = Buffer.from(f.name, 'utf8');
      const data = Buffer.from(f.content, 'utf8');
      const crc = crc32(data);
      const local = Buffer.concat([
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0),
        nameBuf, data
      ]);
      parts.push(local);
      const cen = Buffer.concat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(offset), nameBuf
      ]);
      central.push(cen);
      offset += local.length;
    }
    const centralBuf = Buffer.concat(central);
    const end = Buffer.concat([
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(centralBuf.length), u32(offset), u16(0)
    ]);
    const zip = Buffer.concat(parts.concat([centralBuf, end]));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="NOA_certificates.zip"');
    return res.send(zip);
  } catch (err) {
    console.error('bulk-zip', err);
    return res.status(500).json({ msg: err.message });
  }
});


app.get('/api/certificate/me', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    let student = null;
    if (decoded.id && decoded.type !== 'admin') {
      student = usersDb.prepare(
        `SELECT id, name, username, email, school, grade FROM users WHERE id = ?`
      ).get(decoded.id);
    }
    if (!student && decoded.username) {
      student = usersDb.prepare(
        `SELECT id, name, username, email, school, grade FROM users WHERE username = ? OR email = ?`
      ).get(decoded.username, decoded.username);
    }
    if (!student) return res.status(404).json({ msg: 'Student profile not found' });

    const record = buildCertificateForStudent(student);
    return res.json(publicCertView(record, req));
  } catch (err) {
    return res.status(401).json({ msg: 'Invalid token' });
  }
});

app.get('/api/certificate/:token', (req, res) => {
  try {
    const store = readCerts();
    const record = (store.certificates || {})[req.params.token];
    if (!record || !record.claims) {
      return res.status(404).json({ msg: 'Certificate not found. Forged or unknown serial.' });
    }
    const view = publicCertView(record, req);
    if (!view.verified) {
      return res.status(422).json({
        msg: view.verifyStatus,
        verified: false,
        serial: view.serial
      });
    }
    return res.json(view);
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
});

/** Explicit verify endpoint for scanners / auditors */
app.post('/api/certificate/verify', (req, res) => {
  try {
    const serial = (req.body && req.body.serial) || (req.body && req.body.token);
    if (!serial) return res.status(400).json({ msg: 'serial required' });
    const store = readCerts();
    const record = (store.certificates || {})[serial];
    if (!record) return res.status(404).json({ verified: false, msg: 'Unknown serial' });
    const v = verifyCertRecord(record);
    return res.json({
      verified: v.ok,
      status: v.reason,
      serial: record.serial,
      contentHash: record.contentHash,
      algorithm: record.algorithm,
      studentName: record.claims?.student?.name,
      overall: record.claims?.overall,
      issuedAt: record.claims?.issuedAt
    });
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
});



// ===================== GROUP / CHANNEL MESSAGES =====================
function ensureStaffChannel(staffId, staffName) {
  let ch = usersDb.prepare(
    `SELECT * FROM msg_channels WHERE type = 'staff' AND owner_id = ?`
  ).get(staffId);
  if (ch) return ch;
  const title = (staffName || 'Staff') + "'s Message";
  const info = usersDb.prepare(`
    INSERT INTO msg_channels (type, owner_id, owner_name, title, closed, created_by, created_by_role)
    VALUES ('staff', ?, ?, ?, 0, ?, 'staff')
  `).run(staffId, staffName || 'Staff', title, staffId);
  return usersDb.prepare(`SELECT * FROM msg_channels WHERE id = ?`).get(info.lastInsertRowid);
}

/** Staff whose message rooms a student can see: owner staff + all followed staff */
function getStudentVisibleStaffIds(studentId) {
  const ids = new Set();
  try {
    const st = usersDb.prepare(`SELECT owner_staff_id FROM users WHERE id = ?`).get(studentId);
    if (st && st.owner_staff_id) ids.add(Number(st.owner_staff_id));
  } catch (e) {}
  try {
    ensureStaffFollowsTable();
    usersDb.prepare(`SELECT staff_id FROM staff_follows WHERE student_id = ?`)
      .all(studentId)
      .forEach(r => {
        if (r && r.staff_id) ids.add(Number(r.staff_id));
      });
  } catch (e) {}
  return [...ids].filter(id => Number.isFinite(id) && id > 0);
}

function studentCanSeeStaffChannel(studentId, staffOwnerId) {
  const sid = Number(staffOwnerId);
  if (!sid) return false;
  return getStudentVisibleStaffIds(studentId).includes(sid);
}

function canAccessChannel(decoded, channel) {
  if (!decoded || !channel) return false;
  const role = String(decoded.role || '').toLowerCase();
  if (role === 'super_admin' || role === 'admin' || role === 'moderator' || decoded.type === 'admin') {
    return true;
  }
  if (channel.type === 'broadcast' && !channel.closed) return true;
  if (channel.type === 'broadcast' && channel.closed) {
    return role === 'super_admin' || role === 'admin' || role === 'moderator';
  }
  if (channel.type === 'staff') {
    if (role === 'staff') {
      const selfId = resolveStaffDbId(decoded) || decoded.id;
      return Number(selfId) === Number(channel.owner_id);
    }
    if (role === 'student') {
      // See channel while following that staff (or assigned owner_staff_id)
      return studentCanSeeStaffChannel(decoded.id, channel.owner_id);
    }
  }
  return false;
}

app.get('/api/messages/channels', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const role = String(decoded.role || '').toLowerCase();
    let list = [];

    if (role === 'super_admin' || role === 'admin' || role === 'moderator' || decoded.type === 'admin') {
      // All staff channels + broadcasts
      const staffUsers = usersDb.prepare(`SELECT id, name, username FROM users WHERE role = 'staff'`).all();
      for (const su of staffUsers) {
        const ch = ensureStaffChannel(su.id, su.name || su.username);
        list.push(ch);
      }
      const broadcasts = usersDb.prepare(
        `SELECT * FROM msg_channels WHERE type = 'broadcast' ORDER BY id DESC`
      ).all();
      list = list.concat(broadcasts);
    } else if (role === 'staff') {
      const sid = resolveStaffDbId(decoded) || decoded.id;
      const name = decoded.username;
      const row = usersDb.prepare(`SELECT name FROM users WHERE id = ?`).get(sid);
      const ch = ensureStaffChannel(sid, (row && row.name) || name);
      list.push(ch);
      const broadcasts = usersDb.prepare(
        `SELECT * FROM msg_channels WHERE type = 'broadcast' AND closed = 0 ORDER BY id DESC`
      ).all();
      list = list.concat(broadcasts);
    } else {
      // student: channels for every staff they follow + their owner staff
      const visibleStaffIds = getStudentVisibleStaffIds(decoded.id);
      for (const sid of visibleStaffIds) {
        const staff = usersDb.prepare(
          `SELECT id, name, username FROM users WHERE id = ? AND lower(role) = 'staff'`
        ).get(sid);
        if (staff) {
          list.push(ensureStaffChannel(staff.id, staff.name || staff.username));
        }
      }
      const broadcasts = usersDb.prepare(
        `SELECT * FROM msg_channels WHERE type = 'broadcast' AND closed = 0 ORDER BY id DESC`
      ).all();
      list = list.concat(broadcasts);
    }

    // Deduplicate channels by id (same staff channel must never appear twice)
    const seen = new Set();
    list = list.filter(ch => {
      if (!ch || ch.id == null) return false;
      const key = String(ch.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Stable user key (never mix admin:/u: prefixes)
    const userKey = decoded.id != null
      ? 'u:' + String(decoded.id)
      : 'u:' + String(decoded.username || 'anon');

    // Real messages only (body or attachment) — excludes empty ghost rows
    const countStmt = usersDb.prepare(`
      SELECT COUNT(1) AS c FROM msg_messages
      WHERE channel_id = ?
        AND (
          length(trim(COALESCE(body, ''))) > 0
          OR length(trim(COALESCE(attachment_url, ''))) > 0
        )
    `);
    const lastStmt = usersDb.prepare(`
      SELECT id, body, sender_name, created_at FROM msg_messages
      WHERE channel_id = ?
        AND (
          length(trim(COALESCE(body, ''))) > 0
          OR length(trim(COALESCE(attachment_url, ''))) > 0
        )
      ORDER BY id DESC LIMIT 1
    `);
    const unreadStmt = usersDb.prepare(`
      SELECT COUNT(1) AS c FROM msg_messages
      WHERE channel_id = ? AND id > ?
        AND (
          length(trim(COALESCE(body, ''))) > 0
          OR length(trim(COALESCE(attachment_url, ''))) > 0
        )
    `);
    const readStmt = usersDb.prepare(
      `SELECT last_read_id FROM msg_channel_reads WHERE user_key = ? AND channel_id = ?`
    );

    const enriched = list.map(ch => {
      const last = lastStmt.get(ch.id);
      const cntRow = countStmt.get(ch.id);
      const messageCount = Number(cntRow && cntRow.c) || 0;
      const readRow = readStmt.get(userKey, ch.id);
      const lastRead = Number(readRow && readRow.last_read_id) || 0;
      const unreadRow = unreadStmt.get(ch.id, lastRead);
      const unread = Number(unreadRow && unreadRow.c) || 0;
      return {
        id: ch.id,
        type: ch.type,
        owner_id: ch.owner_id,
        owner_name: ch.owner_name,
        title: ch.title,
        closed: !!ch.closed,
        created_at: ch.created_at,
        messageCount,
        unreadCount: unread,
        hasUnread: unread > 0,
        lastMessage: last || null,
        lastActivityAt: (last && last.created_at) || ch.created_at || ''
      };
    });

    // Latest activity first (admins, moderators, and everyone)
    enriched.sort((a, b) => {
      const ta = Date.parse(a.lastActivityAt || '') || 0;
      const tb = Date.parse(b.lastActivityAt || '') || 0;
      if (tb !== ta) return tb - ta;
      return (Number(b.id) || 0) - (Number(a.id) || 0);
    });

    return res.json(enriched);
  } catch (err) {
    return res.status(401).json({ msg: 'Invalid token' });
  }
});

app.post('/api/messages/channels', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const role = String(decoded.role || '').toLowerCase();
    if (!(role === 'super_admin' || role === 'admin' || role === 'moderator' || decoded.type === 'admin')) {
      return res.status(403).json({ msg: 'Only admins and moderators can create platform-wide messages' });
    }
    const title = String((req.body && req.body.title) || 'Platform Announcement').trim() || 'Platform Announcement';
    const info = usersDb.prepare(`
      INSERT INTO msg_channels (type, owner_id, owner_name, title, closed, created_by, created_by_role)
      VALUES ('broadcast', NULL, ?, ?, 0, ?, ?)
    `).run(decoded.username || 'Admin', title, decoded.id || null, role || 'admin');
    const ch = usersDb.prepare(`SELECT * FROM msg_channels WHERE id = ?`).get(info.lastInsertRowid);
    return res.status(201).json(ch);
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
});

app.post('/api/messages/channels/:id/close', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const role = String(decoded.role || '').toLowerCase();
    if (!(role === 'super_admin' || role === 'admin' || role === 'moderator' || decoded.type === 'admin')) {
      return res.status(403).json({ msg: 'Only admins and moderators can close channels' });
    }
    const ch = usersDb.prepare(`SELECT * FROM msg_channels WHERE id = ?`).get(req.params.id);
    if (!ch) return res.status(404).json({ msg: 'Channel not found' });
    if (ch.type !== 'broadcast') {
      return res.status(400).json({ msg: 'Only platform-wide (admin) messages can be closed' });
    }
    usersDb.prepare(`UPDATE msg_channels SET closed = 1 WHERE id = ?`).run(ch.id);
    return res.json({ msg: 'Channel closed', id: ch.id });
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
});

app.delete('/api/messages/channels/:id', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const role = String(decoded.role || '').toLowerCase();
    if (!(role === 'super_admin' || role === 'admin' || role === 'moderator' || decoded.type === 'admin')) {
      return res.status(403).json({ msg: 'Only admins and moderators can delete channels' });
    }
    const ch = usersDb.prepare(`SELECT * FROM msg_channels WHERE id = ?`).get(req.params.id);
    if (!ch) return res.status(404).json({ msg: 'Channel not found' });
    if (ch.type !== 'broadcast') {
      return res.status(400).json({ msg: 'Only platform-wide channels can be deleted this way' });
    }
    usersDb.prepare(`DELETE FROM msg_messages WHERE channel_id = ?`).run(ch.id);
    usersDb.prepare(`DELETE FROM msg_channels WHERE id = ?`).run(ch.id);
    return res.json({ msg: 'Channel deleted', id: ch.id });
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
});


app.post('/api/messages/channels/:id/read', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const ch = usersDb.prepare(`SELECT * FROM msg_channels WHERE id = ?`).get(req.params.id);
    if (!ch) return res.status(404).json({ msg: 'Channel not found' });
    if (!canAccessChannel(decoded, ch)) return res.status(403).json({ msg: 'Not allowed' });
    const userKey = decoded.id != null
      ? 'u:' + String(decoded.id)
      : 'u:' + String(decoded.username || 'anon');
    const last = usersDb.prepare(
      `SELECT id FROM msg_messages WHERE channel_id = ? ORDER BY id DESC LIMIT 1`
    ).get(ch.id);
    const lastId = (last && last.id) || 0;
    usersDb.prepare(`
      INSERT INTO msg_channel_reads (user_key, channel_id, last_read_id, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(user_key, channel_id) DO UPDATE SET
        last_read_id = excluded.last_read_id,
        updated_at = datetime('now')
    `).run(userKey, ch.id, lastId);
    return res.json({ ok: true, lastReadId: lastId });
  } catch (err) {
    return res.status(401).json({ msg: err.message });
  }
});

app.get('/api/messages/mention-suggestions', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    jwt.verify(token, JWT_SECRET);
    const q = String(req.query.q || '').trim().toLowerCase();
    let rows = usersDb.prepare(`
      SELECT id, name, username, role FROM users
      WHERE lower(role) IN ('student', 'staff')
      ORDER BY name COLLATE NOCASE LIMIT 80
    `).all();
    if (q) {
      rows = rows.filter(r =>
        String(r.name || '').toLowerCase().includes(q) ||
        String(r.username || '').toLowerCase().includes(q)
      );
    }
    return res.json(rows.slice(0, 20).map(r => ({
      id: r.id,
      name: r.name,
      username: r.username,
      role: r.role,
      handle: '@' + String(r.username || r.name || 'user').replace(/\s+/g, '')
    })));
  } catch (err) {
    return res.status(401).json({ msg: err.message });
  }
});

app.get('/api/messages/channels/:id/messages', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const ch = usersDb.prepare(`SELECT * FROM msg_channels WHERE id = ?`).get(req.params.id);
    if (!ch) return res.status(404).json({ msg: 'Channel not found' });
    if (!canAccessChannel(decoded, ch)) return res.status(403).json({ msg: 'Not allowed in this channel' });
    const rows = usersDb.prepare(
      `SELECT id, channel_id, sender_id, sender_name, sender_role, body, attachment_url, attachment_name, attachment_type, created_at, reply_to_id
       FROM msg_messages
       WHERE channel_id = ?
         AND (
           length(trim(COALESCE(body, ''))) > 0
           OR length(trim(COALESCE(attachment_url, ''))) > 0
         )
       ORDER BY id ASC LIMIT 500`
    ).all(ch.id);

    // Attach parent snippet for replies
    const byId = {};
    rows.forEach(r => { byId[r.id] = r; });
    const enriched = rows.map(r => {
      const out = Object.assign({}, r);
      if (r.reply_to_id && byId[r.reply_to_id]) {
        const p = byId[r.reply_to_id];
        out.reply_to = {
          id: p.id,
          sender_name: p.sender_name || '',
          body: String(p.body || '').slice(0, 160),
          attachment_name: p.attachment_name || ''
        };
      } else if (r.reply_to_id) {
        const p = usersDb.prepare(
          `SELECT id, sender_name, body, attachment_name FROM msg_messages WHERE id = ? AND channel_id = ?`
        ).get(r.reply_to_id, ch.id);
        if (p) {
          out.reply_to = {
            id: p.id,
            sender_name: p.sender_name || '',
            body: String(p.body || '').slice(0, 160),
            attachment_name: p.attachment_name || ''
          };
        }
      }
      return out;
    });
    return res.json({ channel: ch, messages: enriched });
  } catch (err) {
    return res.status(401).json({ msg: 'Invalid token' });
  }
});

/** Delete a single message — admin / moderator only */
app.delete('/api/messages/:msgId', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!isAdminLikeRole(decoded)) {
      return res.status(403).json({ msg: 'Only admins and moderators can delete messages' });
    }
    const msgId = parseInt(req.params.msgId, 10);
    if (!msgId) return res.status(400).json({ msg: 'Invalid message' });
    const msg = usersDb.prepare(`SELECT * FROM msg_messages WHERE id = ?`).get(msgId);
    if (!msg) return res.status(404).json({ msg: 'Message not found' });
    usersDb.prepare(`DELETE FROM msg_messages WHERE id = ?`).run(msgId);
    // Clear reply pointers that pointed at this message
    try {
      usersDb.prepare(`UPDATE msg_messages SET reply_to_id = NULL WHERE reply_to_id = ?`).run(msgId);
    } catch (e) {}
    return res.json({ msg: 'Message deleted', id: msgId });
  } catch (err) {
    return res.status(401).json({ msg: 'Invalid token' });
  }
});

/**
 * Pause (mute) a user from sending messages for a duration.
 * Body: { userId?, minutes?, hours?, durationMinutes? } or derive user from messageId
 */
app.post('/api/messages/pause-user', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!isAdminLikeRole(decoded)) {
      return res.status(403).json({ msg: 'Only admins and moderators can pause messaging' });
    }
    const body = req.body || {};
    let userId = body.userId != null ? Number(body.userId) : null;
    if (!userId && body.messageId) {
      const msg = usersDb.prepare(`SELECT sender_id FROM msg_messages WHERE id = ?`).get(Number(body.messageId));
      if (msg && msg.sender_id) userId = Number(msg.sender_id);
    }
    if (!userId) return res.status(400).json({ msg: 'Target user required' });

    let minutes = Number(body.durationMinutes || body.minutes || 0);
    if (body.hours != null) minutes += Number(body.hours) * 60;
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return res.status(400).json({ msg: 'Choose a pause duration (minutes or hours)' });
    }
    minutes = Math.min(minutes, 60 * 24 * 30); // max 30 days
    const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    const mutedByName = decoded.username || decoded.name || 'Admin';
    usersDb.prepare(`
      INSERT INTO msg_mutes (user_id, muted_until, reason, muted_by, muted_by_name, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        muted_until = excluded.muted_until,
        reason = excluded.reason,
        muted_by = excluded.muted_by,
        muted_by_name = excluded.muted_by_name,
        created_at = datetime('now')
    `).run(userId, until, String(body.reason || 'Paused by moderator').slice(0, 200), decoded.id || null, mutedByName);

    return res.json({
      msg: 'User messaging paused',
      userId,
      mutedUntil: until,
      durationMinutes: minutes
    });
  } catch (err) {
    console.error('pause-user', err);
    return res.status(500).json({ msg: err.message || 'Failed to pause user' });
  }
});

app.delete('/api/messages/pause-user/:userId', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!isAdminLikeRole(decoded)) {
      return res.status(403).json({ msg: 'Only admins and moderators can lift pauses' });
    }
    const userId = parseInt(req.params.userId, 10);
    usersDb.prepare(`DELETE FROM msg_mutes WHERE user_id = ?`).run(userId);
    return res.json({ msg: 'Pause lifted', userId });
  } catch (err) {
    return res.status(401).json({ msg: 'Invalid token' });
  }
});

app.post('/api/messages/channels/:id/messages', upload.single('file'), (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const ch = usersDb.prepare(`SELECT * FROM msg_channels WHERE id = ?`).get(req.params.id);
    if (!ch) return res.status(404).json({ msg: 'Channel not found' });
    if (!canAccessChannel(decoded, ch)) return res.status(403).json({ msg: 'Not allowed in this channel' });
    if (ch.closed) return res.status(400).json({ msg: 'This channel is closed' });

    // Enforce message pause / mute
    if (decoded.id != null && !isAdminLikeRole(decoded)) {
      const mute = getActiveMsgMute(decoded.id);
      if (mute) {
        const untilLocal = new Date(mute.muted_until).toLocaleString();
        return res.status(403).json({
          msg: 'Your messaging is paused until ' + untilLocal + '. Contact an admin if you need help.'
        });
      }
    }

    let body = String((req.body && req.body.body) || '').trim();
    let attachment_url = '';
    let attachment_name = '';
    let attachment_type = '';
    if (req.file) {
      attachment_url = '/uploads/' + req.file.filename;
      attachment_name = req.file.originalname || req.file.filename;
      attachment_type = req.file.mimetype || '';
    }
    if (!body && !attachment_url) {
      return res.status(400).json({ msg: 'Message or file required' });
    }
    if (body.length > 4000) return res.status(400).json({ msg: 'Message too long' });

    let replyToId = null;
    const rawReply = (req.body && req.body.reply_to_id) || '';
    if (rawReply) {
      const rid = parseInt(rawReply, 10);
      if (rid > 0) {
        const parent = usersDb.prepare(
          `SELECT id FROM msg_messages WHERE id = ? AND channel_id = ?`
        ).get(rid, ch.id);
        if (parent) replyToId = parent.id;
      }
    }

    let senderName = decoded.username || 'User';
    try {
      if (decoded.id && decoded.type !== 'admin') {
        const u = usersDb.prepare(`SELECT name, username FROM users WHERE id = ?`).get(decoded.id);
        if (u) senderName = u.name || u.username || senderName;
      }
    } catch (e) {}

    const role = String(decoded.role || '').toLowerCase() || 'student';
    const info = usersDb.prepare(`
      INSERT INTO msg_messages (channel_id, sender_id, sender_name, sender_role, body, attachment_url, attachment_name, attachment_type, reply_to_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ch.id, decoded.id || null, senderName, role, body, attachment_url, attachment_name, attachment_type, replyToId);
    const msg = usersDb.prepare(`SELECT * FROM msg_messages WHERE id = ?`).get(info.lastInsertRowid);
    if (msg && msg.reply_to_id) {
      const p = usersDb.prepare(
        `SELECT id, sender_name, body, attachment_name FROM msg_messages WHERE id = ?`
      ).get(msg.reply_to_id);
      if (p) {
        msg.reply_to = {
          id: p.id,
          sender_name: p.sender_name || '',
          body: String(p.body || '').slice(0, 160),
          attachment_name: p.attachment_name || ''
        };
      }
    }
    return res.status(201).json(msg);
  } catch (err) {
    console.error('msg post', err);
    return res.status(500).json({ msg: err.message });
  }
});


setInterval(() => { try { pruneExpiredConversations(readAiConv()); } catch (e) {} }, 60 * 60 * 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Socket.IO signaling ready for WebRTC classes`);
  console.log(`Frontend: http://localhost:${PORT}/index.html`);
  console.log(`Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`Admin (env super_admin only): http://localhost:${PORT}/admin.html`);
});
