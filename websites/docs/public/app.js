// ─── Config ───
const SITES = {
  home: localStorage.getItem('pump_landing_url') || '/',
};

document.getElementById('back-to-site').href = SITES.home;

// ─── Sidebar Active Link Tracking ───
function initSidebarTracking() {
  const sections = document.querySelectorAll('.doc-section');
  const navItems = document.querySelectorAll('.nav-item');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        navItems.forEach(item => {
          item.classList.toggle('active', item.getAttribute('href') === '#' + id);
        });
      }
    });
  }, {
    rootMargin: '-80px 0px -70% 0px',
    threshold: 0
  });

  sections.forEach(section => observer.observe(section));

  // Click to scroll and close mobile sidebar
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const sidebar = document.getElementById('sidebar');
      if (window.innerWidth <= 900) {
        sidebar.classList.remove('open');
      }
    });
  });
}

// ─── Mobile Menu ───
function initMobileMenu() {
  const btn = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('sidebar');
  const closeBtn = document.getElementById('sidebar-close');

  if (btn && sidebar) {
    btn.addEventListener('click', () => sidebar.classList.toggle('open'));
  }
  if (closeBtn && sidebar) {
    closeBtn.addEventListener('click', () => sidebar.classList.remove('open'));
  }

  // Close sidebar on outside click (mobile)
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 900 && sidebar.classList.contains('open')) {
      if (!sidebar.contains(e.target) && !btn.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    }
  });
}

// ─── Smooth scroll for anchor links ───
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const target = document.querySelector(link.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        history.pushState(null, '', link.getAttribute('href'));
      }
    });
  });
}

// ─── Init ───
initSidebarTracking();
initMobileMenu();
initSmoothScroll();
