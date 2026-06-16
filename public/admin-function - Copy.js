// =============== ADMIN DASHBOARD - MERGED CLEAN VERSION ===============

let tickets = [];
let currentUserRole = "super_admin";
let charts = {};
let usersCache = [];

// ----------------- Utilities -----------------
function scrollToPostForm() {
  const el = document.getElementById('createPostSection');
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function createOrUpdateDoughnut(id, value, color) {
  const ctx = document.getElementById(id);
  if (!ctx || typeof Chart === 'undefined') return;

  const data = {
    labels: ['Primary', 'Other'],
    datasets: [{
      data: [value, Math.max(value - 1, 0)],
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

function showUserModal(user) {
  const modal = document.getElementById('userDetailModal');
  const content = document.getElementById('userDetailContent');
  if (!modal || !content) return;

  const avatar = user.avatar
    ? `<img src="${user.avatar}" class="w-24 h-24 rounded-full object-cover border-4 border-white shadow">`
    : `<div class="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-5xl relative border-4 border-white shadow">
         <i class="fas fa-user"></i>
         <div class="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-white border flex items-center justify-center text-green-600 text-xs">
           <i class="fas fa-plus"></i>
         </div>
       </div>`;

  content.innerHTML = `
    <div class="flex flex-col items-center text-center">
      ${avatar}
      <h4 class="text-2xl font-bold mt-4">${user.name || user.username || 'Unnamed User'}</h4>
      <p class="text-gray-500">${user.role || 'user'}</p>
    </div>

    <div class="mt-6 space-y-3">
      <div class="flex justify-between py-2 border-b"><span class="text-gray-600">Username</span><span class="font-semibold">${user.username || 'N/A'}</span></div>
      <div class="flex justify-between py-2 border-b"><span class="text-gray-600">Name</span><span class="font-semibold">${user.name || 'N/A'}</span></div>
      <div class="flex justify-between py-2 border-b"><span class="text-gray-600">Email</span><span class="font-semibold">${user.email || 'N/A'}</span></div>
      <div class="flex justify-between py-2 border-b"><span class="text-gray-600">Role</span><span class="font-semibold">${user.role || 'N/A'}</span></div>
      <div class="flex justify-between py-2 border-b"><span class="text-gray-600">Joined</span><span class="font-semibold">${user.joined || 'N/A'}</span></div>
      <div class="flex justify-between py-2 border-b"><span class="text-gray-600">School</span><span class="font-semibold">${user.school || 'N/A'}</span></div>
    </div>

    <button onclick="openAddPhotoModal(${user.id})" class="mt-6 w-full bg-[#19A975] text-white py-3 rounded-2xl font-semibold hover:bg-[#158a5f]">
      <i class="fas fa-image mr-2"></i>Add / Change Photo
    </button>
  `;

  modal.classList.remove('hidden');
}

function closeUserModal() {
  const modal = document.getElementById('userDetailModal');
  if (modal) modal.classList.add('hidden');
}

function showUserModalById(id) {
  const user = usersCache.find(u => String(u.id) === String(id));
  if (user) showUserModal(user);
}

function prefillUserTooltip(id) {
  // intentionally minimal
}

function openAddPhotoModal(userId) {
  alert(`Add photo for user ID: ${userId}`);
}

// ----------------- Tickets -----------------
function renderTickets() {
  const container = document.getElementById('ticketsContainer');
  if (!container) return;

  if (tickets.length === 0) {
    container.innerHTML = `<p class="text-gray-500 text-center py-12">No tickets yet.</p>`;
    return;
  }

  container.innerHTML = tickets.map((ticket, index) => `
    <div class="ticket-card ${ticket.status === 'resolved' ? 'opacity-75' : ''}">
      <div class="flex justify-between items-start">
        <div class="flex-1">
          <h4 class="font-semibold text-lg">${ticket.title || 'Untitled Ticket'}</h4>
          <p class="text-gray-600 mt-1">${ticket.message || ''}</p>
          ${ticket.name ? `<p class="text-sm text-gray-500 mt-2">Name: <strong>${ticket.name}</strong></p>` : ''}
          ${ticket.email ? `<p class="text-sm text-gray-500">Email: <strong>${ticket.email}</strong></p>` : ''}
          ${ticket.phone ? `<p class="text-sm text-gray-500">Phone: <strong>${ticket.phone}</strong></p>` : ''}
          ${ticket.grade ? `<p class="text-sm text-gray-500">Grade: <strong>${ticket.grade}</strong></p>` : ''}
          ${ticket.bio ? `<p class="text-sm text-gray-500 mt-2">Bio: ${ticket.bio}</p>` : ''}
          <p class="text-xs text-gray-400 mt-3">${ticket.time || ''}</p>
        </div>
        <span class="px-4 py-1.5 text-xs font-medium rounded-2xl ${ticket.status === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}">
          ${ticket.status === 'resolved' ? '✓ Resolved' : 'Pending'}
        </span>
      </div>

      ${ticket.status !== 'resolved' ? `
        <div class="mt-5 flex gap-3">
          <button onclick="markAsResolved(${index})" class="flex-1 py-3 bg-[#19A975] text-white rounded-2xl font-medium hover:bg-[#158a5f]">
            Mark as Resolved
          </button>
          <button onclick="deleteTicket(${index})" class="px-6 py-3 border border-red-200 text-red-600 rounded-2xl hover:bg-red-50">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      ` : ''}
    </div>
  `).join('');
}

function markAsResolved(index) {
  if (confirm("Mark this ticket as resolved?")) {
    tickets[index].status = "resolved";
    localStorage.setItem('adminNotifications', JSON.stringify(tickets));
    renderTickets();
    updateTicketBadge();
  }
}

function deleteTicket(index) {
  if (confirm("Delete this ticket?")) {
    tickets.splice(index, 1);
    localStorage.setItem('adminNotifications', JSON.stringify(tickets));
    renderTickets();
    updateTicketBadge();
  }
}

function updateTicketBadge() {
  const pending = tickets.filter(t => t.status !== 'resolved').length;
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
      tickets = Array.isArray(data) ? data : [];
      localStorage.setItem('adminNotifications', JSON.stringify(tickets));
      renderTickets();
      updateTicketBadge();
    })
    .catch(err => {
      console.error('Error loading tickets:', err);
      tickets = JSON.parse(localStorage.getItem('adminNotifications') || '[]');
      renderTickets();
      updateTicketBadge();
    });
}

// ----------------- Admins -----------------
async function renderAdmins() {
  try {
    const res = await fetch('/api/admins');
    const data = await res.json();

    const container = document.getElementById('adminsList');
    if (!container) return;

    let html = '';

    if (data.superAdmin) {
      html += `
        <div class="admin-card text-center p-6 border-2 border-yellow-400 rounded-3xl bg-white shadow-sm">
          <img src="${data.superAdmin.img}" class="w-20 h-20 rounded-2xl mx-auto object-cover border-4 border-white shadow">
          <h4 class="font-semibold mt-4">${data.superAdmin.name}</h4>
          <p class="text-sm text-yellow-600">Super Admin <span class="text-2xl">💎</span></p>
        </div>`;
    }

    if (data.admins && data.admins.length > 0) {
      data.admins.forEach(admin => {
        html += `
          <div class="admin-card text-center p-6 rounded-3xl bg-white shadow-sm">
            <img src="${admin.img}" class="w-20 h-20 rounded-2xl mx-auto object-cover border-4 border-white shadow">
            <h4 class="font-semibold mt-4">${admin.name}</h4>
            <p class="text-sm text-gray-500 capitalize">${admin.role}</p>
            ${currentUserRole === 'super_admin' && admin.role !== 'super_admin' ? `
              <button onclick="promoteUser(${admin.id})" class="mt-4 text-xs bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-xl">
                Promote to Moderator
              </button>` : ''}
          </div>`;
      });
    }

    container.innerHTML = html;
  } catch (e) {
    console.error(e);
    const container = document.getElementById('adminsList');
    if (container) container.innerHTML = `<p class="text-red-500">Could not load admin list.</p>`;
  }
}

function promoteUser(id) {
  if (currentUserRole !== 'super_admin') {
    alert("Only Super Admin can promote users.");
    return;
  }
  alert(`User ${id} promoted to Moderator.`);
  renderAdmins();
}

document.getElementById('createAdminForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = localStorage.getItem('token');

  const payload = {
    username: document.getElementById('admin_username').value,
    email: document.getElementById('admin_email').value,
    name: document.getElementById('admin_name').value,
    password: document.getElementById('admin_password').value,
    role: document.getElementById('admin_role').value
  };

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
      alert(`✅ Admin created successfully!
Name: ${data.admin.name}
Username: ${data.admin.username}`);
      document.getElementById('createAdminForm').reset();
      renderAdmins();
    } else {
      alert(data.msg || 'Failed to create admin');
    }
  } catch (error) {
    console.error(error);
    alert('Connection error');
  }
});

// ----------------- Users -----------------
async function loadUsersStrict() {
  try {
    const res = await fetch('/api/users');
    if (!res.ok) throw new Error('Failed to load users');
    const users = await res.json();
    usersCache = Array.isArray(users) ? users : [];
    renderManageUsers(usersCache);
    const pending = usersCache.filter(u => String(u.role).includes('pending')).length;
    const pendingCountEl = document.getElementById('pendingUsersCount');
    if (pendingCountEl) pendingCountEl.textContent = pending;
  } catch (err) {
    console.error(err);
    const container = document.getElementById('adminsList');
    if (container) container.innerHTML = '<p class="text-red-500">Could not load users.</p>';
  }
}

function renderManageUsers(users) {
  const container = document.getElementById('adminsList');
  if (!container) return;

  if (!users.length) {
    container.innerHTML = `<p class="text-gray-500">No users found.</p>`;
    return;
  }

  container.innerHTML = users.map(user => {
    const avatar = user.avatar
      ? `<img src="${user.avatar}" class="w-20 h-20 rounded-full object-cover border-4 border-white shadow">`
      : `<div class="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-2xl relative border-4 border-white shadow">
           <i class="fas fa-user"></i>
           <div class="absolute -bottom-1 -right-1 w-7 h-7 bg-white rounded-full flex items-center justify-center border text-xs text-green-600 cursor-pointer">
             <i class="fas fa-plus"></i>
           </div>
         </div>`;

    return `
      <div class="user-card text-center p-6 cursor-pointer rounded-3xl bg-white shadow-sm hover:shadow-md transition" onmouseenter="prefillUserTooltip(${user.id})" onclick="showUserModalById(${user.id})">
        <div class="mx-auto">${avatar}</div>
        <h4 class="font-semibold mt-4">${user.name || user.username || 'Unnamed User'}</h4>
        <p class="text-sm text-gray-500">${user.role || 'user'}</p>
      </div>
    `;
  }).join('');
}

function openAddPhotoModal(userId) {
  alert(`Open add-photo dialog for user ${userId}`);
}

// ----------------- Dashboard / Posts -----------------
async function loadDashboard() {
  try {
    const res = await fetch('/api/dashboard-stats');
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

// ================== POSTS MANAGEMENT ==================

async function loadPostsPreview() {
  const container = document.getElementById('recentPostsList');
  if (!container) return;

  try {
    const res = await fetch('/api/posts');
    const posts = await res.json();
    const latest = Array.isArray(posts) ? posts.slice(0, 6) : []; // increased to 6 for better view

    if (!latest.length) {
      container.innerHTML = `<p class="text-gray-500 col-span-full text-center py-12">No posts yet.</p>`;
      return;
    }

    container.innerHTML = latest.map(post => {
      const img = post.image
        ? `<img src="${post.image}" class="w-full h-48 object-cover rounded-t-3xl">`
        : `<div class="w-full h-48 bg-gradient-to-br from-[#19A975] to-emerald-500 rounded-t-3xl flex items-center justify-center">
             <i class="fas fa-newspaper text-white text-5xl"></i>
           </div>`;

      return `
        <article class="bg-white rounded-3xl shadow-sm border overflow-hidden hover:shadow-md transition group">
          ${img}
          <div class="p-5">
            <div class="text-xs text-gray-500 mb-2">${post.date || ''}</div>
            <h4 class="font-bold text-lg mb-2 line-clamp-2">${post.title || 'Untitled Post'}</h4>
            <p class="text-sm text-gray-600 leading-relaxed mb-4 line-clamp-3">
              ${post.excerpt || ''}
            </p>

            <!-- Admin Only Controls -->
            <div class="flex gap-2 opacity-0 group-hover:opacity-100 transition">
              <button onclick="editPost(${post.id})" 
                      class="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm py-2.5 rounded-2xl flex items-center justify-center gap-2">
                <i class="fas fa-edit"></i> Edit
              </button>
              <button onclick="deletePost(${post.id})" 
                      class="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm py-2.5 rounded-2xl flex items-center justify-center gap-2">
                <i class="fas fa-trash"></i> Delete
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

// ================== EDIT POST ==================

let currentEditingPost = null;

async function editPost(id) {
  try {
    const res = await fetch(`/api/posts/${id}`);
    const post = await res.json();

    if (!res.ok) throw new Error('Failed to fetch post');

    currentEditingPost = post;

    document.getElementById('edit_post_id').value = post.id;
    document.getElementById('edit_title').value = post.title || '';
    document.getElementById('edit_excerpt').value = post.excerpt || '';
    document.getElementById('edit_content').value = post.content || '';

    document.getElementById('editPostModal').classList.remove('hidden');
  } catch (err) {
    alert('Failed to load post for editing');
    console.error(err);
  }
}

function closeEditModal() {
  document.getElementById('editPostModal').classList.add('hidden');
  document.getElementById('editPostForm').reset();
}

// Handle Edit Form Submit
document.getElementById('editPostForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const id = document.getElementById('edit_post_id').value;
  const token = localStorage.getItem('token');
  const imageFile = document.getElementById('edit_image').files[0];

  const formData = new FormData();
  formData.append('title', document.getElementById('edit_title').value);
  formData.append('excerpt', document.getElementById('edit_excerpt').value);
  formData.append('content', document.getElementById('edit_content').value);
  if (imageFile) formData.append('image', imageFile);

  try {
    const res = await fetch(`/api/posts/${id}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    if (res.ok) {
      alert('✅ Post updated successfully!');
      closeEditModal();
      loadPostsPreview();
      loadDashboard();
    } else {
      const data = await res.json();
      alert(data.msg || 'Failed to update post');
    }
  } catch (err) {
    console.error(err);
    alert('Connection error');
  }
});

// ================== DELETE POST ==================

async function deletePost(id) {
  if (!confirm('Are you sure you want to delete this post? This action cannot be undone.')) {
    return;
  }

  const token = localStorage.getItem('token');

  try {
    const res = await fetch(`/api/posts/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
      alert('🗑️ Post deleted successfully');
      loadPostsPreview();
      loadDashboard();
    } else {
      alert('Failed to delete post');
    }
  } catch (err) {
    console.error(err);
    alert('Connection error');
  }
}

function renderReadMore(text, id, limit = 180) {
  const full = (text || '').trim();
  if (full.length <= limit) return `<span>${full}</span>`;

  const short = full.slice(0, limit).trim();

  return `
    <span id="short-${id}">${short}<span class="text-gray-400">...</span></span>
    <span id="full-${id}" class="hidden">${full}</span>
    <button type="button" onclick="toggleReadMore('${id}', this)" class="ml-2 text-[#19A975] font-semibold hover:underline">
      Read more
    </button>
  `;
}

function toggleReadMore(id, btn) {
  const shortEl = document.getElementById(`short-${id}`);
  const fullEl = document.getElementById(`full-${id}`);
  if (!shortEl || !fullEl || !btn) return;

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

<p class="text-sm text-gray-600 leading-relaxed">
  ${renderReadMore(post.content || post.excerpt, post.id)}
</p>

// ----------------- Init -----------------
document.addEventListener('DOMContentLoaded', () => {
  renderAdmins();
  loadTickets();
  loadUsersStrict();
  loadDashboard();
  loadPostsPreview();
});