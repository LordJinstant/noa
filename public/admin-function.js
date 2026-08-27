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
  // admin.html rings use stroke-dasharray="100,100" + stroke-dashoffset
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  const offset = 100 - safePercent;
  ring.setAttribute('stroke-dasharray', '100,100');
  ring.style.strokeDashoffset = String(offset);
  // Matching glow path if present (id + "Glow")
  const glow = document.getElementById(id + 'Glow');
  if (glow) {
    glow.setAttribute('stroke-dasharray', '100,100');
    glow.style.strokeDashoffset = String(offset);
  }
}

/** Set a count element to the exact value (for admin.html live observer) */
function setStatCount(elId, value, percentForRing) {
  const el = document.getElementById(elId);
  if (!el) return;
  const n = Math.max(0, Math.floor(Number(value) || 0));
  el.setAttribute('data-count', String(n));
  if (percentForRing != null && !isNaN(percentForRing)) {
    el.setAttribute('data-percent', String(Math.max(0, Math.min(100, Math.round(percentForRing)))));
  }
  el.textContent = String(n);
}

/** Visual ring fill from a raw count (not treated as a percent) */
function countAsRingPercent(count) {
  count = Math.max(0, Number(count) || 0);
  if (count <= 0) return 0;
  if (count <= 10) return Math.min(100, count * 8);
  if (count <= 50) return Math.min(100, 40 + Math.round((count - 10) * 1.2));
  return 100;
}


function updateMiniCharts(stats = {}) {
  createOrUpdateDoughnut('ticketsChart', stats.tickets || 0, '#19A975');
  createOrUpdateDoughnut('pendingUsersChart', stats.pendingUsers || 0, '#f59e0b');
  createOrUpdateDoughnut('adminsChart', stats.admins || 0, '#a855f7');
  createOrUpdateDoughnut('postsChart', stats.posts || 0, '#3b82f6');
}


// ===================== DASHBOARD STATS =====================
// ===================== DASHBOARD STATS (Fixed) =====================
async function loadDashboard() {
  console.log("loadDashboard called"); // debug

  const token = localStorage.getItem('token');
  if (!token) {
    console.log("No token found");
    return;
  }

  try {
    const res = await fetch('/api/dashboard-stats', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      console.log("Stats fetch failed", res.status);
      return;
    }

    const stats = await res.json();

function updateMiniChart(values = []) {
  const line = document.getElementById('chartLine');
  const fill = document.getElementById('chartFill');
  if (!line || !fill) return; // not present on current admin UI
  const maxVal = Math.max(...values, 1);
  const points = values.map((v, i) => {
    const x = values.length === 1 ? 50 : (i / (values.length - 1)) * 100;
    const y = 40 - (v / maxVal) * 30;
    return `${x},${y}`;
  }).join(' L');
  line.setAttribute('d', `M${points}`);
  fill.setAttribute('d', `M${points} L100,40 L0,40 Z`);
}

function animateMiniChart(values = []) {
  const line = document.getElementById('chartLine');
  const fill = document.getElementById('chartFill');
  if (!line || !fill) return;
  const maxVal = Math.max(...values, 1);
  const targetPoints = values.map((v, i) => {
    const x = values.length === 1 ? 50 : (i / (values.length - 1)) * 100;
    const y = 40 - (v / maxVal) * 30;
    return { x, y };
  });
  const pointsStr = targetPoints.map(p => `${p.x},${p.y}`).join(' L');
  line.setAttribute('d', `M${pointsStr}`);
  fill.setAttribute('d', `M${pointsStr} L100,40 L0,40 Z`);
}

const ticketN = Number(stats.tickets) || 0;
    const pendingN = Number(stats.pendingUsers) || 0;
    const adminN = Number(stats.admins) || 0;
    const postN = Number(stats.posts) || 0;

    // Exact counts — admin.html observer animates from data-count
    setStatCount('ticketsCount', ticketN, countAsRingPercent(ticketN));
    setStatCount('pendingUsersCount', pendingN, countAsRingPercent(pendingN));
    setStatCount('adminsCount', adminN, countAsRingPercent(adminN));
    setStatCount('postsCount', postN, countAsRingPercent(postN));

    // Rings (dashoffset style used by admin.html SVG)
    updateRing('ticketsRing', countAsRingPercent(ticketN));
    updateRing('pendingUsersRing', countAsRingPercent(pendingN));
    updateRing('adminsRing', countAsRingPercent(adminN));
    updateRing('postsRing', countAsRingPercent(postN));

    const postsCount2 = document.getElementById('postsCount2');
    if (postsCount2) postsCount2.textContent = postN + ' posts';

    try {
      if (typeof updateMiniChart === 'function') {
        updateMiniChart([ticketN, pendingN, adminN, postN]);
      }
      if (typeof animateMiniChart === 'function') {
        animateMiniChart([ticketN, pendingN, adminN, postN]);
      }
      if (typeof updateMiniCharts === 'function') {
        updateMiniCharts({ tickets: ticketN, pendingUsers: pendingN, admins: adminN, posts: postN });
      }
    } catch (e) { /* optional chart helpers may be absent in UI */ }
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
      const canPromote = currentUserRole === 'super_admin' || currentUserRole === 'admin';
      data.admins.forEach(admin => {
        const role = String(admin.role || 'staff').toLowerCase();
        const canEdit = canPromote && role !== 'super_admin';
        const safeRole = String(role).replace(/'/g, '');
        html += `
          <div class="admin-card text-center p-6 rounded-3xl bg-white shadow-sm${canEdit ? ' cursor-pointer hover:ring-2 hover:ring-[#19A975]/40 transition' : ''}"
               ${canEdit ? `onclick="changeMemberRole('${admin.id}', '${safeRole}')"` : ''}
               title="${canEdit ? 'Click to promote or demote' : ''}">
            <img src="${admin.img || admin.avatar || 'https://i.pravatar.cc/150'}" class="w-20 h-20 rounded-2xl mx-auto object-cover border-4 border-white shadow" alt="">
            <h4 class="font-semibold mt-4">${escapeHtml(admin.name)}</h4>
            <p class="text-sm text-gray-500 capitalize">${escapeHtml(admin.role)}</p>
            ${canEdit ? `
              <p class="text-[11px] text-[#19A975] font-semibold mt-2"><i class="fas fa-exchange-alt mr-1"></i>Click to change role</p>
              <button type="button" onclick="event.stopPropagation(); changeMemberRole('${admin.id}', '${safeRole}')"
                class="mt-3 text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-100 px-4 py-2 rounded-xl font-semibold">
                Promote / Demote
              </button>` : ''}
            ${currentUserRole === 'super_admin' && role !== 'super_admin' ? `
              <button type="button" onclick="event.stopPropagation(); deleteAdmin(${admin.id})" class="mt-2 text-xs bg-red-100 text-red-600 hover:bg-red-200 px-5 py-2 rounded-xl">
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
  const role = getAdminRole();
  if (role === 'moderator') {
    alert('Only administrators can create admin accounts.');
    return;
  }
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
      loadDashboard();     // Refresh stats
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
  const role = getAdminRole();
  if (role === 'moderator') {
    alert('Manage Users is only available to administrators.');
    return;
  }
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
          <div class="flex flex-wrap gap-2">
            <button onclick="showUserModalById(${user.id})" class="px-3 py-1 text-xs bg-[#19A975] text-white rounded-lg hover:bg-[#158a5f]">
              View
            </button>
            ${(user.role === 'staff' || user.role === 'staff_pending' || user.role === 'student') ? `
            <button onclick="changeMemberRole(${user.id}, '${String(user.role || '').replace(/'/g, '')}')" class="px-3 py-1 text-xs bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200" title="Promote or demote">
              Role
            </button>` : ''}
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
  if (!modal || !content) return;

  window.__viewingUserId = user.id;

  const hasPic = !!(user.avatar && String(user.avatar).trim());
  const avatarInner = hasPic
    ? `<img id="userDetailAvatarImg" src="${escapeHtml(user.avatar)}" alt="Profile" class="w-full h-full object-cover">`
    : `<div id="userDetailAvatarPlaceholder" class="w-full h-full flex items-center justify-center text-gray-400 text-5xl bg-gray-100">
         <i class="fas fa-user"></i>
       </div>`;

  const roleLower = String(user.role || '').toLowerCase();
  const showStudentsBtn = roleLower === 'staff' || roleLower === 'admin' || roleLower === 'moderator' || roleLower === 'super_admin';

  content.innerHTML = `
    <div class="flex flex-col items-center text-center">
      <div class="relative group inline-block">
        <button type="button" id="userAvatarBtn" onclick="toggleAvatarMenu()"
          class="w-24 h-24 rounded-full overflow-hidden border-4 border-white shadow-lg ring-2 ring-emerald-100 hover:ring-[#19A975] transition focus:outline-none"
          title="Profile picture">
          ${avatarInner}
        </button>
        <span class="pointer-events-none absolute bottom-0 right-0 w-8 h-8 rounded-full bg-[#19A975] text-white flex items-center justify-center text-xs shadow-md border-2 border-white group-hover:scale-110 transition">
          <i class="fas fa-camera"></i>
        </span>
        <div id="avatarMenu" class="hidden absolute left-1/2 -translate-x-1/2 top-full mt-2 z-20 w-52 bg-white rounded-2xl shadow-xl border border-gray-100 py-2 text-left">
          <button type="button" onclick="pickUserAvatar()" class="w-full px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-emerald-50 hover:text-[#19A975] flex items-center gap-2">
            <i class="fas fa-image text-emerald-500 w-4 text-center"></i>
            ${hasPic ? 'Change profile picture' : 'Add profile picture'}
          </button>
          ${hasPic ? `<button type="button" onclick="removeUserAvatar()" class="w-full px-4 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 flex items-center gap-2">
            <i class="fas fa-trash w-4 text-center"></i> Remove picture
          </button>` : ''}
        </div>
      </div>
      <input type="file" id="userAvatarFileInput" accept="image/*" class="hidden" onchange="uploadUserAvatar(event)" />
      <p id="avatarUploadStatus" class="text-xs text-gray-400 mt-2 min-h-[1rem]"></p>
      ${showStudentsBtn ? `
      <button type="button" onclick="openStaffStudentsList(${user.id})"
        class="mt-3 px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-50 text-emerald-800 border border-emerald-100 hover:bg-emerald-100 transition">
        <i class="fas fa-user-graduate mr-1.5"></i>List of staff's students
      </button>` : ''}
      <h4 class="text-2xl font-bold mt-2">${escapeHtml(user.name || user.username || 'Unnamed User')}</h4>
      <p class="text-gray-500 capitalize">${escapeHtml(user.role || 'user')}</p>
    </div>

    <div class="mt-6 space-y-3">
      <div class="flex justify-between py-2 border-b"><span class="text-gray-600">Username</span><span class="font-semibold">${escapeHtml(user.username || 'N/A')}</span></div>
      <div class="flex justify-between py-2 border-b"><span class="text-gray-600">Name</span><span class="font-semibold">${escapeHtml(user.name || 'N/A')}</span></div>
      <div class="flex justify-between py-2 border-b"><span class="text-gray-600">Email</span><span class="font-semibold">${escapeHtml(user.email || 'N/A')}</span></div>
      <div class="flex justify-between py-2 border-b"><span class="text-gray-600">Role</span><span class="font-semibold">${escapeHtml(user.role || 'N/A')}</span></div>
      <div class="flex justify-between py-2 border-b"><span class="text-gray-600">Joined</span><span class="font-semibold">${escapeHtml(user.joined || 'N/A')}</span></div>
      <div class="flex justify-between py-2 border-b"><span class="text-gray-600">School</span><span class="font-semibold">${escapeHtml(user.school || 'N/A')}</span></div>
    </div>
    <button type="button" onclick="changeMemberRole(${user.id}, '${String(user.role || 'staff').replace(/'/g, '')}')"
      class="mt-5 w-full py-3 rounded-2xl bg-violet-600 hover:bg-violet-700 text-white font-semibold text-sm flex items-center justify-center gap-2">
      <i class="fas fa-exchange-alt"></i> Promote / Demote role
    </button>
  `;

  modal.classList.remove('hidden');
}

async function openStaffStudentsList(staffId) {
  const token = localStorage.getItem('token');
  if (!token) {
    alert('Please login as admin');
    return;
  }
  staffId = Number(staffId);
  if (!staffId) {
    alert('Invalid member id');
    return;
  }

  let existing = document.getElementById('staffStudentsModal');
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.id = 'staffStudentsModal';
  wrap.className = 'fixed inset-0 z-[820] bg-black/50 flex items-center justify-center p-4';
  wrap.onclick = function (e) { if (e.target === wrap) wrap.remove(); };
  wrap.innerHTML = `
    <div class="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden" onclick="event.stopPropagation()">
      <div class="px-5 py-4 border-b flex items-center justify-between gap-2">
        <div>
          <h3 class="text-lg font-bold text-gray-800">Staff's students</h3>
          <p class="text-xs text-gray-500" id="staffStudentsSub">Loading…</p>
        </div>
        <button type="button" onclick="document.getElementById('staffStudentsModal')?.remove()" class="w-9 h-9 rounded-xl hover:bg-gray-100 text-gray-500"><i class="fas fa-times"></i></button>
      </div>
      <div id="staffStudentsBody" class="px-5 py-4 overflow-y-auto flex-1 text-sm text-gray-500">Loading list…</div>
    </div>`;
  document.body.appendChild(wrap);

  try {
    // Prefer /api/users/:id/students (admin-friendly alias), fall back to /api/staff/:id/students
    let res = await fetch('/api/users/' + staffId + '/students', {
      headers: { Authorization: 'Bearer ' + token }
    });
    let data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      res = await fetch('/api/staff/' + staffId + '/students', {
        headers: { Authorization: 'Bearer ' + token }
      });
      data = await res.json().catch(function () { return {}; });
    }
    if (!res.ok) {
      throw new Error(data.msg || ('Failed to load students (HTTP ' + res.status + ')'));
    }
    const sub = document.getElementById('staffStudentsSub');
    const body = document.getElementById('staffStudentsBody');
    const list = data.students || [];
    if (sub) {
      sub.textContent = (data.staff && data.staff.name ? data.staff.name + ' · ' : '') +
        list.length + ' student' + (list.length === 1 ? '' : 's');
    }
    if (!body) return;
    if (!list.length) {
      body.innerHTML = '<p class="text-center text-gray-400 py-8">No students added or following this member yet.</p>';
      return;
    }
    body.innerHTML = '<ol class="space-y-2 list-none">' + list.map(function (s, i) {
      const n = i + 1;
      const link = s.link === 'follower' ? 'Follower' : 'Added';
      return (
        '<li class="flex items-center gap-3 p-3 rounded-2xl border border-gray-100 bg-gray-50/80">' +
          '<span class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold shrink-0">' + n + '</span>' +
          '<div class="min-w-0 flex-1">' +
            '<p class="font-semibold text-gray-800 truncate">' + escapeHtml(s.name || s.username || 'Student') + '</p>' +
            '<p class="text-xs text-gray-500 truncate">' + escapeHtml(s.username || '') +
              (s.grade ? ' · ' + escapeHtml(s.grade) : '') +
              ' · <span class="text-emerald-700">' + link + '</span></p>' +
          '</div>' +
        '</li>'
      );
    }).join('') + '</ol>';
  } catch (e) {
    const body = document.getElementById('staffStudentsBody');
    if (body) {
      body.innerHTML = '<p class="text-center text-rose-500 py-6">' +
        escapeHtml(e.message || 'Error loading list') +
        '</p><p class="text-center text-xs text-gray-400">Restart the server after updating server.js, then try again.</p>';
    }
  }
}

function toggleAvatarMenu() {
  const menu = document.getElementById('avatarMenu');
  if (!menu) return;
  menu.classList.toggle('hidden');
}

function pickUserAvatar() {
  const menu = document.getElementById('avatarMenu');
  if (menu) menu.classList.add('hidden');
  const input = document.getElementById('userAvatarFileInput');
  if (input) {
    input.value = '';
    input.click();
  }
}

async function uploadUserAvatar(ev) {
  const file = ev.target && ev.target.files && ev.target.files[0];
  if (!file) return;
  const userId = window.__viewingUserId;
  if (!userId) return;

  const token = localStorage.getItem('token');
  if (!token) {
    alert('Please login as admin first');
    return;
  }

  const status = document.getElementById('avatarUploadStatus');
  if (status) status.textContent = 'Uploading…';

  try {
    const fd = new FormData();
    fd.append('image', file);
    const res = await fetch('/api/users/' + userId + '/avatar', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: fd
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.msg || 'Upload failed');

    // Update cache + table row
    const u = usersCache.find(function (x) { return String(x.id) === String(userId); });
    if (u) u.avatar = data.avatar;
    if (status) {
      status.textContent = 'Profile picture saved';
      status.className = 'text-xs text-emerald-600 mt-2 min-h-[1rem] font-medium';
    }
    showUserModalById(userId);
    try { await loadUsersTable(); } catch (e) {}
  } catch (err) {
    if (status) {
      status.textContent = err.message || 'Upload failed';
      status.className = 'text-xs text-rose-600 mt-2 min-h-[1rem] font-medium';
    } else {
      alert(err.message || 'Upload failed');
    }
  }
}

async function removeUserAvatar() {
  const menu = document.getElementById('avatarMenu');
  if (menu) menu.classList.add('hidden');
  // Optional: clear by uploading empty not supported — hide menu only for now
  // Could POST without file; skip unless backend supports clear
  alert('To replace a picture, choose “Change profile picture” and pick a new image.');
}

function closeUserModal() {
  const menu = document.getElementById('avatarMenu');
  if (menu) menu.classList.add('hidden');
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
          Approve as Admin / Moderator / Staff
        </button>
      ` : ticket.status === 'approved' && ticket.approvedRole ? `
        <p class="text-xs text-emerald-600 mt-3 font-medium">Approved as ${escapeHtml(ticket.approvedRole)}</p>
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
/** Ask how to approve: Admin / Moderator / Staff */
function pickApproveRole() {
  return new Promise((resolve) => {
    const existing = document.getElementById('rolePickModal');
    if (existing) existing.remove();

    const wrap = document.createElement('div');
    wrap.id = 'rolePickModal';
    wrap.className = 'fixed inset-0 z-[800] bg-black/50 flex items-center justify-center p-4';
    wrap.innerHTML = `
      <div class="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6" onclick="event.stopPropagation()">
        <h3 class="text-xl font-bold text-gray-800 mb-1">Choose role</h3>
        <p class="text-sm text-gray-500 mb-5">Approve or change this person to one of the following roles.</p>
        <div class="space-y-2">
          <button type="button" data-role="admin" class="role-pick-btn w-full text-left px-4 py-3 rounded-2xl border border-violet-100 hover:bg-violet-50 flex items-center gap-3">
            <span class="w-10 h-10 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center"><i class="fas fa-user-shield"></i></span>
            <span><span class="font-semibold text-gray-800 block">Admin</span><span class="text-xs text-gray-500">Full platform management</span></span>
          </button>
          <button type="button" data-role="moderator" class="role-pick-btn w-full text-left px-4 py-3 rounded-2xl border border-sky-100 hover:bg-sky-50 flex items-center gap-3">
            <span class="w-10 h-10 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center"><i class="fas fa-user-check"></i></span>
            <span><span class="font-semibold text-gray-800 block">Moderator</span><span class="text-xs text-gray-500">Community moderation tools</span></span>
          </button>
          <button type="button" data-role="staff" class="role-pick-btn w-full text-left px-4 py-3 rounded-2xl border border-emerald-100 hover:bg-emerald-50 flex items-center gap-3">
            <span class="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center"><i class="fas fa-chalkboard-teacher"></i></span>
            <span><span class="font-semibold text-gray-800 block">Staff</span><span class="text-xs text-gray-500">Host classes &amp; assessments</span></span>
          </button>
        </div>
        <button type="button" id="rolePickCancel" class="mt-4 w-full py-2.5 text-sm text-gray-500 hover:text-gray-800">Cancel</button>
      </div>`;
    document.body.appendChild(wrap);

    const finish = (role) => {
      wrap.remove();
      resolve(role);
    };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) finish(null);
    });
    wrap.querySelector('#rolePickCancel').onclick = () => finish(null);
    wrap.querySelectorAll('.role-pick-btn').forEach((btn) => {
      btn.onclick = () => finish(btn.getAttribute('data-role'));
    });
  });
}

const STAFF_SUBJECT_OPTIONS = [
  'Mathematics', 'Further Mathematics', 'Physics', 'Chemistry', 'Biology',
  'English Language', 'Literature', 'Civic Education', 'Computer Science',
  'Economics', 'Geography', 'Government', 'Accounting', 'Technical Drawing'
];

/** Multi-select subjects for staff */
function pickStaffSubjects(selected) {
  selected = Array.isArray(selected) ? selected.slice() : [];
  return new Promise((resolve) => {
    const existing = document.getElementById('subjectsPickModal');
    if (existing) existing.remove();

    const wrap = document.createElement('div');
    wrap.id = 'subjectsPickModal';
    wrap.className = 'fixed inset-0 z-[820] bg-black/50 flex items-center justify-center p-4';
    const chips = STAFF_SUBJECT_OPTIONS.map(function (s) {
      const on = selected.indexOf(s) >= 0;
      return '<label class="subject-chip flex items-center gap-2 px-3 py-2 rounded-xl border text-sm cursor-pointer transition ' +
        (on ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-white border-gray-200 text-gray-700 hover:border-emerald-200') +
        '"><input type="checkbox" value="' + s.replace(/"/g, '&quot;') + '" class="subject-cb accent-emerald-600" ' +
        (on ? 'checked' : '') + ' /><span>' + s + '</span></label>';
    }).join('');

    wrap.innerHTML = `
      <div class="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" onclick="event.stopPropagation()">
        <h3 class="text-xl font-bold text-gray-800 mb-1">Select subjects for staff</h3>
        <p class="text-sm text-gray-500 mb-4">Choose the subjects this staff will teach / be listed under on the platform.</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">${chips}</div>
        <p id="subjectsPickCount" class="text-xs text-gray-400 mb-3">${selected.length} selected</p>
        <div class="flex gap-2">
          <button type="button" id="subjectsCancel" class="flex-1 py-2.5 rounded-2xl border text-gray-600 text-sm font-semibold">Cancel</button>
          <button type="button" id="subjectsDone" class="flex-1 py-2.5 rounded-2xl bg-[#19A975] hover:bg-[#158a5f] text-white text-sm font-semibold">Done</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    function current() {
      return Array.from(wrap.querySelectorAll('.subject-cb:checked')).map(function (el) { return el.value; });
    }
    function refreshChips() {
      wrap.querySelectorAll('.subject-chip').forEach(function (lab) {
        const on = lab.querySelector('.subject-cb').checked;
        lab.className = 'subject-chip flex items-center gap-2 px-3 py-2 rounded-xl border text-sm cursor-pointer transition ' +
          (on ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-white border-gray-200 text-gray-700 hover:border-emerald-200');
      });
      const c = document.getElementById('subjectsPickCount');
      if (c) c.textContent = current().length + ' selected';
    }
    wrap.querySelectorAll('.subject-cb').forEach(function (cb) {
      cb.addEventListener('change', refreshChips);
    });

    const finish = (val) => {
      wrap.remove();
      resolve(val);
    };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) finish(null);
    });
    wrap.querySelector('#subjectsCancel').onclick = () => finish(null);
    wrap.querySelector('#subjectsDone').onclick = () => finish(current());
  });
}

/** Ask admin for login username + password for the new member */
function pickLoginCredentials(defaults) {
  defaults = defaults || {};
  return new Promise((resolve) => {
    const existing = document.getElementById('credsPickModal');
    if (existing) existing.remove();

    const suggestedUser = defaults.username || defaults.email || '';
    let chosenSubjects = Array.isArray(defaults.subjects) ? defaults.subjects.slice() : [];

    const wrap = document.createElement('div');
    wrap.id = 'credsPickModal';
    wrap.className = 'fixed inset-0 z-[810] bg-black/50 flex items-center justify-center p-4';
    wrap.innerHTML = `
      <div class="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6" onclick="event.stopPropagation()">
        <h3 class="text-xl font-bold text-gray-800 mb-1">Set login credentials</h3>
        <p class="text-sm text-gray-500 mb-5">Give this person a username and password. They will use these to sign in after approval.</p>
        <label class="block text-xs font-semibold text-gray-500 mb-1">Username</label>
        <input id="credUsername" type="text" autocomplete="off"
          class="w-full mb-3 px-4 py-2.5 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-emerald-300 outline-none"
          value="${String(suggestedUser).replace(/"/g, '&quot;')}" placeholder="e.g. john.doe" />
        <label class="block text-xs font-semibold text-gray-500 mb-1">Password</label>
        <input id="credPassword" type="text" autocomplete="off"
          class="w-full mb-1 px-4 py-2.5 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-emerald-300 outline-none"
          placeholder="At least 6 characters" />
        <p class="text-[11px] text-gray-400 mb-3">Share these credentials with them securely.</p>
        <button type="button" id="credSubjectsBtn"
          class="w-full mb-2 py-2.5 rounded-2xl border-2 border-dashed border-emerald-300 text-emerald-800 text-sm font-semibold hover:bg-emerald-50 flex items-center justify-center gap-2">
          <i class="fas fa-book-open"></i> Subjects
          <span id="credSubjectsBadge" class="text-[11px] font-bold text-emerald-600"></span>
        </button>
        <p id="credSubjectsPreview" class="text-[11px] text-gray-500 mb-4 min-h-[1rem]"></p>
        <div class="flex gap-2">
          <button type="button" id="credCancel" class="flex-1 py-2.5 rounded-2xl border text-gray-600 text-sm font-semibold">Cancel</button>
          <button type="button" id="credSave" class="flex-1 py-2.5 rounded-2xl bg-[#19A975] hover:bg-[#158a5f] text-white text-sm font-semibold">Save &amp; Approve</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    function updateSubjectsUi() {
      const badge = wrap.querySelector('#credSubjectsBadge');
      const prev = wrap.querySelector('#credSubjectsPreview');
      if (badge) badge.textContent = chosenSubjects.length ? '(' + chosenSubjects.length + ')' : '';
      if (prev) prev.textContent = chosenSubjects.length ? chosenSubjects.join(' · ') : 'No subjects selected yet';
    }
    updateSubjectsUi();

    wrap.querySelector('#credSubjectsBtn').onclick = async () => {
      const picked = await pickStaffSubjects(chosenSubjects);
      if (picked) {
        chosenSubjects = picked;
        updateSubjectsUi();
      }
    };

    const finish = (val) => {
      wrap.remove();
      resolve(val);
    };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) finish(null);
    });
    wrap.querySelector('#credCancel').onclick = () => finish(null);
    wrap.querySelector('#credSave').onclick = () => {
      const username = (wrap.querySelector('#credUsername').value || '').trim();
      const password = (wrap.querySelector('#credPassword').value || '').trim();
      if (!username) {
        alert('Username is required');
        return;
      }
      if (password.length < 6) {
        alert('Password must be at least 6 characters');
        return;
      }
      finish({ username: username, password: password, subjects: chosenSubjects.slice() });
    };
    setTimeout(() => {
      const pw = wrap.querySelector('#credPassword');
      if (pw) pw.focus();
    }, 50);
  });
}

async function approveTicket(ticketId) {
  const role = await pickApproveRole();
  if (!role) return;

  // Prefill username from the ticket if available
  const ticket = (typeof tickets !== 'undefined' && Array.isArray(tickets))
    ? tickets.find(function (t) { return String(t.id) === String(ticketId); })
    : null;
  const suggested = {
    username: (ticket && (ticket.email || ticket.name)) ? String(ticket.email || ticket.name).split('@')[0].replace(/\s+/g, '.').toLowerCase() : '',
    email: ticket && ticket.email ? ticket.email : ''
  };

  const creds = await pickLoginCredentials(suggested);
  if (!creds) return;

  const token = localStorage.getItem('token');
  if (!token) {
    alert('Please login as admin');
    return;
  }

  try {
    const res = await fetch('/api/tickets/' + ticketId + '/approve', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        role: role,
        username: creds.username,
        password: creds.password,
        subjects: Array.isArray(creds.subjects) ? creds.subjects : []
      })
    });

    const data = await res.json().catch(function () { return {}; });

    if (res.ok) {
      const u = data.username || creds.username;
      alert(
        'Approved as ' + (data.role || role) + '\n\n' +
        'Login credentials:\n' +
        'Username: ' + u + '\n' +
        'Password: ' + creds.password + '\n\n' +
        'Share these with the new member securely.'
      );
      loadTickets();
      try { await loadUsersTable(); } catch (e) {}
      try { await renderAdmins(); } catch (e) {}
      try { await loadDashboard(); } catch (e) {}
    } else {
      alert(data.msg || 'Failed to approve');
    }
  } catch (err) {
    console.error(err);
    alert('Connection error');
  }
}

/** Promote / demote any team member (staff list card or users table) */
async function changeMemberRole(memberId, currentRole) {
  const actor = String(getAdminRole() || currentUserRole || '').toLowerCase();
  if (!(actor === 'super_admin' || actor === 'admin')) {
    alert('Only admins can promote or demote team members.');
    return;
  }

  const cur = String(currentRole || 'staff').toLowerCase();
  const role = await pickApproveRole();
  if (!role) return;
  if (role === cur) {
    alert('Already has this role.');
    return;
  }

  const labels = { admin: 'Admin', moderator: 'Moderator', staff: 'Staff' };
  const label = labels[role] || role;
  if (!confirm('Change this person to ' + label + '?')) return;

  const token = localStorage.getItem('token');
  if (!token) {
    alert('Please login as admin');
    return;
  }

  try {
    const res = await fetch('/api/users/' + memberId + '/role', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ role: role })
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      alert(data.msg || 'Could not change role');
      return;
    }
    alert(data.msg || ('Now ' + label));
    try { await renderAdmins(); } catch (e) {}
    try { await loadUsersTable(); } catch (e) {}
    try { await loadDashboard(); } catch (e) {}
  } catch (err) {
    console.error(err);
    alert('Connection error');
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



// ===================== ROLE UI (moderator vs admin) =====================
function getAdminRole() {
  try {
    if (window.__adminRole) return String(window.__adminRole).toLowerCase();
    const u = JSON.parse(localStorage.getItem('user') || '{}');
    return String(u.role || '').toLowerCase();
  } catch (e) {
    return '';
  }
}

function applyAdminRoleUi() {
  const role = getAdminRole();
  currentUserRole = role || currentUserRole;
  window.__adminRole = role;

  // Moderators must NOT see Manage Users or Create New Admin
  // Admins and super_admins can see them (create still API-restricted for super where applicable)
  const isModerator = role === 'moderator';
  const canManageUsers = role === 'super_admin' || role === 'admin';
  const canCreateAdmin = role === 'super_admin' || role === 'admin';

  const navUsers = document.getElementById('navManageUsers');
  if (navUsers) navUsers.classList.toggle('hidden', isModerator || !canManageUsers);

  const createCard = document.getElementById('createAdminCard');
  if (createCard) createCard.classList.toggle('hidden', isModerator || !canCreateAdmin);

  // Also hide by heading text if card id missing
  if (isModerator) {
    document.querySelectorAll('h2, h3').forEach(function (h) {
      const t = (h.textContent || '').toLowerCase();
      if (t.includes('create new admin') || (t.includes('create') && t.includes('admin'))) {
        const wrap = h.closest('.bg-white, section, .rounded-3xl') || h.parentElement;
        if (wrap) wrap.classList.add('hidden');
      }
    });
  }

  const label = document.getElementById('adminRoleLabel');
  if (label && role) {
    label.textContent = 'Role: ' + role.replace(/_/g, ' ');
  }
}

// Guard actions if someone calls them anyway
const _toggleManageUsers = typeof toggleManageUsers === 'function' ? toggleManageUsers : null;

// ===================== LIVE PLATFORM ACTIVITY CHART =====================
let activityPeriod = 'week';
let activityChartInstance = null;
let activityPollTimer = null;

function setActivityPeriod(period) {
  activityPeriod = String(period || 'week');
  document.querySelectorAll('.activity-period-btn').forEach(function (btn) {
    const on = btn.getAttribute('data-period') === activityPeriod;
    btn.classList.toggle('border-emerald-500', on);
    btn.classList.toggle('bg-emerald-50', on);
    btn.classList.toggle('text-emerald-700', on);
    btn.classList.toggle('border-gray-200', !on);
    btn.classList.toggle('text-gray-600', !on);
  });
  const customBox = document.getElementById('activityCustomRange');
  if (customBox) {
    if (activityPeriod === 'custom') {
      customBox.classList.remove('hidden');
      customBox.classList.add('flex');
      // default last 14 days if empty
      const from = document.getElementById('activityFrom');
      const to = document.getElementById('activityTo');
      if (from && !from.value) {
        const d = new Date(); d.setDate(d.getDate() - 13);
        from.value = d.toISOString().slice(0, 10);
      }
      if (to && !to.value) {
        to.value = new Date().toISOString().slice(0, 10);
      }
    } else {
      customBox.classList.add('hidden');
      customBox.classList.remove('flex');
      loadActivityChart();
    }
  } else {
    loadActivityChart();
  }
}

async function loadActivityChart() {
  const token = localStorage.getItem('token');
  const canvas = document.getElementById('activityChart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (!token) return;

  let url = '/api/dashboard-activity?period=' + encodeURIComponent(activityPeriod || 'week');
  if (activityPeriod === 'custom') {
    const from = (document.getElementById('activityFrom') || {}).value;
    const to = (document.getElementById('activityTo') || {}).value;
    if (!from || !to) return;
    url += '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
  }

  try {
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return;
    const data = await res.json();
    const labels = data.labels || [];
    const active = data.active || [];
    const signups = data.signups || [];

    const sub = document.getElementById('activityChartSubtitle');
    if (sub) {
      const map = {
        week: 'Last 7 days',
        month: 'Last 30 days',
        '3months': 'Last 3 months',
        '6months': 'Last 6 months',
        year: 'Last 12 months',
        custom: ((data.from || '') + ' → ' + (data.to || ''))
      };
      sub.textContent = (map[activityPeriod] || 'Selected range') + ' · live platform data';
    }
    const totals = document.getElementById('activityTotals');
    if (totals && data.totals) {
      totals.textContent = '· ' + (data.totals.signups || 0) + ' signups · peak active ' + (data.totals.activePeak || 0);
    }

    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 180);
    gradient.addColorStop(0, 'rgba(25, 169, 117, 0.28)');
    gradient.addColorStop(1, 'rgba(25, 169, 117, 0)');

    const config = {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Active Users',
          data: active,
          borderColor: '#19A975',
          backgroundColor: gradient,
          borderWidth: 3,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#19A975',
          pointBorderWidth: 2,
          pointRadius: labels.length > 40 ? 0 : 3,
          pointHoverRadius: 5,
          fill: true,
          tension: 0.35
        }, {
          label: 'New Signups',
          data: signups,
          borderColor: '#8b5cf6',
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [5, 5],
          pointRadius: labels.length > 40 ? 0 : 2,
          pointHoverRadius: 4,
          fill: false,
          tension: 0.35
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(31, 41, 55, 0.92)',
            padding: 12,
            cornerRadius: 12,
            usePointStyle: true
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: '#9ca3af',
              font: { size: 10 },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 12
            }
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: {
              color: '#9ca3af',
              font: { size: 10 },
              precision: 0
            }
          }
        },
        interaction: { intersect: false, mode: 'index' }
      }
    };

    if (activityChartInstance) {
      activityChartInstance.data.labels = labels;
      activityChartInstance.data.datasets[0].data = active;
      activityChartInstance.data.datasets[1].data = signups;
      activityChartInstance.data.datasets[0].pointRadius = labels.length > 40 ? 0 : 3;
      activityChartInstance.data.datasets[1].pointRadius = labels.length > 40 ? 0 : 2;
      activityChartInstance.update('none');
    } else {
      activityChartInstance = new Chart(ctx, config);
    }
  } catch (err) {
    console.error('Activity chart error:', err);
  }
}

// ===================== INIT =====================
document.getElementById('postForm')?.addEventListener('submit', submitPostForm);

document.addEventListener('DOMContentLoaded', () => {
  applyAdminRoleUi();
  renderAdmins();
  loadTickets();
  loadDashboard();
  loadPostsPreview();
  loadActivityChart();
  if (activityPollTimer) clearInterval(activityPollTimer);
  activityPollTimer = setInterval(loadActivityChart, 60000); // refresh live every minute
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
