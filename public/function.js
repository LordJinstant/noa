// Initial state
document.getElementById('mainContent').classList.add('lg:ml-72');

let sidebarOpen = true;
let mobileOpen = false;

function toggleSubmenu(btn) {
  const submenu = btn.nextElementSibling;
  const icon = btn.querySelector('i:last-child');
  document.querySelectorAll('.submenu').forEach(s => {
    if (s !== submenu) s.classList.remove('submenu-open');
  });
  submenu.classList.toggle('submenu-open');
  icon.classList.toggle('rotate-180');
}

function toggleDesktopSidebar() {
  const sidebar = document.getElementById('desktopSidebar');
  const mainContent = document.getElementById('mainContent');
  sidebarOpen = !sidebarOpen;

  if (sidebarOpen) {
    sidebar.classList.remove('-translate-x-full');
    sidebar.classList.add('translate-x-0');
    mainContent.classList.add('lg:ml-72');
  } else {
    sidebar.classList.add('-translate-x-full');
    sidebar.classList.remove('translate-x-0');
    mainContent.classList.remove('lg:ml-72');
  }
}

function toggleMobileMenu() {
  mobileOpen = !mobileOpen;
  document.getElementById('mobileOverlay').classList.toggle('hidden', !mobileOpen);
}

function closeMobileMenu(e) {
  if (e.target.id === 'mobileOverlay') toggleMobileMenu();
}

function toggleMobileSubmenu(btn) {
  const submenu = btn.nextElementSibling;
  const icon = btn.querySelector('i:last-child');
  document.querySelectorAll('.mobile-submenu').forEach(s => {
    if (s !== submenu) s.classList.add('hidden');
  });
  submenu.classList.toggle('hidden');
  if (icon) icon.classList.toggle('rotate-180');
}

function showLoginModal() {
  document.getElementById('loginModal').classList.remove('hidden');
}

function hideLoginModal() {
  document.getElementById('loginModal').classList.add('hidden');
}

async function showAboutPopup() {
  const content = document.getElementById('aboutContent');
  try {
    const res = await fetch('about.txt');
    let text = await res.text();
    text = text
      .replace(/^# (.*$)/gm, '<h1 class="text-3xl font-bold mt-8 mb-4">$1</h1>')
      .replace(/^## (.*$)/gm, '<h2 class="text-2xl font-bold mt-7 mb-3">$1</h2>')
      .replace(/^### (.*$)/gm, '<strong class="text-xl block mt-5 mb-2">$1</strong>')
      .replace(/\n\n/g, '<br><br>');
    content.innerHTML = text;
  } catch(e) {
    content.innerHTML = "<p class='text-white'>Could not load content.</p>";
  }
  document.getElementById('aboutPopup').classList.remove('hidden');
}

function hideAboutPopup() {
  document.getElementById('aboutPopup').classList.add('hidden');
}

async function showCompetitionsPopup() {
  const content = document.getElementById('competitionsContent');
  try {
    const res = await fetch('competitions.txt');
    let text = await res.text();
    text = text
      .replace(/^# (.*$)/gm, '<h1 class="text-3xl font-bold mt-8 mb-4">$1</h1>')
      .replace(/^## (.*$)/gm, '<h2 class="text-2xl font-bold mt-7 mb-3">$1</h2>')
      .replace(/^### (.*$)/gm, '<strong class="text-xl block mt-5 mb-2">$1</strong>')
      .replace(/\n\n/g, '<br><br>');
    content.innerHTML = text;
  } catch(e) {
    content.innerHTML = "<p class='text-white'>Could not load content.</p>";
  }
  document.getElementById('competitionsPopup').classList.remove('hidden');
}

function hideCompetitionsPopup() {
  document.getElementById('competitionsPopup').classList.add('hidden');
}

let animationIndex = 0;
const animations = [
  { style: "text-5xl", text: "SIMCC 2026 Mathematics Olympiad" },
  { style: "text-4xl scale-110", text: "Are You Ready to Compete?" },
  { style: "text-5xl", text: "Global Stage Awaits" },
  { style: "text-4xl", text: "Master Mathematics" },
  { style: "text-5xl", text: "Join The Elite" }
];

function cycleAnimation() {
  animationIndex = (animationIndex + 1) % animations.length;
  const textEl = document.getElementById('dynamicText');
  textEl.className = `animated-text ${animations[animationIndex].style}`;
  textEl.textContent = animations[animationIndex].text;
}

async function login(type) {
  const usernameOrEmail = document.getElementById('username')?.value.trim();
  const password = document.getElementById('password')?.value;

  if (!usernameOrEmail || !password) {
    alert("Username/Email and password are required!");
    return;
  }

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        username: usernameOrEmail,
        password, 
        type 
      })
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.msg || 'Login failed');
      return;
    }

    // Save token and user info
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));

    // Redirect based on role
    if (data.user.role === 'super_admin' || data.user.role === 'admin') {
      window.location.href = 'admin.html';
    } else if (data.user.role === 'staff' || data.user.role === 'staff_pending') {
      window.location.href = 'staff.html';
    } else {
      window.location.href = 'dashboard.html';
    }

  } catch (error) {
    console.error('Login error:', error);
    alert("Connection error. Please check your server.");
  }
}

// Earthquake Word Assembly Animation
let currentIndex = 0;
const heroTexts = [
  "SIMCC 2026 Mathematics Olympiad",
  "Are You Ready to Compete?",
  "Global Stage Awaits You",
  "Master Mathematics Today",
  "Join The Elite Mathematicians"
];

const dynamicText = document.getElementById('dynamicText');

function createWordSpans(text) {
  dynamicText.innerHTML = '';
  dynamicText.className = 'animated-text word-assembly';
  const words = text.split(' ');
  words.forEach((word, i) => {
    const span = document.createElement('span');
    span.textContent = word;
    if (i < words.length - 1) span.textContent += ' ';
    dynamicText.appendChild(span);
  });
}

function playAssemblyAnimation() {
  createWordSpans(heroTexts[currentIndex]);
  const spans = dynamicText.querySelectorAll('span');
  spans.forEach((span, i) => {
    setTimeout(() => {
      span.classList.add('visible');
    }, i * 120);
  });

  setTimeout(() => {
    dynamicText.classList.add('shake');
    setTimeout(() => dynamicText.classList.remove('shake'), 900);
  }, spans.length * 120 + 400);
}

function cycleHeroText() {
  currentIndex = (currentIndex + 1) % heroTexts.length;
  playAssemblyAnimation();
}

setInterval(cycleHeroText, 5000);
playAssemblyAnimation();

dynamicText.parentElement.addEventListener('click', cycleHeroText);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideLoginModal();
    hideAboutPopup();
    hideCompetitionsPopup();
    if (!document.getElementById('mobileOverlay').classList.contains('hidden')) toggleMobileMenu();
  }
});




function initLogoStage() {
  const container = document.getElementById('orbitContainer');

  const logos = [
    'brand/NOA.png',
    'brand/simcclogo.png',
    'brand/logo1.png',
    'brand/logo2.png',
    'brand/logo3.png',
    'brand/logo4.png',
    'brand/logo5.png',
    'brand/logo6.png',
    'brand/logo7.png',
    'brand/logo8.png',
    'brand/logo9.png',
    'brand/logo10.png'
  ];

  const positions = [
    { x: -118, y: 14, scale: 0.58, z: 20, cls: 'is-back' },
    { x: -74, y: 4, scale: 0.88, z: 45, cls: 'is-mid' },
    { x: 0, y: 0, scale: 1.35, z: 90, cls: 'is-center' },
    { x: 74, y: 4, scale: 0.88, z: 45, cls: 'is-mid' },
    { x: 118, y: 14, scale: 0.58, z: 20, cls: 'is-back' }
  ];

  const center = document.createElement('div');
  center.className = 'center-logo';
  center.innerHTML = `<img src="${logos[0]}" alt="NOA Logo">`;
  container.appendChild(center);

  const stage = document.createElement('div');
  stage.className = 'orbit-stage';
  container.appendChild(stage);

  let queue = [logos[1], logos[2], logos[3], logos[4], logos[5]];
  let idx = 5;
  let animating = false;

  function render(initial = true) {
    stage.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const src = queue[i];
      const p = positions[i];
      const item = document.createElement('div');
      item.className = `orbit-logo ${p.cls}`;
      item.innerHTML = `<img src="${src}" alt="Logo">`;
      item.style.opacity = i === 2 ? '1' : '0.92';
      item.style.transform = `translate(-50%, -50%) translate3d(${p.x}px, ${p.y}px, ${p.z}px) scale(${p.scale})`;
      item.style.transition = initial ? 'none' : 'transform 0.85s cubic-bezier(.22,1,.36,1), opacity 0.85s ease, filter 0.85s ease';
      stage.appendChild(item);
    }
  }

  function vibrate(el) {
    if (!el) return;
    el.classList.remove('vibrate-hit');
    void el.offsetWidth;
    el.classList.add('vibrate-hit');
    setTimeout(() => el.classList.remove('vibrate-hit'), 260);
  }

  function popFront(el) {
    if (!el) return;
    el.style.zIndex = '999';
    setTimeout(() => {
      el.style.zIndex = '';
    }, 220);
  }

  function shift() {
    if (animating) return;
    animating = true;

    const items = [...stage.querySelectorAll('.orbit-logo')];
    const middle = items[2];
    const leaving = items[0];

    if (leaving) leaving.classList.add('leaving');

    if (middle) {
      vibrate(middle);
      popFront(middle);
    }

    for (let i = 0; i < items.length - 1; i++) {
      const nextPos = positions[i];
      const target = items[i + 1];
      target.style.opacity = i === 1 ? '1' : '0.92';
      target.className = `orbit-logo ${nextPos.cls}`;
      target.style.transform = `translate(-50%, -50%) translate3d(${nextPos.x}px, ${nextPos.y}px, ${nextPos.z}px) scale(${nextPos.scale})`;
    }

    const incomingSrc = logos[idx % logos.length];
    idx++;

    const incoming = document.createElement('div');
    incoming.className = 'orbit-logo entering is-back';
    incoming.innerHTML = `<img src="${incomingSrc}" alt="Logo">`;
    incoming.style.opacity = '0';
    incoming.style.transform = 'translate(-50%, -50%) translate3d(0px, -140px, 0px) scale(0.35)';
    stage.appendChild(incoming);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        incoming.style.transition = 'transform 0.85s cubic-bezier(.22,1,.36,1), opacity 0.85s ease, filter 0.85s ease';
        incoming.style.opacity = '0.92';
        incoming.style.transform = `translate(-50%, -50%) translate3d(${positions[4].x}px, ${positions[4].y}px, ${positions[4].z}px) scale(${positions[4].scale})`;

        setTimeout(() => {
          incoming.style.zIndex = '1000';
          incoming.style.transform = `translate(-50%, -50%) translate3d(${positions[2].x}px, ${positions[2].y}px, ${positions[2].z}px) scale(${positions[2].scale + 0.16})`;
          vibrate(incoming);
          popFront(incoming);
        }, 150);
      });
    });

    setTimeout(() => {
      queue = queue.slice(1);
      queue.push(incomingSrc);
      render(false);
      animating = false;
    }, 900);
  }

  render(true);
  setInterval(shift, 2200);
}

// === FAST INDEPENDENT SUBTEXT ANIMATION ===
const subtext = document.getElementById('dynamicSubtext');
const subTexts = [
  "Are You Ready?",
  "Join The Challenge",
  "Be Part of History",
  "Unlock Your Potential",
  "The Future Awaits"
];

let subIndex = 0;

function animateSubtext() {
  subtext.classList.remove('flip');
  
  // Force reflow
  void subtext.offsetWidth;
  
  subtext.textContent = subTexts[subIndex];
  subtext.classList.add('flip');
  
  subIndex = (subIndex + 1) % subTexts.length;
}

// Run subtext animation faster (every 2.8 seconds)
setInterval(animateSubtext, 2800);

// Initial animation
setTimeout(() => {
  animateSubtext();
}, 800);

document.addEventListener('DOMContentLoaded', initLogoStage);


// Register Flow Functions
function showRegisterModal() {
  document.getElementById('registerModal').classList.remove('hidden');
}

function hideRegisterModal() {
  document.getElementById('registerModal').classList.add('hidden');
}

function showStudentForm() {
  hideRegisterModal();
  document.getElementById('studentFormModal').classList.remove('hidden');
}

function showAdminForm() {
  hideRegisterModal();
  document.getElementById('adminFormModal').classList.remove('hidden');
}

// Student Flow
function showCourseSelection() {
  const courses = ["Mathematics", "English Language", "Basic Science", "Computer", 
                   "Chemistry", "Physics", "Social Studies", "Technology"];
  
  let html = '';
  courses.forEach(course => {
    html += `
      <label class="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" class="course-check w-5 h-5 accent-[#19A975]">
        <span>${course}</span>
      </label>`;
  });
  document.getElementById('courseList').innerHTML = html;
  
  document.getElementById('studentFormModal').classList.add('hidden');
  document.getElementById('courseModal').classList.remove('hidden');
}

// Show Course Selection
function showCourseSelection() {
  const courses = ["Mathematics", "English Language", "Basic Science", "Computer", 
                   "Chemistry", "Physics", "Social Studies", "Technology"];
  
  let html = '';
  courses.forEach(course => {
    html += `
      <label class="flex items-center gap-3 cursor-pointer p-3 hover:bg-gray-50 rounded-2xl">
        <input type="checkbox" class="course-check w-5 h-5 accent-[#19A975]">
        <span class="font-medium">${course}</span>
      </label>`;
  });
  
  document.getElementById('courseList').innerHTML = html;
  
  document.getElementById('studentFormModal').classList.add('hidden');
  document.getElementById('courseModal').classList.remove('hidden');
}

// Final Student Registration
async function completeStudentRegistration() {
  const name = document.getElementById('s_name').value.trim();
  const email = document.getElementById('s_email').value.trim();
  const username = document.getElementById('s_username').value.trim();
  const password = document.getElementById('s_password').value;
  const confirmPassword = document.getElementById('s_confirm_password').value;
  const school = document.getElementById('s_school').value.trim();
  const grade = document.getElementById('s_grade').value;

  // Validation
  if (!username || !password || !email) {
    alert("Username, Password and Email are required!");
    return;
  }
  if (password !== confirmPassword) {
    alert("Passwords do not match!");
    return;
  }
  if (password.length < 6) {
    alert("Password must be at least 6 characters long!");
    return;
  }

  const payload = {
    username: username,
    password: password,
    name: name,
    school: school || "Not specified"
  };

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (res.ok) {
      alert(`✅ Account created successfully!\nYou are in ${grade}`);
      document.getElementById('courseModal').classList.add('hidden');
      window.location.href = 'dashboard.html';
    } else {
      alert(data.msg || "Registration failed");
    }
  } catch (err) {
    console.error(err);
    alert("Connection error. Please check your server.");
  }
}

// ===================== FETCH AND DISPLAY POSTS =====================
async function loadPosts() {
  try {
    const res = await fetch('/api/posts');
    const posts = await res.json();

    const container = document.getElementById('postsGrid');

    if (!posts || posts.length === 0) {
      container.innerHTML = `
        <div class="text-center col-span-full py-12">
          <p class="text-gray-500 text-lg">No posts yet. Check back soon for updates!</p>
        </div>`;
      return;
    }

    container.innerHTML = posts.map(post => `
      <article class="bg-white rounded-3xl shadow-lg overflow-hidden hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-2 cursor-pointer" onclick="openPost(${post.id})">
        ${post.image ? `
          <div class="h-48 overflow-hidden">
            <img src="${post.image}" alt="${post.title}" class="w-full h-full object-cover hover:scale-110 transition-transform duration-300">
          </div>` : `
          <div class="h-48 bg-gradient-to-br from-[#19A975] to-[#158a5f] flex items-center justify-center">
            <i class="fas fa-newspaper text-white text-6xl"></i>
          </div>`
        }
        
        <div class="p-6">
          <div class="flex items-center gap-3 text-sm text-gray-500 mb-3">
            <span><i class="fas fa-calendar"></i> ${post.date}</span>
            <span><i class="fas fa-user"></i> ${post.author}</span>
          </div>
          
          <h3 class="text-xl font-bold mb-3 line-clamp-2">${post.title}</h3>
          <p class="text-gray-600 mb-4 line-clamp-3">${post.excerpt || post.content.substring(0, 100) + '...'}</p>
          
          <button class="w-full py-3 border-2 border-[#19A975] text-[#19A975] rounded-2xl font-semibold hover:bg-[#19A975] hover:text-white transition">
            Read More <i class="fas fa-arrow-right ml-2"></i>
          </button>
        </div>
      </article>
    `).join('');

  } catch (error) {
    console.error('Error loading posts:', error);
    document.getElementById('postsGrid').innerHTML = `
      <div class="text-center col-span-full py-12">
        <p class="text-red-500 text-lg">Failed to load posts. Please try again later.</p>
      </div>`;
  }
}

// ===================== OPEN POST DETAIL MODAL =====================
// ===================== OPEN POST - DELIGHTFUL VERSION =====================
async function openPost(postId) {
  try {
    const res = await fetch('/api/posts');
    const posts = await res.json();
    const post = posts.find(p => p.id === postId);

    if (!post) return;

    // Calculate reading time
    const words = post.content.split(' ').length;
    const readTime = Math.max(1, Math.ceil(words / 200));

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[500] p-4 animate-fadeIn';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    modal.innerHTML = `
      <div class="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] overflow-hidden shadow-2xl animate-slideUp">
        <!-- Hero Image -->
        <div class="relative h-72 md:h-96 overflow-hidden">
          ${post.image? `
            <img src="${post.image}" alt="${post.title}" class="w-full h-full object-cover">
            <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"></div>
          ` : `
            <div class="w-full h-full bg-gradient-to-br from-[#19A975] via-emerald-600 to-teal-700"></div>
          `}

          <!-- Close button -->
          <button onclick="this.closest('.fixed').remove()" class="absolute top-6 right-6 bg-white/90 backdrop-blur-md rounded-full w-12 h-12 text-xl hover:bg-white hover:scale-110 transition-all shadow-lg">
            ✕
          </button>

          <!-- Title overlay on image -->
          <div class="absolute bottom-0 left-0 right-0 p-8">
            <div class="flex items-center gap-4 text-white/90 text-sm mb-3">
              <span class="flex items-center gap-2"><i class="fas fa-calendar"></i> ${post.date}</span>
              <span class="text-white/50">•</span>
              <span class="flex items-center gap-2"><i class="fas fa-user"></i> ${post.author}</span>
              <span class="text-white/50">•</span>
              <span class="flex items-center gap-2"><i class="fas fa-clock"></i> ${readTime} min read</span>
            </div>
            <h1 class="text-3xl md:text-5xl font-bold text-white leading-tight">${post.title}</h1>
          </div>
        </div>

        <!-- Content -->
        <div class="p-8 md:p-12 overflow-y-auto max-h-[calc(90vh-24rem)] custom-scroll">
          <p class="text-xl text-gray-600 mb-8 leading-relaxed font-medium border-l-4 border-[#19A975] pl-6">${post.excerpt}</p>

          <div class="prose prose-lg max-w-none text-gray-700 leading-relaxed">
            ${post.content.split('\n\n').map(para => `<p class="mb-6">${para}</p>`).join('')}
          </div>

          <!-- Share bar -->
          <div class="mt-12 pt-8 border-t flex items-center justify-between flex-wrap gap-4">
            <div class="flex gap-3">
              <button onclick="navigator.clipboard.writeText(window.location.href + '#post-${post.id}'); this.innerHTML='<i class=\\'fas fa-check\\'></i> Copied!'"
                class="px-6 py-3 bg-gray-100 hover:bg-gray-200 rounded-2xl font-semibold transition flex items-center gap-2">
                <i class="fas fa-link"></i> Share
              </button>
              <button onclick="window.print()" class="px-6 py-3 bg-gray-100 hover:bg-gray-200 rounded-2xl font-semibold transition flex items-center gap-2">
                <i class="fas fa-print"></i> Print
              </button>
            </div>
            <button onclick="this.closest('.fixed').remove()" class="px-8 py-3 bg-[#19A975] text-white rounded-2xl font-semibold hover:bg-[#158a5f] hover:scale-105 transition-all shadow-lg">
              Done Reading
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Animate progress bar on scroll
    const content = modal.querySelector('.custom-scroll');
    content.addEventListener('scroll', () => {
      const scrolled = content.scrollTop / (content.scrollHeight - content.clientHeight) * 100;
      // You can add a progress bar if you want
    });

  } catch (error) {
    console.error('Error opening post:', error);
  }
}

// Load posts when page loads
document.addEventListener('DOMContentLoaded', loadPosts);

// Preview uploaded profile image
function previewImage(input) {
  const preview = document.getElementById('imagePreview');
  
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    
    reader.onload = function(e) {
      preview.innerHTML = `<img src="${e.target.result}" class="w-full h-full object-cover">`;
      preview.classList.remove('bg-gray-200');
    };
    
    reader.readAsDataURL(input.files[0]);
  } else {
    preview.innerHTML = `<i class="fas fa-user text-gray-400 text-3xl"></i>`;
    preview.classList.add('bg-gray-200');
  }
}

async function submitStaffApplication() {
  const name = document.getElementById('a_name').value.trim();
  const email = document.getElementById('a_email').value.trim();
  const phone = document.getElementById('a_phone').value.trim();
  const bio = document.getElementById('a_bio').value.trim();
  const imageFile = document.getElementById('a_image').files[0];

  if (!name || !email || !phone) {
    alert("Name, email and phone are required!");
    return;
  }

  // Create FormData for file upload
  const formData = new FormData();
  formData.append('name', name);
  formData.append('email', email);
  formData.append('phone', phone);
  formData.append('bio', bio);
  if (imageFile) {
    formData.append('image', imageFile);
  }

  try {
    const res = await fetch('/api/register-staff', {
      method: 'POST',
      body: formData  // Use FormData instead of JSON
    });

    const data = await res.json();

    if (res.ok) {
      alert(`✅ Application submitted successfully!
We will contact you for interview.`);
      document.getElementById('bioModal').classList.add('hidden');
      document.getElementById('adminFormModal').classList.add('hidden');
      document.getElementById('registerModal').classList.add('hidden');
      document.getElementById('adminForm').reset();
      document.getElementById('imagePreview').innerHTML = '<i class="fas fa-user text-gray-400 text-3xl"></i>';
      document.getElementById('imagePreview').classList.add('bg-gray-200');
    } else {
      alert(data.msg || "Registration failed");
    }
  } catch (err) {
    console.error(err);
    alert("Connection error. Please check your server.");
  }
}

// Store staff data temporarily
let tempStaffData = {};

// Show bio page
function showBioPage() {
  const name = document.getElementById('a_name').value.trim();
  const email = document.getElementById('a_email').value.trim();
  const phone = document.getElementById('a_phone').value.trim();

  if (!name || !email || !phone) {
    alert("Name, email and phone are required!");
    return;
  }

  document.getElementById('adminFormModal').classList.add('hidden');
  document.getElementById('bioModal').classList.remove('hidden');
}

// Close bio modal
function closeBioModal() {
  document.getElementById('bioModal').classList.add('hidden');
  document.getElementById('adminFormModal').classList.remove('hidden');
}

// Submit bio and go to photo modal
function submitBioAndGoToPhoto() {
  const bio = document.getElementById('a_bio').value.trim();
  
  if (!bio) {
    alert("Bio is required!");
    return;
  }

  // Store data temporarily
  tempStaffData = {
    name: document.getElementById('a_name').value.trim(),
    email: document.getElementById('a_email').value.trim(),
    phone: document.getElementById('a_phone').value.trim(),
    bio: bio
  };

  // Show photo modal
  document.getElementById('bioModal').classList.add('hidden');
  document.getElementById('photoModal').classList.remove('hidden');
}

// Preview final image
function previewFinalImage(input) {
  const preview = document.getElementById('finalImagePreview');
  
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    
    reader.onload = function(e) {
      preview.innerHTML = `<img src="${e.target.result}" class="w-full h-full object-cover">`;
      preview.classList.remove('bg-gray-200');
    };
    
    reader.readAsDataURL(input.files[0]);
  } else {
    preview.innerHTML = '<i class="fas fa-user text-gray-400 text-5xl"></i>';
    preview.classList.add('bg-gray-200');
  }
}

// Skip photo and submit
function skipPhoto() {
  tempStaffData.hasImage = false;
  submitStaffApplication();
}

// Submit with photo
function submitWithPhoto() {
  const imageFile = document.getElementById('final_image').files[0];
  
  if (imageFile) {
    // Validate file size (5MB max)
    if (imageFile.size > 5 * 1024 * 1024) {
      alert("Image size must be less than 5MB!");
      return;
    }
    
    tempStaffData.hasImage = true;
  } else {
    tempStaffData.hasImage = false;
  }
  
  submitStaffApplication();
}

// Close photo modal
function closePhotoModal() {
  document.getElementById('photoModal').classList.add('hidden');
  document.getElementById('bioModal').classList.remove('hidden');
}

// Submit staff application (with or without photo)
async function submitStaffApplication() {
  const formData = new FormData();
  formData.append('name', tempStaffData.name);
  formData.append('email', tempStaffData.email);
  formData.append('phone', tempStaffData.phone);
  formData.append('bio', tempStaffData.bio);
  
  if (tempStaffData.hasImage) {
    const imageFile = document.getElementById('final_image').files[0];
    if (imageFile) {
      formData.append('image', imageFile);
    }
  }

  try {
    const res = await fetch('/api/register-staff', {
      method: 'POST',
      body: formData  // Use FormData for file upload
    });

    const data = await res.json();

    if (res.ok) {
      alert(`✅ Application submitted successfully!
We will contact you for interview.`);
      
      // Close all modals
      document.getElementById('photoModal').classList.add('hidden');
      document.getElementById('bioModal').classList.add('hidden');
      document.getElementById('adminFormModal').classList.add('hidden');
      document.getElementById('registerModal').classList.add('hidden');
      
      // Reset form
      document.getElementById('adminForm').reset();
      document.getElementById('a_bio').value = '';
      document.getElementById('imagePreview').innerHTML = '<i class="fas fa-user text-gray-400 text-3xl"></i>';
      document.getElementById('imagePreview').classList.add('bg-gray-200');
      document.getElementById('finalImagePreview').innerHTML = '<i class="fas fa-user text-gray-400 text-5xl"></i>';
      document.getElementById('finalImagePreview').classList.add('bg-gray-200');
      
      // Clear temp data
      tempStaffData = {};
    } else {
      alert(data.msg || "Registration failed");
    }
  } catch (err) {
    console.error(err);
    alert("Connection error. Please check your server.");
  }
}

// Preview image (for the first form - optional)
function previewImage(input) {
  const preview = document.getElementById('imagePreview');
  
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    
    reader.onload = function(e) {
      preview.innerHTML = `<img src="${e.target.result}" class="w-full h-full object-cover">`;
      preview.classList.remove('bg-gray-200');
    };
    
    reader.readAsDataURL(input.files[0]);
  } else {
    preview.innerHTML = '<i class="fas fa-user text-gray-400 text-3xl"></i>';
    preview.classList.add('bg-gray-200');
  }
}

// Fetch and display posts
// Fetch and display posts
async function loadPosts() {
  try {
    const res = await fetch('/api/posts');
    const posts = await res.json();

    const grid = document.getElementById('postsGrid');

    if (!posts || posts.length === 0) {
      grid.innerHTML = `
        <div class="text-center col-span-full py-12">
          <p class="text-gray-500 text-lg">No posts available yet.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = posts.map(post => {
      const image = post.image
        ? `<img src="${post.image}" alt="${post.title}" class="w-full h-48 object-cover rounded-2xl">`
        : `<div class="w-full h-48 bg-gradient-to-br from-[#19A975] to-emerald-500 rounded-2xl flex items-center justify-center"><i class="fas fa-newspaper text-white text-5xl"></i></div>`;

      return `
        <article class="bg-white rounded-3xl shadow-sm border hover:shadow-xl transition group overflow-hidden">
          <div class="relative">
            ${image}
          </div>
          <div class="p-6">
            <div class="text-sm text-gray-500 mb-2 flex items-center gap-2">
              <span>${post.date}</span>
              <span class="text-gray-300">|</span>
              <span>${post.author}</span>
            </div>
            <h3 class="text-xl font-bold mb-2 group-hover:text-[#19A975] transition">
              ${post.title}
            </h3>
            <p class="text-gray-600 mb-4 leading-relaxed">
              ${post.excerpt}
            </p>
            <button onclick="openPost(${post.id})" class="inline-flex items-center gap-2 text-[#19A975] font-semibold hover:underline">
              Read Full Post
              <i class="fas fa-arrow-right"></i>
            </button>
          </div>
        </article>
      `;
    }).join('');

  } catch (err) {
    console.error(err);
    const grid = document.getElementById('postsGrid');
    grid.innerHTML = `
      <div class="text-center col-span-full py-12">
        <p class="text-red-500 text-lg">Failed to load posts.</p>
      </div>
    `;
  }
}

    function toggleZoom(itemId) {
  const item = document.getElementById(itemId);
  item.classList.toggle("zooming");
}



document.addEventListener("DOMContentLoaded", () => {
  const mainImage = document.getElementById("mainImage");
  const thumbs = document.querySelectorAll(".thumb");
  const thumbImages = Array.from(thumbs).map(thumb => thumb.querySelector("img"));
  const images = thumbImages.map(img => ({
    src: img.src,
    alt: img.alt
  }));

  let currentIndex = 0;
  let shuffleTimer = null;
  let isTransitioning = false;

  function showImage(index) {
    if (isTransitioning) return;
    isTransitioning = true;

    mainImage.classList.add("fade-out");

    setTimeout(() => {
      currentIndex = index;
      mainImage.src = images[currentIndex].src;
      mainImage.alt = images[currentIndex].alt;

      thumbs.forEach((thumb, i) => {
        thumb.classList.toggle("active", i === currentIndex);
      });

      mainImage.classList.remove("fade-out");
      mainImage.classList.add("fade-in");

      setTimeout(() => {
        mainImage.classList.remove("fade-in");
        isTransitioning = false;
      }, 350);
    }, 250);
  }

  function nextImage() {
    const nextIndex = (currentIndex + 1) % images.length;
    showImage(nextIndex);
  }

  function startShuffle() {
    stopShuffle();
    shuffleTimer = setInterval(nextImage, 5000);
  }

  function stopShuffle() {
    if (shuffleTimer) {
      clearInterval(shuffleTimer);
      shuffleTimer = null;
    }
  }

  thumbs.forEach((thumb, index) => {
    thumb.addEventListener("click", () => {
      showImage(index);
      startShuffle();
    });
  });

  showImage(0);
  startShuffle();
});



document.addEventListener('DOMContentLoaded', () => {
  loadPosts();
});


const teaser = document.getElementById('pdfTeaser');
const closeBtn = document.getElementById('closePdf');
const pdfFrame = document.getElementById('pdfFrame');

const pdfUrl = 'page.pdf';

teaser.addEventListener('click', () => {
  teaser.classList.add('open');
  pdfFrame.src = `${pdfUrl}#page=1&zoom=FitH`;
});

closeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  teaser.classList.remove('open');
  pdfFrame.src = '';
});




const wrapper = document.getElementById('videoWrapper');
const video = document.getElementById('mainVideo');
const overlay = document.getElementById('overlay');

wrapper.addEventListener('click', () => {
  if (video.paused) {
    video.play().catch(e => console.log("Play error:", e));
    overlay.style.opacity = '0';
    setTimeout(() => overlay.style.display = 'none', 600);
  } else {
    video.pause();
  }
});

// Auto muted preview
video.addEventListener('loadedmetadata', () => {
  video.muted = true;
  video.loop = true;
  video.play().catch(() => {});
});