// =============== MANAGE USERS PAGE ===============

let allUsers = [];

async function loadUsers() {
  try {
    // You can expand this later to fetch from backend
    allUsers = [
      { id: 101, name: "Josiah Adebayo", email: "josiah@example.com", role: "student", grade: "Grade 10 / SSS 1", status: "active" },
      { id: 102, name: "Mr. Chinedu Okoro", email: "chinedu@noa.ng", role: "moderator", grade: "Maths Lead", status: "active" },
      { id: 103, name: "Fatima Yusuf", email: "fatima@noa.ng", role: "staff", grade: "Science", status: "pending" }
    ];
    renderUsers(allUsers);
  } catch (e) {
    console.error(e);
  }
}

function renderUsers(users) {
  const tbody = document.getElementById('usersTableBody');
  tbody.innerHTML = users.map(user => `
    <tr class="hover:bg-gray-50">
      <td class="p-5 font-medium">${user.name}</td>
      <td class="p-5 text-gray-600">${user.email}</td>
      <td class="p-5">
        <span class="capitalize px-3 py-1 rounded-full text-xs font-medium
          ${user.role === 'super_admin' ? 'bg-yellow-100 text-yellow-700' : 
            user.role === 'moderator' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}">
          ${user.role}
        </span>
      </td>
      <td class="p-5">${user.grade}</td>
      <td class="p-5 text-center">
        <span class="px-4 py-1 text-xs rounded-full ${user.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}">
          ${user.status}
        </span>
      </td>
      <td class="p-5 text-center">
        <button onclick="viewUser(${user.id})" class="text-[#19A975] hover:underline mr-3">View</button>
        ${user.role !== 'super_admin' ? `<button onclick="deleteUser(${user.id})" class="text-red-500 hover:underline">Delete</button>` : ''}
      </td>
    </tr>
  `).join('');
}

function viewUser(id) {
  alert(`Viewing details for user ID: ${id}\n(This can be expanded into a modal later)`);
}

function deleteUser(id) {
  if (confirm("Delete this user?")) {
    alert("User deleted.");
    loadUsers(); // Refresh list
  }
}

// Search functionality
document.getElementById('searchInput').addEventListener('input', (e) => {
  const term = e.target.value.toLowerCase();
  const filtered = allUsers.filter(user => 
    user.name.toLowerCase().includes(term) || 
    user.email.toLowerCase().includes(term)
  );
  renderUsers(filtered);
});

// Initialize
document.addEventListener('DOMContentLoaded', loadUsers);