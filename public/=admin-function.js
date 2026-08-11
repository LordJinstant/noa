// ===================== ADMIN DASHBOARD JS =====================

let tickets = [];
let currentUserRole = "super_admin";
let charts = {};
let usersCache = [];
let editingPostId = null;

// ===================== UTILITY FUNCTIONS =====================
// function escapeHtml(str = '') {
//   return String(str)
//    .replaceAll('&', '&amp;')
//    .replaceAll('<', '&lt;')
//    .replaceAll('>', '&gt;')
//    .replaceAll('"', '&quot;')
//    .replaceAll("'", '&#39;');
// }


// ===================== ADMIN DASHBOARD JS =====================

// Utility
function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, match => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[match]));
}

function scrollToPostForm() {
  const el = document.getElementById('createPostSection');
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ===================== CHARTS =====================
function createOrUpdateDoughnut(id, value, color) {
  const ctx = document.getElementById(id);
  if (!ctx || typeof Chart === 'undefined') return;

  const safeValue = Math.max(Number(value) || 0, 0);
  const data = {
    labels: ['Primary', 'Other'],
    datasets: [{
      data: [safeValue, Math.max(0, safeValue ? 100 - safeValue : 0)], 
      backgroundColor: [color, '#e5e7eb'],
      borderWidth: 0
    }]
  };

  // If chart already exists, destroy it before recreating
  if (charts[id]) {
    charts[id].destroy();
  }

  charts[id] = new Chart(ctx, {
    type: 'doughnut',
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      cutout: '70%'
    }
  });
}

function updateRing(id, percent) {
  const ring = document.getElementById(id);
  if (!ring) return;

  // Clamp percent between 0–100
  const safePercent = Math.max(0, Math.min(100, percent));
  ring.setAttribute('stroke-dasharray', `${safePercent},100`);
}


function updateMiniCharts(stats = {}) {
  createOrUpdateDoughnut('ticketsChart', stats.tickets || 0, '#19A975');
  createOrUpdateDoughnut('pendingUsersChart', stats.pendingUsers || 0, '#f59e0b');
  createOrUpdateDoughnut('adminsChart', stats.admins || 0, '#a855f7');
  createOrUpdateDoughnut('postsChart', stats.posts || 0, '#3b82f6');
}


// ===================== DASHBOARD STATS =====================
let dashboardLoaded = false;

function updateMiniChart(values = []) {
  const line = document.getElementById('chartLine');
  const fill = document.getElementById('chartFill');
  if (!line || !fill) return;
  const vals = values.length ? values : [0];
  const maxVal = Math.max(...vals, 1);
  const points = vals.map((v, i) => {
    const x = vals.length === 1 ? 50 : (i / (vals.length - 1)) * 100;
    const y = 40 - (v / maxVal) * 30;
    return `${x},${y}`;
  }).join(' L');
  line.setAttribute('d', `M${points}`);
  fill.setAttribute('d', `M${points} L100,40 L0,40 Z`);
}

function animateMiniChart(values = []) {
  updateMiniChart(values);
}

async function loadDashboard(force) {
  const token = localStorage.getItem('token');
  if (!token) return;

  try {
    const res = await fetch('/api/dashboard-stats', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) {
      console.log('Stats fetch failed', res.status);
      return;
    }
    const stats = await res.json();
    dashboardLoaded = true;

    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setText('ticketsCount', stats.tickets || 0);
    setText('pendingUsersCount', stats.pendingUsers || 0);
    setText('adminsCount', stats.admins || 0);
    setText('postsCount', stats.posts || 0);
    if (document.getElementById('postsCount2')) {
      document.getElementById('postsCount2').textContent = (stats.posts || 0) + ' posts';
    }

    if (typeof updateRing === 'function') {
      updateRing('ticketsRing', stats.tickets || 0);
      updateRing('pendingUsersRing', stats.pendingUsers || 0);
      updateRing('adminsRing', stats.admins || 0);
      updateRing('postsRing', stats.posts || 0);
    }

    animateMiniChart([stats.tickets || 0, stats.pendingUsers || 0, stats.admins || 0, stats.posts || 0]);
    if (typeof updateMiniCharts === 'function') updateMiniCharts(stats);
  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

// ===================== ADMINS =====================
async function renderAdmins() {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/admins', {
      headers: token? { 'Authorization': `Bearer ${token}` } : {}
    });
    const data = await res.json();

    const container = document.getElementById('adminsList');
    const superAdminInfo = document.getElementById('superAdminInfo');
    if (!container) return;

    let html = '';

    if (data.superAdmin) {
      if (superAdminInfo) {
        superAdminInfo.innerHTML = `
          <h3 class="font-bold text-2xl">Super Admin <span class="text-yellow-200">(Diamond Flag)</span></h3>
          <p class="text-white/90">${escapeHtml(data.superAdmin.name)} • ${escapeHtml(data.superAdmin.email)} • Full access</p>
        `;
      }
    }

    if (data.admins && data.admins.length > 0) {
      data.admins.forEach(admin => {
        html += `
          <div class="admin-card text-center p-6 rounded-3xl bg-white shadow-sm">
            <img src="${admin.img || 'https://i.pravatar.cc/150'}" class="w-20 h-20 rounded-2xl mx-auto object-cover border-4 border-white shadow">
            <h4 class="font-semibold mt-4">${escapeHtml(admin.name)}</h4>
            <p class="text-sm text-gray-500 capitalize">${escapeHtml(admin.role)}</p>
            ${currentUserRole === 'super_admin' && admin.role!== 'super_admin'? `
              <button onclick="deleteAdmin(${admin.id})" class="mt-4 text-xs bg-red-100 text-red-600 hover:bg-red-200 px-5 py-2 rounded-xl">
                Delete
              </button>` : ''}
          </div>`;
      });
    }

    container.innerHTML = html || '<p class="text-gray-500 col-span-full text-center">No other admins yet</p>';

    // Update counts
    const totalAdmins = (data.superAdmin? 1 : 0) + (data.admins?.length || 0);
    const staffCount = document.getElementById('staffCount');
    const adminsCountEl = document.getElementById('adminsCount');
    if (adminsCountEl) {
      const fromJson = (data.admins || []).filter(a => a.role !== 'staff').length;
      const superN = data.superAdmin ? 1 : 0;
      adminsCountEl.textContent = fromJson + superN;
    }
    if (staffCount) {
      const n = (data.admins || []).length;
      const adminsOnly = (data.admins || []).filter(a => a.role === 'admin' || a.role === 'moderator').length;
      const staffOnly = (data.admins || []).filter(a => a.role === 'staff').length;
      staffCount.textContent = `${n} members (${adminsOnly} admin/mod · ${staffOnly} staff)`;
    }
    // Keep dashboard admin card in sync when list loads
    const adminsCountEl = document.getElementById('adminsCount');
    if (adminsCountEl && data.admins) {
      const created = (data.admins || []).filter(a => a.role === 'admin' || a.role === 'moderator' || a.source === 'admins.json').length;
      // Prefer server stats; fallback to list
    }

  } catch (e) {
    console.error(e);
    const container = document.getElementById('adminsList');
    if (container) container.innerHTML = `<p class="text-red-500">Could not load admin list.</p>`;
  }
}

document.getElementById('createAdminForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = localStorage.getItem('token');
  if (!token) {
    alert('Please login as admin first');
    return;
  }

  const statusEl = document.getElementById('createAdminStatus');
  const payload = {
    username: document.getElementById('admin_username').value,
    email: document.getElementById('admin_email').value,
    name: document.getElementById('admin_name').value,
    password: document.getElementById('admin_password').value,
    role: document.getElementById('admin_role').value
  };

  if (statusEl) statusEl.innerHTML = `<span class="text-blue-600">Creating...</span>`;

  try {
    const res = await fetch('/api/admins', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (res.ok) {
      const roleLabel = (payload.role === 'staff') ? 'Staff' : (payload.role === 'moderator') ? 'Moderator' : 'Admin';
      if (statusEl) statusEl.innerHTML = `<span class="text-green-600">✅ ${roleLabel} created successfully!</span>`;
      document.getElementById('createAdminForm').reset();
      renderAdmins();
      loadDashboard(true);
      setTimeout(() => { if (statusEl) statusEl.innerHTML = ''; }, 3000);
    } else {
      if (statusEl) statusEl.innerHTML = `<span class="text-red-600">❌ ${data.msg || 'Failed to create admin'}</span>`;
    }
  } catch (error) {
    console.error(error);
    if (statusEl) statusEl.innerHTML = `<span class="text-red-600">❌ Connection error</span>`;
  }
});

async function deleteAdmin(id) {
  if (!confirm('Delete this admin/staff? This cannot be undone.')) return;

  const token = localStorage.getItem('token');
  if (!token) {
    alert("Please login as super admin");
    return;
  }

  try {
    const res = await fetch(`/api/admins/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await res.json();

    if (res.ok) {
      alert("✅ Deleted successfully!");
      renderAdmins();      // Refresh list
      loadDashboard(true);     // Refresh stats
      loadUsersTable();    // If users modal is open
    } else {
      alert(data.msg || "Failed to delete");
    }
  } catch (err) {
    console.error(err);
    alert("Connection error. Make sure you are logged in as super admin.");
  }
}

// ===================== MANAGE USERS POPUP - FIXED =====================
async function toggleManageUsers() {
  const modal = document.getElementById('manageUsersModal');
  if (!modal) return;
  modal.classList.toggle('hidden');
  if (!modal.classList.contains('hidden')) {
    await loadUsersTable();
  }
}

async function loadUsersTable() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  const token = localStorage.getItem('token');
  if (!token) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-red-500">Please login as admin first</td></tr>`;
    return;
  }

  tbody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-gray-500">Loading users...</td></tr>`;

  try {
    const res = await fetch('/api/users', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.msg || 'Failed to load users');
    }

    const users = await res.json();
    usersCache = users;

    if (!users.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-gray-500">No users found.</td></tr>`;
      return;
    }

    tbody.innerHTML = users.map(user => `
      <tr class="border-b hover:bg-gray-50">
        <td class="p-4">
          <div class="flex items-center gap-3">
            ${user.avatar
             ? `<img src="${user.avatar}" class="w-10 h-10 rounded-full object-cover">`
              : `<div class="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center"><i class="fas fa-user text-gray-500"></i></div>`
            }
            <span class="font-medium">${escapeHtml(user.name || user.username)}</span>
          </div>
        </td>
        <td class="p-4 text-sm text-gray-600">${escapeHtml(user.email || 'N/A')}</td>
        <td class="p-4">
          <span class="px-3 py-1 rounded-full text-xs font-medium ${
            user.role === 'staff'? 'bg-blue-100 text-blue-700' :
            user.role === 'staff_pending'? 'bg-yellow-100 text-yellow-700' :
            'bg-gray-100 text-gray-700'
          }">${escapeHtml(user.role)}</span>
        </td>
        <td class="p-4 text-sm">${escapeHtml(user.school || 'N/A')}</td>
        <td class="p-4">
          <span class="px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>
        </td>
        <td class="p-4">
          <div class="flex gap-2">
            <button onclick="showUserModalById(${user.id})" class="px-3 py-1 text-xs bg-[#19A975] text-white rounded-lg hover:bg-[#158a5f]">
              View
            </button>
            <button onclick="deleteUserFromTable(${user.id})" class="px-3 py-1 text-xs bg-red-100 text-red-600 rounded-lg hover:bg-red-200">
              Delete
            </button>
          </div>
        </td>
      </tr>
    `).join('');

    // Attach search filter
    const searchInput = document.getElementById('userSearchInput');
    if (searchInput &&!searchInput.dataset.bound) {
      searchInput.dataset.bound = 'true';
      searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const rows = tbody.querySelectorAll('tr');
        rows.forEach(row => {
          const text = row.textContent.toLowerCase();
          row.style.display = text.includes(term)? '' : 'none';
        });
      });
    }

    // Attach role filter
    const roleFilter = document.getElementById('userRoleFilter');
    if (roleFilter &&!roleFilter.dataset.bound) {
      roleFilter.dataset.bound = 'true';
      roleFilter.addEventListener('change', (e) => {
        const role = e.target.value;
        const rows = tbody.querySelectorAll('tr');
        rows.forEach(row => {
          if (!role) {
            row.style.display = '';
          } else {
            const roleCell = row.querySelector('td:nth-child(3)');
            row.style.display = roleCell && roleCell.textContent.includes(role)? '' : 'none';
          }
        });
      });
    }

  } catch (err) {
    console.error('Load users error:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-red-500">Failed to load users: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function deleteUserFromTable(id) {
  if (!confirm('Delete this user? This cannot be undone.')) return;

  const token = localStorage.getItem('token');
  if (!token) {
    alert('Please login as admin first');
    return;
  }

  try {
    const res = await fetch(`/api/users/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
      await loadUsersTable();
      await loadDashboard(true);
    } else {
      const data = await res.json();
      alert(data.msg || 'Failed to delete user');
    }
  } catch (err) {
    alert('Connection error: ' + err.message);
  }
}

// ===================== USER DETAILS MODAL =====================
function showUserModalById(id) {
  const user = usersCache.find(u => String(u.id) === String(id));
  if (!user) return;

  const modal = document.getElementById('userDetailModal');
  const content = document.getElementById('userDetailContent');
  if (!modal ||!content) return;

  const avatar = user.avatar
   ? `<img src="${user.avatar}" class="w-24 h-24 rounded-full object-cover border-4 border-white shadow">`
    : `<div class="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-5xl relative border-4 border-white shadow">
         <i class="fas fa-user"></i>
       </div>`;

  content.innerHTML = `
    <div class="flex flex-col items-center text-center">
      ${avatar}
      <h4 class="text-2xl font-bold mt-4">${escapeHtml(user.name || user.username || 'Unnamed User')}</h4>
      <p class="text-gray-500">${escapeHtml(user.role || 'user')}</p>
    </div>

    <div class="mt-6 space-y-3">
      <div class="flex justify-between py-2 border-b"><span class="text-gray-600">Username</span><span class="font-semibold">${escapeHtml(user.username || 'N/A')}</span></div>
      <div class="flex justify-between py-2 border-b"><span class="text-gray-600">Name</span><span class="font-semibold">${escapeHtml(user.name || 'N/A')}</span></div>
      <div class="flex justify-between py-2 border-b"><span class="text-gray-600">Email</span><span class="font-semibold">${escapeHtml(user.email || 'N/A')}</span></div>
      <div class="flex justify-between py-2 border-b"><span class="text-gray-600">Role</span><span class="font-semibold">${escapeHtml(user.role || 'N/A')}</span></div>
      <div class="flex justify-between py-2 border-b"><span class="text-gray-600">Joined</span><span class="font-semibold">${escapeHtml(user.joined || 'N/A')}</span></div>
      <div class="flex justify-between py-2 border-b"><span class="text-gray-600">School</span><span class="font-semibold">${escapeHtml(user.school || 'N/A')}</span></div>
    </div>
  `;

  modal.classList.remove('hidden');
}

function closeUserModal() {
  document.getElementById('userDetailModal')?.classList.add('hidden');
}

// ===================== TICKETS =====================
function renderTickets() {
  const container = document.getElementById('ticketsContainer');
  if (!container) return;

  if (tickets.length === 0) {
    container.innerHTML = `<p class="text-gray-500 text-center py-12">No tickets yet.</p>`;
    return;
  }

  container.innerHTML = tickets.map(ticket => `
    <div class="p-5 border rounded-2xl mb-4 bg-white shadow-sm">
      <div class="flex justify-between items-start mb-3">
        <div class="flex-1">
          <h4 class="font-semibold text-lg">${escapeHtml(ticket.title)}</h4>
          <p class="text-sm text-gray-600 mt-1">${escapeHtml(ticket.message)}</p>
          ${ticket.name ? `<p class="text-xs text-gray-500 mt-2"><strong>Applicant:</strong> ${escapeHtml(ticket.name)}</p>` : ''}
          ${ticket.email ? `<p class="text-xs text-gray-500">Email: ${escapeHtml(ticket.email)}</p>` : ''}
        </div>
        <span class="px-4 py-1 text-xs font-medium rounded-2xl whitespace-nowrap ${
          ticket.status === 'approved' ? 'bg-green-100 text-green-700' : 
          ticket.status === 'rejected' ? 'bg-red-100 text-red-700' : 
          'bg-yellow-100 text-yellow-700'
        }">
          ${ticket.status || 'pending'}
        </span>
      </div>

      <!-- Approve Button - Only show for pending staff applications -->
      ${ticket.status === 'pending' && ticket.type === 'staff_application' ? `
        <button onclick="approveTicket(${ticket.id})" 
                class="w-full mt-4 bg-[#19A975] hover:bg-[#158a5f] text-white py-3 rounded-2xl font-semibold transition flex items-center justify-center gap-2">
          <i class="fas fa-check"></i>
          Approve Staff Application
        </button>
      ` : ''}

      <p class="text-xs text-gray-400 mt-4">${escapeHtml(ticket.time || '')}</p>
    </div>
  `).join('');
}

function updateTicketBadge() {
  const pending = tickets.filter(t => t.status!== 'resolved').length;
  const badge = document.getElementById('ticketBadge');
  if (!badge) return;

  if (pending > 0) {
    badge.textContent = `+${pending}`;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function toggleTickets() {
  const modal = document.getElementById('ticketsModal');
  if (!modal) return;
  modal.classList.toggle('hidden');
  if (!modal.classList.contains('hidden')) loadTickets();
}

function loadTickets() {
  fetch('/api/tickets')
   .then(res => res.json())
   .then(data => {
      tickets = Array.isArray(data)? data : [];
      renderTickets();
      updateTicketBadge();
    })
   .catch(err => {
      console.error('Error loading tickets:', err);
    });
}

// ===================== APPROVE TICKET =====================
async function approveTicket(ticketId) {
  if (!confirm("Approve this staff application?")) return;

  const token = localStorage.getItem('token');
  if (!token) {
    alert("Please login as admin");
    return;
  }

  try {
    const res = await fetch(`/api/tickets/${ticketId}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await res.json();

    if (res.ok) {
      alert("✅ Staff approved successfully!");
      loadTickets();        // Refresh tickets
      loadUsersTable();     // Refresh users list
      loadDashboard(true);      // Refresh stats
    } else {
      alert(data.msg || "Failed to approve");
    }
  } catch (err) {
    console.error(err);
    alert("Connection error");
  }
}

// ===================== POSTS =====================
function toggleReadMore(id, btn) {
  const shortEl = document.getElementById(`short-${id}`);
  const fullEl = document.getElementById(`full-${id}`);
  if (!shortEl ||!fullEl ||!btn) return;

  const isHidden = fullEl.classList.contains('hidden');
  if (isHidden) {
    shortEl.classList.add('hidden');
    fullEl.classList.remove('hidden');
    btn.textContent = 'Read less';
  } else {
    shortEl.classList.remove('hidden');
    fullEl.classList.add('hidden');
    btn.textContent = 'Read more';
  }
}

function renderReadMore(text, id, limit = 180) {
  const full = (text || '').trim();
  if (full.length <= limit) return `<span>${escapeHtml(full)}</span>`;

  const short = escapeHtml(full.slice(0, limit).trim());
  const fullSafe = escapeHtml(full);

  return `
    <span id="short-${id}">${short}<span class="text-gray-400">...</span></span>
    <span id="full-${id}" class="hidden">${fullSafe}</span>
    <button type="button" onclick="toggleReadMore('${id}', this)" class="ml-2 text-[#19A975] font-semibold hover:underline">
      Read more
    </button>
  `;
}

function openEditPostModal(post) {
  editingPostId = post.id;
  document.getElementById('edit_post_id').value = post.id;
  document.getElementById('edit_title').value = post.title || '';
  document.getElementById('edit_excerpt').value = post.excerpt || '';
  document.getElementById('edit_content').value = post.content || '';
  document.getElementById('editPostModal').classList.remove('hidden');
}

function closeEditModal() {
  document.getElementById('editPostModal')?.classList.add('hidden');
  editingPostId = null;
}

async function submitPostForm(e) {
  e.preventDefault();

  const token = localStorage.getItem('token');
  if (!token) {
    alert('Please login as admin first');
    return;
  }

  const title = document.getElementById('title')?.value.trim();
  const excerpt = document.getElementById('excerpt')?.value.trim();
  const content = document.getElementById('content')?.value.trim();
  const imageFile = document.getElementById('image')?.files?.[0];
  if (!title ||!excerpt ||!content) return;

  const formData = new FormData();
  formData.append('title', title);
  formData.append('excerpt', excerpt);
  formData.append('content', content);
  if (imageFile) formData.append('image', imageFile);

  const status = document.getElementById('postStatus');
  if (status) status.innerHTML = `<span class="text-gray-500">${editingPostId? 'Updating...' : 'Publishing...'}</span>`;

  try {
    const url = editingPostId? `/api/posts/${editingPostId}` : '/api/posts';
    const method = editingPostId? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    const data = await res.json();

    if (res.ok) {
      if (status) status.innerHTML = `<span class="text-green-600">✅ ${editingPostId? 'Post updated successfully!' : 'Post published successfully!'}</span>`;
      document.getElementById('postForm')?.reset();
      editingPostId = null;
      await loadDashboard(true);
      await loadPostsPreview();
      setTimeout(() => { if (status) status.innerHTML = ''; }, 3000);
    } else {
      if (status) status.innerHTML = `<span class="text-red-600">❌ ${data.msg || 'Failed to save post'}</span>`;
    }
  } catch (err) {
    console.error(err);
    if (status) status.innerHTML = `<span class="text-red-600">❌ Connection error</span>`;
  }
}

async function loadPostsPreview() {
  const container = document.getElementById('recentPostsList');
  if (!container) return;

  try {
    const res = await fetch('/api/posts');
    const posts = await res.json();
    const latest = Array.isArray(posts)? posts.slice(0, 7) : [];

    if (!latest.length) {
      container.innerHTML = `<p class="text-gray-500 col-span-full">No posts yet.</p>`;
      return;
    }

    container.innerHTML = latest.map(post => {
      const img = post.image
       ? `<img src="${post.image}" class="w-full h-48 object-cover rounded-t-3xl">`
        : `<div class="w-full h-48 bg-gradient-to-br from-[#19A975] to-emerald-500 rounded-t-3xl flex items-center justify-center"><i class="fas fa-newspaper text-white text-5xl"></i></div>`;

      return `
        <article class="bg-white rounded-3xl shadow-sm border overflow-hidden hover:shadow-md transition">
          ${img}
          <div class="p-5">
            <div class="text-xs text-gray-500 mb-2">${escapeHtml(post.date || '')}</div>
            <h4 class="font-bold text-lg mb-2">${escapeHtml(post.title || 'Untitled Post')}</h4>
            <p class="text-sm text-gray-600 leading-relaxed">
              ${renderReadMore(post.excerpt || post.content || '', post.id)}
            </p>
            <div class="mt-4 flex gap-2">
              <button type="button" onclick='openEditPostModal(${JSON.stringify(post).replaceAll("'", "&#39;")})' class="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm hover:bg-blue-700">
                Edit
              </button>
              <button type="button" onclick="deletePost(${post.id})" class="px-4 py-2 rounded-xl bg-red-600 text-white text-sm hover:bg-red-700">
                Delete
              </button>
            </div>
          </div>
        </article>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading posts preview:', err);
    container.innerHTML = `<p class="text-red-500 col-span-full">Failed to load posts.</p>`;
  }
}

async function deletePost(id) {
  if (!confirm('Delete this post?')) return;

  const token = localStorage.getItem('token');
  try {
    const res = await fetch(`/api/posts/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await res.json();
    if (res.ok) {
      await loadDashboard(true);
      await loadPostsPreview();
    } else {
      alert(data.msg || 'Failed to delete post');
    }
  } catch (err) {
    console.error(err);
    alert('Connection error');
  }
}

// ===================== EDIT POST FORM =====================
document.getElementById('editPostForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const token = localStorage.getItem('token');
  const postId = document.getElementById('edit_post_id').value;
  const title = document.getElementById('edit_title').value.trim();
  const excerpt = document.getElementById('edit_excerpt').value.trim();
  const content = document.getElementById('edit_content').value.trim();
  const imageFile = document.getElementById('edit_image').files[0];

  const formData = new FormData();
  formData.append('title', title);
  formData.append('excerpt', excerpt);
  formData.append('content', content);
  if (imageFile) formData.append('image', imageFile);

  try {
    const res = await fetch(`/api/posts/${postId}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    const data = await res.json();
    if (res.ok) {
      closeEditModal();
      await loadDashboard(true);
      await loadPostsPreview();
      alert('Post updated successfully!');
    } else {
      alert(data.msg || 'Failed to update post');
    }
  } catch (err) {
    alert('Connection error');
  }
});

// ===================== INIT =====================
document.getElementById('postForm')?.addEventListener('submit', submitPostForm);

document.addEventListener('DOMContentLoaded', () => {
  renderAdmins();
  loadTickets();
  loadDashboard(true);
  loadPostsPreview();
});

// ===================== AI INBOX + TRAIN =====================
let currentAiConvId = null;

(function initAiAdminUi() {
  const role = window.__adminRole || (JSON.parse(localStorage.getItem('user') || '{}').role || '');
  if (String(role).toLowerCase() === 'super_admin') {
    const nav = document.getElementById('aiTrainNav');
    if (nav) nav.classList.remove('hidden');
  }
  refreshAiBadge();
  setInterval(refreshAiBadge, 20000);
})();

async function refreshAiBadge() {
  const token = localStorage.getItem('token');
  if (!token) return;
  try {
    const res = await fetch('/api/ai/unread-count', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return;
    const data = await res.json();
    const badge = document.getElementById('aiBadge');
    if (!badge) return;
    if (data.count > 0) {
      badge.textContent = data.count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch (e) {}
}

function toggleAiInbox(force) {
  const panel = document.getElementById('aiInboxPanel');
  if (!panel) return;
  const show = force === false ? false : force === true ? true : panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !show);
  if (show) loadAiInbox();
}

function toggleAiTrain(force) {
  const role = window.__adminRole || (JSON.parse(localStorage.getItem('user') || '{}').role || '');
  if (String(role).toLowerCase() !== 'super_admin') {
    alert('Only super administrators can train the AI.');
    return;
  }
  const panel = document.getElementById('aiTrainPanel');
  if (!panel) return;
  const show = force === false ? false : force === true ? true : panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !show);
  if (show) loadAiDatabase();
}

async function loadAiInbox() {
  const token = localStorage.getItem('token');
  const list = document.getElementById('aiInboxList');
  list.innerHTML = '<p class="text-sm text-gray-400 p-4">Loading…</p>';
  try {
    const res = await fetch('/api/ai/inbox', { headers: { Authorization: 'Bearer ' + token } });
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) {
      list.innerHTML = '<p class="text-sm text-gray-400 p-4">No conversations referred yet</p>';
      return;
    }
    list.innerHTML = rows.map(r => `
      <button type="button" onclick="openAiConversation('${r.id}')"
        class="w-full text-left p-3 rounded-2xl border bg-white hover:border-[#19A975] transition ${r.unreadModerator ? 'ring-2 ring-red-200' : ''}">
        <div class="flex justify-between gap-2">
          <span class="font-semibold text-sm truncate">${escapeHtml(r.name || 'Visitor')}</span>
          ${r.unreadModerator ? '<span class="text-[10px] bg-red-500 text-white px-2 py-0.5 rounded-full">NEW</span>' : ''}
        </div>
        <p class="text-xs text-gray-500 truncate">${escapeHtml(r.email || 'No email')} · ${escapeHtml(r.phone || 'No phone')}</p>
        <p class="text-xs text-gray-400 mt-1 line-clamp-2">${escapeHtml((r.summary || '').slice(0, 120))}</p>
      </button>
    `).join('');
  } catch (e) {
    list.innerHTML = '<p class="text-sm text-red-500 p-4">Failed to load inbox</p>';
  }
}

async function openAiConversation(id) {
  currentAiConvId = id;
  const token = localStorage.getItem('token');
  try {
    await fetch('/api/ai/inbox/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ conversationId: id })
    });
    const res = await fetch('/api/ai/conversation/' + id, { headers: { Authorization: 'Bearer ' + token } });
    const conv = await res.json();
    const header = document.getElementById('aiChatHeader');
    header.innerHTML = `<strong>${escapeHtml(conv.name || 'Visitor')}</strong> · ${escapeHtml(conv.email || '—')} · ${escapeHtml(conv.phone || '—')}
      <div class="text-xs text-gray-400 mt-1 whitespace-pre-wrap">${escapeHtml(conv.summary || '')}</div>`;
    const thread = document.getElementById('aiChatThread');
    thread.innerHTML = (conv.messages || []).map(m => {
      const isUser = m.role === 'user';
      const isMod = m.role === 'moderator';
      const bg = isUser ? 'bg-slate-100' : isMod ? 'bg-emerald-50 border border-emerald-100' : 'bg-blue-50';
      const label = isUser ? 'User' : isMod ? ('Moderator' + (m.by ? ' (' + m.by + ')' : '')) : 'AI';
      return `<div class="max-w-[90%] ${isUser ? '' : 'ml-auto'} ${bg} rounded-2xl px-4 py-2 text-sm">
        <p class="text-[10px] font-bold text-gray-400 mb-0.5">${label}</p>
        <p class="whitespace-pre-wrap">${escapeHtml(m.text || '')}</p>
      </div>`;
    }).join('');
    thread.scrollTop = thread.scrollHeight;
    refreshAiBadge();
    loadAiInbox();
  } catch (e) {
    alert('Could not open conversation');
  }
}

async function sendAiModeratorReply() {
  const input = document.getElementById('aiReplyInput');
  const text = (input.value || '').trim();
  if (!text || !currentAiConvId) return;
  const token = localStorage.getItem('token');
  const res = await fetch('/api/ai/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ conversationId: currentAiConvId, message: text })
  });
  const data = await res.json();
  if (!res.ok) { alert(data.msg || 'Failed'); return; }
  input.value = '';
  openAiConversation(currentAiConvId);
}

async function loadAiDatabase() {
  const token = localStorage.getItem('token');
  try {
    const res = await fetch('/api/ai/database', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error('Forbidden');
    const db = await res.json();
    document.getElementById('aiBehavioralsBox').value = db.behaviorals || '';
    const list = document.getElementById('aiKnowledgeList');
    const items = db.knowledge || [];
    if (!items.length) {
      list.innerHTML = '<p class="text-gray-400">No knowledge entries yet</p>';
      return;
    }
    list.innerHTML = items.slice().reverse().map(k => `
      <div class="p-3 rounded-xl border bg-slate-50 flex justify-between gap-2">
        <div class="min-w-0"><p class="text-gray-800">${escapeHtml(k.text)}</p>
        <p class="text-[10px] text-gray-400 mt-1">${escapeHtml((k.keywords || []).join(', '))}</p></div>
        <button onclick="deleteAiKnowledge(${k.id})" class="text-red-500 text-xs shrink-0">Delete</button>
      </div>
    `).join('');
  } catch (e) {
    alert('Could not load AI database (super admin only)');
  }
}

async function saveAiBehaviorals() {
  const token = localStorage.getItem('token');
  const behaviorals = document.getElementById('aiBehavioralsBox').value.trim();
  const st = document.getElementById('aiBehStatus');
  st.textContent = 'Saving…';
  const res = await fetch('/api/ai/behaviorals', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ behaviorals })
  });
  const data = await res.json();
  st.innerHTML = res.ok ? '<span class="text-green-600">Saved</span>' : `<span class="text-red-600">${data.msg || 'Error'}</span>`;
}

async function trainAiKnowledge() {
  const token = localStorage.getItem('token');
  const text = document.getElementById('aiKnowledgeBox').value.trim();
  const keywords = document.getElementById('aiKeywordsBox').value.trim();
  const st = document.getElementById('aiTrainStatus');
  st.textContent = 'Training…';
  const res = await fetch('/api/ai/train', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ text, keywords })
  });
  const data = await res.json();
  if (res.ok) {
    st.innerHTML = `<span class="text-green-600">Trained (${data.count} entries)</span>`;
    document.getElementById('aiKnowledgeBox').value = '';
    document.getElementById('aiKeywordsBox').value = '';
    loadAiDatabase();
  } else {
    st.innerHTML = `<span class="text-red-600">${data.msg || 'Error'}</span>`;
  }
}

async function deleteAiKnowledge(id) {
  if (!confirm('Delete this knowledge entry?')) return;
  const token = localStorage.getItem('token');
  await fetch('/api/ai/knowledge/' + id, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token }
  });
  loadAiDatabase();
}


function applyModeratorView() {
  const label = document.getElementById('adminRoleLabel');
  const roleShow = String(window.__adminRole || (JSON.parse(localStorage.getItem('user') || '{}').role || '')).toLowerCase();
  if (label) label.textContent = roleShow ? ('· Signed in as ' + roleShow.replace('_', ' ')) : '';

  const role = String(window.__adminRole || (JSON.parse(localStorage.getItem('user') || '{}').role || '')).toLowerCase();
  if (role === 'super_admin') return;
  // Moderators (and non-super admins): no Train AI
  const trainNav = document.getElementById('aiTrainNav');
  if (trainNav) trainNav.classList.add('hidden');
  // Moderators: hide create-admin form section if present
  if (role === 'moderator') {
    document.querySelectorAll('#createAdminForm').forEach(f => {
      const section = f.closest('section');
      if (section) section.classList.add('hidden');
    });
    // Soften header subtitle
    const sub = document.querySelector('main h2 + p');
    if (sub) sub.textContent = 'Moderator access — reply to AI handoff messages.';
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyModeratorView);
} else {
  applyModeratorView();
}
