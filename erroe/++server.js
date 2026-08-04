const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'Jinjin28821.';
const USERS_DB = process.env.USERS_DB || 'users.db';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.get('/platform', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'platform.html'));
});

const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/'),
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



const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return file.includes('posts') ? { posts: [] } : { admins: [] };
  }
};

const writeJson = (file, data) => {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

const tickets = [];

app.post('/api/register', async (req, res) => {
  const { username, password, name, school, email } = req.body;

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

    usersDb.prepare(`
      INSERT INTO users (username, email, password, name, school, role, joined)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      username,
      email || username,
      hashedPassword,
      name,
      school || 'Not specified',
      'student',
      joined
    );

    return res.status(201).json({
      msg: 'Account created successfully! You can now login.',
      user: { name, username, role: 'student' }
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
        const match = await bcrypt.compare(password, superAdmin.password);
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

      const match = await bcrypt.compare(password, account.password);
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

    const match = await bcrypt.compare(password, account.password);
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
    return res.status(500).json({ msg: 'Server error' });
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
      otherAdmins = data.admins || [];
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
    if (decoded.type !== 'admin') return res.status(403).json({ msg: 'Only admins can create admins' });

    const { username, email, password, name, role = 'admin' } = req.body;

    if (!username || !email || !password || !name) {
      return res.status(400).json({ msg: 'Username, email, password and name are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ msg: 'Password must be at least 6 characters' });
    }

    const data = readJson('admins.json');
    const exists = (data.admins || []).find(a => a.username === username || a.email === email);
    if (exists) {
      return res.status(409).json({ msg: 'Username or email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newAdmin = {
      id: Date.now(),
      username,
      email,
      password: hashedPassword,
      name,
      role,
      createdAt: new Date().toISOString()
    };

    data.admins = data.admins || [];
    data.admins.push(newAdmin);
    writeJson('admins.json', data);

    return res.status(201).json({
      msg: 'Admin created successfully',
      admin: { id: newAdmin.id, username, email, name, role }
    });
  } catch (err) {
    console.error('Create admin error:', err);
    return res.status(401).json({ msg: 'Invalid or expired token' });
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
      SELECT id, username, name, email, school, role, bio, image as avatar, joined
      FROM users
      WHERE role IN ('student', 'staff')
      ORDER BY role ASC, name ASC
    `).all();

    const staff = users
      .filter(u => u.role === 'staff')
      .map(u => ({
        id: u.id,
        name: u.name || u.username || 'Unnamed Staff',
        role: 'staff',
        email: u.email || '',
        department: u.school || 'General',
        office: u.bio || '',
        avatar: u.avatar || ''
      }));

    const students = users
      .filter(u => u.role === 'student')
      .map(u => ({
        id: u.id,
        name: u.name || u.username || 'Unnamed Student',
        grade: 'Student',
        email: u.email || '',
        major: u.school || 'General',
        avatar: u.avatar || ''
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
app.get('/api/students-list', (req, res) => {
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
    const { period = 'all' } = req.query;
    let sql = `SELECT * FROM assessments WHERE student_id = ? OR lower(student_name) = lower(?)`;
    const params = [decoded.id, decoded.username || ''];

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
    sql += ` ORDER BY assessed_at ASC`;
    const rows = usersDb.prepare(sql).all(...params);
    return res.json(rows);
  } catch (err) {
    return res.status(401).json({ msg: 'Invalid token' });
  }
});

app.post('/api/assessments', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Allow staff / admin / super_admin
    if (!['admin', 'super_admin', 'staff', 'staff_pending'].includes(decoded.role) && decoded.type !== 'admin') {
      // still allow if they are logged as admin type
    }

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
app.get('/api/staff-ratings/:staffId', (req, res) => {
  try {
    const rows = usersDb.prepare(`
      SELECT rating, COUNT(*) as count FROM staff_ratings WHERE staff_id = ? GROUP BY rating
    `).all(req.params.staffId);
    const all = usersDb.prepare(`SELECT AVG(rating) as avg, COUNT(*) as total FROM staff_ratings WHERE staff_id = ?`).get(req.params.staffId);
    return res.json({ avg: all?.avg ? Math.round(all.avg * 10) / 10 : 0, total: all?.total || 0, breakdown: rows });
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
});

app.post('/api/staff-ratings', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: 'Login required to rate staff' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { staff_id, rating } = req.body;
    const r = parseInt(rating, 10);
    if (!staff_id || !r || r < 1 || r > 5) return res.status(400).json({ msg: 'staff_id and rating 1-5 required' });

    usersDb.prepare(`
      INSERT INTO staff_ratings (staff_id, student_id, student_name, rating)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(staff_id, student_id) DO UPDATE SET rating = excluded.rating, created_at = datetime('now')
    `).run(staff_id, decoded.id || null, decoded.username || decoded.name || 'Student', r);

    const all = usersDb.prepare(`SELECT AVG(rating) as avg, COUNT(*) as total FROM staff_ratings WHERE staff_id = ?`).get(staff_id);
    return res.json({ msg: 'Rating saved', avg: Math.round((all.avg || 0) * 10) / 10, total: all.total });
  } catch (err) {
    return res.status(401).json({ msg: 'Invalid token or error: ' + err.message });
  }
});

// ===================== LIVE CLASS ROOMS =====================
app.post('/api/classes/start', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  let host = 'Host';
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      host = decoded.username || decoded.name || 'Host';
    } catch (e) {}
  }
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
    const rows = usersDb.prepare(`
      SELECT student_name, subject, percentage, score, supposed_score, assessed_at, grade
      FROM assessments
      ORDER BY percentage DESC, assessed_at DESC
      LIMIT 15
    `).all();
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
});


app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`Frontend: http://localhost:${PORT}/platform`);
  console.log(`Register: POST /api/register`);
  console.log(`Staff Register: POST /api/register-staff`);
  console.log(`Login: POST /api/login`);
  console.log(`Admins: GET/POST /api/admins`);
  console.log(`Users: GET /api/users`);
  console.log(`Public Directory: GET /api/public-directory`);
  console.log(`Posts: GET/POST/PUT/DELETE /api/posts`);
});