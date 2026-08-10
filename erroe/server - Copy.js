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
const JWT_SECRET = process.env.JWT_SECRET || "Jinjin28821.";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "Lord Jinstant";
const USERS_DB = process.env.USERS_DB || "users.db";

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
// Serve platform.html
app.get('/platform', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'platform.html'));
});

// Ensure upload folder exists
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const admins = [];
let i = 1;

while (process.env[`SUPER_ADMIN_${i}_USERNAME`]) {
  admins.push({
    username: process.env[`SUPER_ADMIN_${i}_USERNAME`],
    email: process.env[`SUPER_ADMIN_${i}_EMAIL`],
    name: process.env[`SUPER_ADMIN_${i}_NAME`],
    password: process.env[`SUPER_ADMIN_${i}_PASSWORD`],
  });
  i++;
}

console.log(admins);

// Multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// SQLite database for users only
const usersDb = new Database(USERS_DB);

// Ensure table has all columns - safe to run every time
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

// Add columns if table was created before (won't error if they exist)
const columns = usersDb.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);
if (!columns.includes('bio')) {
  usersDb.exec(`ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''`);
  console.log('✅ Added bio column to users table');
}
if (!columns.includes('image')) {
  usersDb.exec(`ALTER TABLE users ADD COLUMN image TEXT DEFAULT ''`);
  console.log('✅ Added image column to users table');
}

// Helper functions
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return file.includes('posts')? { posts: [] } : { admins: [] };
  }
};

const writeJson = (file, data) => {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

// ===================== USER REGISTRATION =====================
app.post('/api/register', async (req, res) => {
  const { username, password, name, school, email } = req.body;

  if (!username ||!password ||!name) {
    return res.status(400).json({ msg: "Username, password and name are required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ msg: "Password must be at least 6 characters" });
  }

  try {
    const exists = usersDb.prepare(`
      SELECT id FROM users WHERE username =? OR email =?
    `).get(username, email || username);

    if (exists) {
      return res.status(409).json({ msg: "Username or email already taken" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const joined = new Date().toISOString().split('T')[0];

    const insertUser = usersDb.prepare(`
      INSERT INTO users (username, email, password, name, school, role, joined)
      VALUES (?,?,?,?,?,?,?)
    `);

    const info = insertUser.run(
      username,
      email || username,
      hashedPassword,
      name,
      school || "Not specified",
      "student",
      joined
    );

    res.status(201).json({
      msg: "Account created successfully! You can now login.",
      user: { name, username, role: "student" }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
});

// ===================== STAFF REGISTRATION =====================
// ===================== STAFF REGISTRATION =====================
// ===================== STAFF REGISTRATION + AUTO TICKET =====================
app.post('/api/register-staff', upload.single('image'), async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim();
  const phone = (req.body.phone || '').trim();
  const bio = (req.body.bio || '').trim();

  if (!name || !email || !phone) {
    return res.status(400).json({ msg: "Name, email and phone are required" });
  }

  try {
    const exists = usersDb.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
    if (exists) return res.status(409).json({ msg: "Email already registered" });

    const joined = new Date().toISOString().split('T')[0];
    const defaultPassword = await bcrypt.hash("staff12345", 10);
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : '';

    const insertStaff = usersDb.prepare(`
      INSERT INTO users (username, email, password, name, school, role, bio, image, joined)
      VALUES (?,?,?,?,?,?,?,?,?)
    `);

    const info = insertStaff.run(email, email, defaultPassword, name, phone, "staff_pending", bio, imageUrl, joined);

    // === AUTO CREATE TICKET ===
    tickets.unshift({
      id: Date.now(),
      type: "staff_application",
      title: "New Staff Application",
      message: `${name} has submitted a staff application.`,
      name: name,
      email: email,
      phone: phone,
      bio: bio,
      staffId: info.lastInsertRowid,
      status: "pending",
      time: new Date().toLocaleString()
    });

    console.log(`✅ New Staff Application + Ticket created for ${name}`);

    res.status(201).json({ 
      msg: "Application submitted successfully. We will contact you.",
      staffId: info.lastInsertRowid 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error: " + err.message });
  }
});

// ===================== LOGIN (SUPER ADMIN + ADMINS.JSON + USERS.DB) =====================
app.post('/api/login', async (req, res) => {
  const { username, password, type } = req.body;

  if (!username ||!password ||!type) {
    return res.status(400).json({ msg: "Username, password and type are required" });
  }

  if (type!== 'admin' && type!== 'student' && type!== 'staff') {
    return res.status(400).json({ msg: "Invalid login type" });
  }

  try {
    if (type === 'admin') {
      // SUPER ADMIN FROM.ENV - CHECK FIRST
      const superAdmins = [];
let i = 1;

while (process.env[`SUPER_ADMIN_${i}_USERNAME`]) {
  superAdmins.push({
    username: process.env[`SUPER_ADMIN_${i}_USERNAME`],
    email: process.env[`SUPER_ADMIN_${i}_EMAIL`],
    name: process.env[`SUPER_ADMIN_${i}_NAME`],
    password: process.env[`SUPER_ADMIN_${i}_PASSWORD`],
  });
  i++;
}

const admin = superAdmins.find(a => a.username === username);

      if (admin) {
        const match = await bcrypt.compare(password, admin.password);
        if (!match) {
          return res.status(401).json({ msg: "Invalid credentials" });
        }

        const token = jwt.sign(
          {
            id: 1,
            username: admin.username,
            role: "super_admin",
            type: 'admin'
          },
          JWT_SECRET,
          { expiresIn: '7d' }
        );

        return res.json({
          token,
          user: {
            id: 1,
            name: admin.name || "Super Admin",
            username: admin.username,
            role: "super_admin",
            type: 'admin'
          }
        });
      }

      // THEN check admins.json
      const data = readJson('admins.json');
      const account = data.admins.find(u => u.username === username || u.email === username);

      if (!account) {
        return res.status(401).json({ msg: "Invalid credentials" });
      }

      const match = await bcrypt.compare(password, account.password);
      if (!match) {
        return res.status(401).json({ msg: "Invalid credentials" });
      }

      const token = jwt.sign(
        {
          id: account.id,
          username: account.username,
          role: account.role,
          type: 'admin'
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
          type: 'admin'
        }
      });

    } else {
      // Student or Staff login from users.db
      const account = usersDb.prepare(`
        SELECT * FROM users WHERE (username =? OR email =?) AND role IN ('student', 'staff_pending', 'staff')
      `).get(username, username);

      if (!account) {
        return res.status(401).json({ msg: "Invalid credentials" });
      }

      const match = await bcrypt.compare(password, account.password);
      if (!match) {
        return res.status(401).json({ msg: "Invalid credentials" });
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
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
});

// ===================== GET ALL ADMINS =====================
app.get('/api/admins', (req, res) => {
  try {
    // Super Admin from.env
    const superAdmin = process.env.SUPER_ADMIN_USERNAME? {
      id: 1,
      name: process.env.SUPER_ADMIN_NAME || "Super Admin",
      email: process.env.SUPER_ADMIN_EMAIL || "",
      username: process.env.SUPER_ADMIN_USERNAME,
      role: "super_admin",
      diamond: true,
      img: process.env.SUPER_ADMIN_IMG || null
    } : null;

    // Load other admins from admins.json
    let otherAdmins = [];
    try {
      const data = readJson('admins.json');
      otherAdmins = data.admins || [];
    } catch (e) {
      console.log("admins.json not found or empty");
    }

    res.json({
      superAdmin: superAdmin,
      admins: otherAdmins
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Failed to load admin list" });
  }
});

// ===================== CREATE ADMIN =====================
app.post('/api/admins', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: "No token provided" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type!== 'admin') return res.status(403).json({ msg: "Only admins can create admins" });

    const { username, email, password, name, role = 'admin' } = req.body;

    if (!username ||!email ||!password ||!name) {
      return res.status(400).json({ msg: "Username, email, password and name are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ msg: "Password must be at least 6 characters" });
    }

    let data = readJson('admins.json');

    const exists = data.admins.find(a => a.username === username || a.email === email);
    if (exists) {
      return res.status(409).json({ msg: "Username or email already exists" });
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

    data.admins.push(newAdmin);
    writeJson('admins.json', data);

    res.status(201).json({
      msg: "Admin created successfully",
      admin: { id: newAdmin.id, username, email, name, role }
    });

  } catch (err) {
    console.error('Create admin error:', err);
    res.status(401).json({ msg: "Invalid or expired token" });
  }
});

// ===================== POSTS =====================
app.get('/api/posts', (req, res) => {
  const data = readJson('posts.json');
  res.json(data.posts.reverse());
});

app.post('/api/posts', upload.single('image'), async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: "No token provided" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type!== 'admin') return res.status(403).json({ msg: "Only admins can create posts" });

    const { title, excerpt, content } = req.body;
    const image = req.file? `/uploads/${req.file.filename}` : null;

    let postsData = readJson('posts.json');

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

    res.json({ msg: "Post published successfully", post: newPost });
  } catch (err) {
    res.status(401).json({ msg: "Invalid or expired token" });
  }
});

app.put('/api/posts/:id', upload.single('image'), (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')? authHeader.slice(7) : authHeader;

  if (!token) return res.status(401).json({ msg: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type!== 'admin') {
      return res.status(403).json({ msg: 'Only admins can edit posts' });
    }

    const { title, excerpt, content } = req.body;
    if (!title ||!excerpt ||!content) {
      return res.status(400).json({ msg: 'Title, excerpt and content are required' });
    }

    const data = readJson('posts.json');
    const index = data.posts.findIndex(p => String(p.id) === String(req.params.id));

    if (index === -1) return res.status(404).json({ msg: 'Post not found' });

    data.posts[index] = {
     ...data.posts[index],
      title,
      excerpt,
      content,
      image: req.file? `/uploads/${req.file.filename}` : data.posts[index].image,
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
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type!== 'admin') return res.status(403).json({ msg: "Admins only" });

    let data = readJson('posts.json');
    data.posts = data.posts.filter(p => String(p.id)!== String(req.params.id));
    writeJson('posts.json', data);

    res.json({ msg: "Post deleted successfully" });
  } catch (err) {
    res.status(401).json({ msg: "Invalid token" });
  }
});

// ===================== USERS =====================
app.get('/api/users', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: "No token provided" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type!== 'admin') return res.status(403).json({ msg: "Only admins can view users" });

    const users = usersDb.prepare(`
      SELECT id, username, email, name, school, role, bio, image as avatar, joined FROM users
    `).all();

    res.json(users);
  } catch (err) {
    console.error('Get users error:', err);
    res.status(401).json({ msg: "Invalid or expired token" });
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

    res.json({ staff, students });
  } catch (err) {
    console.error('Public directory error:', err);
    res.status(500).json({ msg: 'Failed to load directory' });
  }
});

app.delete('/api/users/:id', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: "No token provided" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type!== 'admin') return res.status(403).json({ msg: "Only admins can delete users" });

    const deleteuser = usersDb.prepare(`DELETE FROM users WHERE id =?`);
    const info = deleteuser.run(req.params.id);

    if (info.changes === 0) {
      return res.status(404).json({ msg: "User not found" });
    }

    res.json({ msg: "User deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(401).json({ msg: "Invalid or expired token" });
  }
});

// ===================== DASHBOARD STATS =====================
app.get('/api/dashboard-stats', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: "No token" });

  try {
    jwt.verify(token, JWT_SECRET); // Just verify admin access

    const totalUsers = usersDb.prepare("SELECT COUNT(*) as count FROM users").get().count;
    const pendingStaff = usersDb.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'staff_pending'").get().count;
    const totalPosts = readJson('posts.json').posts.length || 0;
    const totalTickets = tickets.length || 0; // from global tickets array or DB

    res.json({
      tickets: totalTickets,
      pendingUsers: pendingStaff,
      admins: 3, // adjust as needed
      posts: totalPosts
    });
  } catch (err) {
    res.status(401).json({ msg: "Invalid token" });
  }
});

// ===================== TICKETS (Simple in-memory for now) =====================
let tickets = [];

app.get('/api/tickets', (req, res) => {
  res.json(tickets);
});

app.post('/api/tickets', (req, res) => {
  const newTicket = {
    id: Date.now(),
    ...req.body,
    status: 'pending',
    time: new Date().toLocaleString()
  };
  tickets.push(newTicket);
  res.status(201).json(newTicket);
});

// When a staff registers, you can auto-create a ticket:
app.post('/api/register-staff', upload.single('image'), async (req, res) => {
  // ... existing code ...

  // Add ticket automatically
  tickets.push({
    id: Date.now(),
    type: "staff_application",
    title: "New Staff Application",
    message: `${name} has submitted a staff application.`,
    name: name,
    email: email,
    phone: phone,
    bio: bio,
    staffId: info.lastInsertRowid,
    status: "pending",
    time: new Date().toLocaleString()
  });

  res.status(201).json({ msg: "Application submitted..." });
});


// ===================== APPROVE STAFF TICKET =====================
app.post('/api/tickets/:id/approve', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: "No token" });

  try {
    jwt.verify(token, JWT_SECRET);

    const ticketId = parseInt(req.params.id);
    const ticket = tickets.find(t => t.id === ticketId);

    if (!ticket || ticket.type !== "staff_application") {
      return res.status(404).json({ msg: "Ticket not found" });
    }

    // Update user role in database
    const result = usersDb.prepare(`
      UPDATE users 
      SET role = 'staff' 
      WHERE id = ? AND role = 'staff_pending'
    `).run(ticket.staffId);

    if (result.changes === 0) {
      return res.status(400).json({ msg: "User already approved or not found" });
    }

    // Update ticket status
    ticket.status = "approved";
    ticket.approvedAt = new Date().toLocaleString();

    res.json({ msg: "Staff application approved successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
});

// ===================== DELETE ADMIN / STAFF =====================
app.delete('/api/admins/:id', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ msg: "No token provided" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'super_admin') {
      return res.status(403).json({ msg: "Only super admin can delete other admins" });
    }

    const id = parseInt(req.params.id);

    // First try to delete from admins.json (for regular admins)
    let data = readJson('admins.json');
    const initialLength = data.admins.length;
    data.admins = data.admins.filter(a => a.id !== id);

    if (data.admins.length < initialLength) {
      writeJson('admins.json', data);
      return res.json({ msg: "Admin deleted successfully" });
    }

    // If not found in admins.json, try deleting from users table (staff)
    const deleteResult = usersDb.prepare("DELETE FROM users WHERE id = ? AND role IN ('staff', 'staff_pending')").run(id);

    if (deleteResult.changes > 0) {
      return res.json({ msg: "Staff member deleted successfully" });
    }

    res.status(404).json({ msg: "Admin/Staff not found" });
  } catch (err) {
    console.error(err);
    res.status(401).json({ msg: "Invalid or expired token" });
  }
});

// ===================== START SERVER =====================
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`Frontend: http://localhost:${PORT}/index.html`);
  console.log(`Register: POST /api/register`);
  console.log(`Staff Register: POST /api/register-staff`);
  console.log(`Login: POST /api/login`);
  console.log(`Admins: GET/POST /api/admins (Admin only)`);
  console.log(`Users: GET /api/users (Admin only)`);
  console.log(`Posts: GET/POST/PUT/DELETE /api/posts`);
});