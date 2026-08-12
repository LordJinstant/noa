const express = require('express');
const http = require('http');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
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
    student_id INTEGER,
    student_name TEXT,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(staff_id, student_id)
  );
`);

// In-memory live class rooms: code -> { host, title, createdAt, sharedFile }
const liveClasses = new Map();



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

  if (!username || !password || !type) {
    return res.status(400).json({ msg: 'Username, password and type are required' });
  }

  if (!['admin', 'student', 'staff'].includes(type)) {
    return res.status(400).json({ msg: 'Invalid login type' });
  }

  try {
    if (type === 'admin') {
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

      const superAdmin = superAdmins.find(a => a.username === username || a.email === username);

      if (superAdmin) {
        const match = await safeBcryptCompare(password, superAdmin.password);
        if (!match) {
          return res.status(401).json({ msg: 'Invalid credentials' });
        }

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
            type: 'admin'
          }
        });
      }

      const data = readJson('admins.json');
      const account = (data.admins || []).find(u => u.username === username || u.email === username);

      if (!account) {
        return res.status(401).json({ msg: 'Invalid credentials' });
      }

      const match = await safeBcryptCompare(password, account.password);
      if (!match) {
        return res.status(401).json({ msg: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { id: account.id, username: account.username, role: account.role, type: 'admin' },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      return res.json({
        token,
        user: {
          id: account.id,
          name: account.name,
          username: account.username,
          role: account.role,
          type: 'admin'
        }
      });
    }

    const account = usersDb.prepare(`
      SELECT * FROM users
      WHERE (username = ? OR email = ?)
      AND role IN ('student', 'staff_pending', 'staff')
    `).get(username, username);

    if (!account) {
      return res.status(401).json({ msg: 'Invalid credentials' });
    }

    const match = await safeBcryptCompare(password, account.password);
    if (!match) {
      return res.status(401).json({ msg: 'Invalid credentials' });
    }

    const token = jwt.sign(
      {
        id: account.id,
        username: account.username,
        role: account.role,
        type
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      user: {
        id: account.id,
        name: account.name,
        username: account.username,
        role: account.role,
        type
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ msg: 'Server error during login', detail: String(err.message || err) });
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
        source: 'admins.json'
      }));
    } catch (e) {}

    // Approved staff from users DB (created via Staff option or approved applications)
    try {
      const staffRows = usersDb.prepare(`
        SELECT id, username, email, name, role, joined
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
          joined: s.joined
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

app.get('/api/public-directory', (req, res) => {
  try {
    const users = usersDb.prepare(`
      SELECT id, username, name, email, school, role, bio, image as avatar, joined, grade
      FROM users
      WHERE role IN ('student', 'staff')
      ORDER BY role ASC, name ASC
    `).all();

    const staff = users
      .filter(u => u.role === 'staff')
      .map(u => ({
        id: u.id,
        name: u.name || u.username || 'Unnamed Staff',
        username: u.username || '',
        role: 'staff',
        email: u.email || '',
        school: u.school || '',
        department: u.school || 'General',
        office: u.bio || '',
        bio: u.bio || '',
        avatar: u.avatar || '',
        joined: u.joined || ''
      }));

    const students = users
      .filter(u => u.role === 'student')
      .map(u => ({
        id: u.id,
        name: u.name || u.username || 'Unnamed Student',
        username: u.username || '',
        role: 'student',
        grade: (u.grade || '').trim() || 'Not set',
        email: u.email || '',
        school: u.school || '',
        major: u.school || 'General',
        bio: u.bio || '',
        avatar: u.avatar || '',
        joined: u.joined || ''
      }));

    return res.json({ staff, students });
  } catch (err) {
    console.error('Public directory error:', err);
    return res.status(500).json({ msg: 'Failed to load directory' });
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

app.get('/api/dashboard-stats', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'No token' });

  try {
    jwt.verify(token, JWT_SECRET);

    const totalUsers = usersDb.prepare(`SELECT COUNT(*) as count FROM users`).get().count;
    const pendingStaff = usersDb.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'staff_pending'`).get().count;
    const totalPosts = (readJson('posts.json').posts || []).length;

    return res.json({
      users: totalUsers,
      pendingUsers: pendingStaff,
      posts: totalPosts,
      tickets: tickets.length
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
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

app.post('/api/tickets/:id/approve', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'No token' });

  try {
    jwt.verify(token, JWT_SECRET);

    const ticketId = parseInt(req.params.id);
    const ticket = tickets.find(t => t.id === ticketId);

    if (!ticket || ticket.type !== 'staff_application') {
      return res.status(404).json({ msg: 'Ticket not found' });
    }

    const result = usersDb.prepare(`
      UPDATE users
      SET role = 'staff'
      WHERE id = ? AND role = 'staff_pending'
    `).run(ticket.staffId);

    if (result.changes === 0) {
      return res.status(400).json({ msg: 'User already approved or not found' });
    }

    ticket.status = 'approved';
    ticket.approvedAt = new Date().toLocaleString();

    return res.json({ msg: 'Staff application approved successfully!' });
  } catch (err) {
    console.error('Approve ticket error:', err);
    return res.status(500).json({ msg: 'Server error' });
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
  if (!requireHostAuth(req, res)) return;
  try {
    const students = usersDb.prepare(`
      SELECT id, name, username, email, school, role, bio, image as avatar, joined, grade
      FROM users
      WHERE role = 'student'
      ORDER BY name ASC
    `).all();
    return res.json(students);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: 'Failed to load students' });
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
// Standard rating = arithmetic mean: SUM(ratings) / COUNT(ratings)
// One rating per student per staff (UNIQUE). Only students may vote.

function computeStaffRating(staffId) {
  const row = usersDb.prepare(`
    SELECT
      COALESCE(SUM(rating), 0) as sum_rating,
      COUNT(*) as total,
      AVG(rating) as avg_rating
    FROM staff_ratings
    WHERE staff_id = ?
  `).get(staffId);
  const total = row?.total || 0;
  const sum = row?.sum_rating || 0;
  // Prefer explicit sum/count; fall back to SQL AVG
  const avg = total > 0 ? sum / total : 0;
  const breakdown = usersDb.prepare(`
    SELECT rating, COUNT(*) as count FROM staff_ratings
    WHERE staff_id = ? GROUP BY rating ORDER BY rating DESC
  `).all(staffId);
  return {
    avg: Math.round(avg * 10) / 10,
    total,
    sum,
    breakdown
  };
}

app.get('/api/staff-ratings/:staffId', (req, res) => {
  try {
    const staffId = parseInt(req.params.staffId, 10);
    if (!staffId) return res.status(400).json({ msg: 'Invalid staff id' });
    const stats = computeStaffRating(staffId);
    let myRating = null;
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.id) {
          const mine = usersDb.prepare(
            `SELECT rating FROM staff_ratings WHERE staff_id = ? AND student_id = ?`
          ).get(staffId, decoded.id);
          if (mine) myRating = mine.rating;
        }
      } catch (e) {}
    }
    return res.json({ ...stats, myRating });
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
});

app.post('/api/staff-ratings', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required to rate staff' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const role = String(decoded.role || '').toLowerCase();

    // Only registered students can rate (prevents staff/admin self-boosting)
    if (role && role !== 'student') {
      return res.status(403).json({
        msg: 'Only students can rate staff. Ratings use the average of all student votes.'
      });
    }
    if (decoded.type === 'admin' || role === 'super_admin' || role === 'admin' || role === 'moderator' || role === 'staff') {
      return res.status(403).json({ msg: 'Only students can rate staff' });
    }
    if (!decoded.id) {
      return res.status(400).json({ msg: 'Invalid student session — please log in again' });
    }

    const { staff_id, rating } = req.body;
    const staffId = parseInt(staff_id, 10);
    const r = parseInt(rating, 10);
    if (!staffId || !r || r < 1 || r > 5) {
      return res.status(400).json({ msg: 'staff_id and rating 1–5 required' });
    }

    // Staff must exist and be approved staff
    const staffUser = usersDb.prepare(
      `SELECT id, role FROM users WHERE id = ? AND role = 'staff'`
    ).get(staffId);
    if (!staffUser) {
      return res.status(404).json({ msg: 'Staff member not found' });
    }

    // One vote per student: insert or replace that student's rating only
    usersDb.prepare(`
      INSERT INTO staff_ratings (staff_id, student_id, student_name, rating)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(staff_id, student_id) DO UPDATE SET
        rating = excluded.rating,
        student_name = excluded.student_name,
        created_at = datetime('now')
    `).run(
      staffId,
      decoded.id,
      decoded.username || decoded.name || 'Student',
      r
    );

    const stats = computeStaffRating(staffId);
    return res.json({
      msg: 'Rating saved. Displayed score is the average of all student ratings.',
      avg: stats.avg,
      total: stats.total,
      sum: stats.sum,
      myRating: r
    });
  } catch (err) {
    console.error('Rating error:', err);
    return res.status(401).json({ msg: 'Invalid token or error: ' + err.message });
  }
});

// ===================== LIVE CLASS ROOMS =====================
app.post('/api/classes/start', (req, res) => {
  const decoded = requireHostAuth(req, res);
  if (!decoded) return;
  let host = decoded.username || decoded.name || 'Host';
  const code = (req.body.code || '').trim().toUpperCase() || ('NOA-' + Math.random().toString(36).slice(2, 8).toUpperCase());
  if (liveClasses.has(code)) {
    return res.status(409).json({ msg: 'Class code already in use. Choose another.' });
  }
  liveClasses.set(code, {
    host,
    title: req.body.title || 'Olympiad Class',
    createdAt: new Date().toISOString(),
    participants: [],
    sharedFile: null
  });
  return res.json({ msg: 'Class started', code, host });
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
  liveClasses.delete(req.params.code.toUpperCase());
  return res.json({ msg: 'Class ended' });
});

app.get('/api/top-assessments', (req, res) => {
  try {
    const subject = (req.query.subject || '').trim();
    let sql = `
      SELECT student_name, subject, percentage, score, supposed_score, assessed_at, grade
      FROM assessments
      WHERE 1=1`;
    const params = [];
    if (subject) {
      sql += ` AND lower(subject) = lower(?)`;
      params.push(subject);
    }
    sql += ` ORDER BY percentage DESC, assessed_at DESC LIMIT 30`;
    const rows = usersDb.prepare(sql).all(...params);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
});



// ===================== AI KNOWLEDGE ASSISTANT =====================
const AI_DB_FILE = path.join(__dirname, 'database.json');
const AI_CONV_FILE = path.join(__dirname, 'ai-conversations.json');

function readAiDb() {
  try {
    return JSON.parse(fs.readFileSync(AI_DB_FILE, 'utf8'));
  } catch (e) {
    return { behaviorals: '', knowledge: [] };
  }
}
function writeAiDb(data) {
  fs.writeFileSync(AI_DB_FILE, JSON.stringify(data, null, 2));
}
function readAiConv() {
  try {
    return JSON.parse(fs.readFileSync(AI_CONV_FILE, 'utf8'));
  } catch (e) {
    return { conversations: [] };
  }
}
function writeAiConv(data) {
  fs.writeFileSync(AI_CONV_FILE, JSON.stringify(data, null, 2));
}

// 24 hours of inactivity → conversation is cleared
const AI_CONV_TTL_MS = 24 * 60 * 60 * 1000;

function conversationLastActivity(conv) {
  if (!conv) return 0;
  if (conv.updatedAt) {
    const t = Date.parse(conv.updatedAt);
    if (!Number.isNaN(t)) return t;
  }
  const msgs = conv.messages || [];
  if (msgs.length) {
    const t = Date.parse(msgs[msgs.length - 1].at || '');
    if (!Number.isNaN(t)) return t;
  }
  if (conv.createdAt) {
    const t = Date.parse(conv.createdAt);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function isConversationExpired(conv) {
  const last = conversationLastActivity(conv);
  if (!last) return true;
  return (Date.now() - last) > AI_CONV_TTL_MS;
}

/** Remove conversations with no activity for 24+ hours. Returns cleaned store. */
function pruneExpiredConversations(store) {
  const data = store || readAiConv();
  data.conversations = data.conversations || [];
  const before = data.conversations.length;
  data.conversations = data.conversations.filter(c => !isConversationExpired(c));
  if (data.conversations.length !== before) {
    writeAiConv(data);
  }
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
    conv = (data.conversations || []).find(
      c => c.visitorId === visitorId && c.status !== 'closed' && !isConversationExpired(c)
    );
  }
  return { store: data, conv };
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

/** Fast retrieval ranker — only uses trained knowledge */
function rankKnowledge(question, knowledge) {
  const qTokens = tokenize(question);
  const qLower = String(question || '').toLowerCase();
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
      if (k.length > 2 && qLower.includes(k)) score += 4;
    }
    // phrase boost
    if (textLower.length > 20) {
      const snippet = textLower.slice(0, 40);
      if (qLower.includes(snippet.slice(0, 15))) score += 2;
    }
    if (score > 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function buildAiReply(question, db) {
  const ranked = rankKnowledge(question, db.knowledge);
  const attitude = (db.behaviorals || '').trim();
  if (!ranked.length || ranked[0].score < 3) {
    return {
      reply: (attitude ? '' : '') +
        "I don't have the information that fully answers that yet. " +
        "Would you like me to connect you with a human moderator? " +
        "Share your name, email, and phone number and I'll open a support chat for you.",
      confidence: 0,
      matched: []
    };
  }
  const top = ranked.slice(0, 2).map(r => r.item.text);
  let reply = top.join(' ');
  if (reply.length > 600) reply = reply.slice(0, 580) + '…';
  // Light behavioral framing (not inventing facts)
  if (attitude && ranked[0].score >= 5) {
    // Keep attitude as system style note — prefix short courtesy only
    if (!/^hello|^hi |^thank/i.test(reply)) {
      reply = reply;
    }
  }
  reply += "\n\nIf you need a person to follow up, ask for a moderator and leave your name, email, and phone.";
  return {
    reply,
    confidence: ranked[0].score,
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

function requireAdminOrMod(req, res) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) { res.status(401).json({ msg: 'Login required' }); return null; }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const role = String(decoded.role || '').toLowerCase();
    if (role === 'super_admin' || role === 'admin' || role === 'moderator' || decoded.type === 'admin') {
      return decoded;
    }
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

// Train knowledge (super admin only)
app.get('/api/ai/database', (req, res) => {
  if (!requireSuperAdminOnly(req, res)) return;
  return res.json(readAiDb());
});

app.post('/api/ai/train', (req, res) => {
  if (!requireSuperAdminOnly(req, res)) return;
  try {
    const { text, keywords } = req.body || {};
    const body = String(text || '').trim();
    if (!body || body.length < 8) {
      return res.status(400).json({ msg: 'Training text must be at least 8 characters' });
    }
    const db = readAiDb();
    db.knowledge = db.knowledge || [];
    const id = Date.now();
    const autoKw = tokenize(body).slice(0, 12);
    const extra = Array.isArray(keywords) ? keywords : String(keywords || '').split(',').map(s => s.trim()).filter(Boolean);
    db.knowledge.push({
      id,
      text: body,
      keywords: [...new Set([...extra, ...autoKw])],
      addedAt: new Date().toISOString().split('T')[0]
    });
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

// Public chat — retrieval only from database.json
app.post('/api/ai/chat', (req, res) => {
  try {
    const { message, visitorId, name, email, phone, conversationId } = req.body || {};
    const text = String(message || '').trim();
    if (!text) return res.status(400).json({ msg: 'Message required' });

    const db = readAiDb();
    let { store, conv } = getActiveConversation(readAiConv(), { conversationId, visitorId });
    store.conversations = store.conversations || [];
    // If client sent an expired conversationId, start completely fresh
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

    // Update contact fields when provided
    if (name) conv.name = String(name).trim();
    if (email) conv.email = String(email).trim();
    if (phone) conv.phone = String(phone).trim();

    conv.messages.push({ role: 'user', text, at: new Date().toISOString() });

    // Detect handoff intent
    const lower = text.toLowerCase();
    const wantsHuman = /\b(moderator|human|agent|support|real person|talk to someone|speak to)\b/.test(lower);

    let replyObj;
    if (conv.status === 'handoff' || conv.status === 'open') {
      replyObj = {
        reply: "You're in the moderator queue. A moderator will reply here soon. You can keep adding details.",
        confidence: 0,
        matched: []
      };
      conv.unreadModerator = true;
    } else {
      replyObj = buildAiReply(text, db);
      // Apply behavioral as leading system line only when confidence high
      if (db.behaviorals && replyObj.confidence >= 3) {
        // Do not dump full attitude; AI stays factual from knowledge
      }
      if (wantsHuman) {
        conv.status = 'handoff';
        conv.unreadModerator = true;
        conv.summary = summarizeConversation(conv.messages);
        replyObj.reply += "\n\nI've flagged this conversation for a moderator. Please confirm your name, email, and phone number if you haven't already.";
      }
    }

    conv.messages.push({ role: 'assistant', text: replyObj.reply, at: new Date().toISOString() });
    conv.updatedAt = new Date().toISOString();
    conv.summary = summarizeConversation(conv.messages);
    writeAiConv(store);

    return res.json({
      reply: replyObj.reply,
      confidence: replyObj.confidence,
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
    conv.messages.push({
      role: 'assistant',
      text: 'A moderator has been notified. They will continue this conversation with you shortly.',
      at: new Date().toISOString()
    });
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
      .map(c => ({
        id: c.id,
        status: c.status,
        name: c.name,
        updatedAt: c.updatedAt,
        preview: (c.messages || []).slice(-1)[0]?.text?.slice(0, 80) || '',
        expiresInHours: 24
      }));
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
      return res.status(410).json({
        msg: 'Conversation expired after 24 hours of inactivity. Start a new chat.',
        expired: true
      });
    }
    // Public can load own if visitorId matches
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
    .map(c => ({
      id: c.id,
      name: c.name || 'Visitor',
      email: c.email || '',
      phone: c.phone || '',
      status: c.status,
      unreadModerator: !!c.unreadModerator,
      summary: c.summary || '',
      updatedAt: c.updatedAt,
      messageCount: (c.messages || []).length
    }));
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
    conv.messages.push({
      role: 'moderator',
      text,
      at: new Date().toISOString(),
      by: decoded.username || decoded.name || 'Moderator'
    });
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


// ===================== SOCKET.IO + WEBRTC SIGNALING =====================
// Room map: code -> Map(socketId -> { name, isHost })
const socketRooms = new Map();

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join-room', ({ code, name, isHost }) => {
    if (!code) return;
    const roomCode = String(code).toUpperCase();
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.name = name || 'Participant';
    socket.data.isHost = !!isHost;

    if (!socketRooms.has(roomCode)) socketRooms.set(roomCode, new Map());
    const room = socketRooms.get(roomCode);

    // Existing peers for the new joiner
    const peers = [];
    room.forEach((info, id) => {
      peers.push({ id, name: info.name, isHost: info.isHost });
    });

    room.set(socket.id, { name: socket.data.name, isHost: socket.data.isHost });

    // Tell the new user who is already here
    socket.emit('room-peers', { peers, code: roomCode });

    // Tell others someone joined
    socket.to(roomCode).emit('user-joined', {
      id: socket.id,
      name: socket.data.name,
      isHost: socket.data.isHost
    });

    // Update liveClasses participants if present
    if (typeof liveClasses !== 'undefined' && liveClasses.has(roomCode)) {
      const lc = liveClasses.get(roomCode);
      if (!lc.participants.includes(socket.data.name)) {
        lc.participants.push(socket.data.name);
      }
    }

    console.log(`${socket.data.name} joined room ${roomCode} (${room.size} in room)`);
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



setInterval(() => { try { pruneExpiredConversations(readAiConv()); } catch (e) {} }, 60 * 60 * 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Socket.IO signaling ready for WebRTC classes`);
  console.log(`Frontend: http://localhost:${PORT}/index.html`);
  console.log(`Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`Admin (env super_admin only): http://localhost:${PORT}/admin.html`);
});
