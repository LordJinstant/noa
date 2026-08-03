// ===================== ADMIN DASHBOARD JS =====================

let tickets = [];
let currentUserRole = "super_admin";
let charts = {};
let usersCache = [];
let editingPostId = null;

// ===================== UTILITY FUNCTIONS =====================
function escapeHtml(str = '') {
  return String(str)
   .replaceAll('&', '&amp;')
   .replaceAll('<', '&lt;')
   .replaceAll('>', '&gt;')
   .replaceAll('"', '&quot;')
   .replaceAll("'", '&#39;');
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
      data: [safeValue, Math.max(safeValue - 1, 0)],
      backgroundColor: [color, '#e5e7eb'],
      borderWidth: 0
    }]
  };

  if (charts[id]) {
    charts[id].data = data;
    charts[id].update();
  } else {
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
}

function updateMiniCharts(stats = {}) {
  createOrUpdateDoughnut('ticketsChart', stats.tickets || 0, '#19A975');
  createOrUpdateDoughnut('pendingUsersChart', stats.pendingUsers || 0, '#f59e0b');
  createOrUpdateDoughnut('adminsChart', stats.admins || 0, '#a855f7');
  createOrUpdateDoughnut('postsChart', stats.posts || 0, '#3b82f6');
}

// ===================== DASHBOARD STATS =====================
async function loadDashboard() {
  try {
    const token = localStorage.getItem('token');
    const headers = token? { 'Authorization': `Bearer ${token}` } : {};

    const res = await fetch('/api/dashboard-stats', { headers });
    if (!res.ok) return;

    const stats = await res.json();

    const ticketsCount = document.getElementById('ticketsCount');
    const pendingUsersCount = document.getElementById('pendingUsersCount');
    const adminsCount = document.getElementById('adminsCount');
    const postsCount = document.getElementById('postsCount');
    const postsCount2 = document.getElementById('postsCount2');

    if (ticketsCount) ticketsCount.textContent = stats.tickets || 0;
    if (pendingUsersCount) pendingUsersCount.textContent = stats.pendingUsers || 0;
    if (adminsCount) adminsCount.textContent = stats.admins || 0;
    if (postsCount) postsCount.textContent = stats.posts || 0;
    if (postsCount2) postsCount2.textContent = `${stats.posts || 0} posts`;

    updateMiniCharts(stats);
  } catch (err) {
    console.error('Error loading dashboard stats', err);
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
    if (staffCount) staffCount.textContent = `${data.admins?.length || 0} active members`;

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
      if (statusEl) statusEl.innerHTML = `<span class="text-green-600">✅ Admin created successfully!</span>`;
      document.getElementById('createAdminForm').reset();
      renderAdmins();
      loadDashboard();
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
  if (!confirm('Delete this admin? This cannot be undone.')) return;

  const token = localStorage.getItem('token');
  try {
    const res = await fetch(`/api/admins/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
      renderAdmins();
      loadDashboard();
    } else {
      const data = await res.json();
      alert(data.msg || 'Failed to delete admin');
    }
  } catch (err) {
    alert('Connection error');
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
      await loadDashboard();
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

  container.innerHTML = tickets.map((ticket, index) => `
    <div class="ticket-card ${ticket.status === 'resolved'? 'opacity-75' : ''} p-4 border rounded-2xl mb-3">
      <div class="flex justify-between items-start">
        <div class="flex-1">
          <h4 class="font-semibold text-lg">${escapeHtml(ticket.title || 'Untitled Ticket')}</h4>
          <p class="text-gray-600 mt-1">${escapeHtml(ticket.message || '')}</p>
          ${ticket.name? `<p class="text-sm text-gray-500 mt-2">Name: <strong>${escapeHtml(ticket.name)}</strong></p>` : ''}
          ${ticket.email? `<p class="text-sm text-gray-500">Email: <strong>${escapeHtml(ticket.email)}</strong></p>` : ''}
          <p class="text-xs text-gray-400 mt-3">${escapeHtml(ticket.time || '')}</p>
        </div>
        <span class="px-4 py-1.5 text-xs font-medium rounded-2xl ${ticket.status === 'resolved'? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}">
          ${ticket.status === 'resolved'? '✓ Resolved' : 'Pending'}
        </span>
      </div>
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
      await loadDashboard();
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
    const latest = Array.isArray(posts)? posts.slice(0, 3) : [];

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
      await loadDashboard();
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
      await loadDashboard();
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
  loadDashboard();
  loadPostsPreview();
});