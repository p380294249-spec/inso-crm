// ── INSO CRM 共用导航栏 ──────────────────────────────
// 所有页面 <head> 里引入：<script src="nav.js"></script>
// 会自动在 body 顶部插入导航栏

(function () {
  const PAGES = [
    { label: '记录沟通',    href: 'contact-log.html',  icon: '✎' },
    { label: '客户列表',    href: 'customers.html',    icon: '◫' },
    { label: 'Dashboard',  href: 'dashboard.html',    icon: '▤' },
  ];

  // 判断当前页面
  const current = location.pathname.split('/').pop() || 'contact-log.html';

  function insertNav() {
    if (document.getElementById('inso-nav')) return;

    // 注入 CSS
    const style = document.createElement('style');
    style.textContent = `
    #inso-nav {
      position: sticky;
      top: 0;
      z-index: 200;
      background: rgba(255,255,255,0.88);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid #dde3ea;
      display: flex;
      align-items: center;
      padding: 0 20px;
      height: 56px;
      gap: 0;
    }
    #inso-nav .nav-logo {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 11px;
      letter-spacing: 0.15em;
      color: #2563eb;
      border: 1px solid #bfdbfe;
      background: #eff6ff;
      padding: 4px 10px;
      margin-right: 20px;
      text-decoration: none;
      flex-shrink: 0;
      border-radius: 8px;
    }
    #inso-nav .nav-links {
      display: flex;
      align-items: center;
      gap: 2px;
      flex: 1;
    }
    #inso-nav .nav-link {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 11px;
      letter-spacing: 0.08em;
      color: #64748b;
      text-decoration: none;
      padding: 0 14px;
      height: 56px;
      display: flex;
      align-items: center;
      gap: 6px;
      border-bottom: 2px solid transparent;
      transition: color 0.15s, border-color 0.15s;
      white-space: nowrap;
    }
    #inso-nav .nav-link:hover { color: #18202f; background: #f1f5f9; }
    #inso-nav .nav-link.active {
      color: #2563eb;
      border-bottom-color: #2563eb;
    }
    #inso-nav .nav-icon { font-size: 13px; }

    /* body 顶部留出导航高度 */
    body { padding-top: 0 !important; }
    body > *:not(#inso-nav):first-of-type { margin-top: 24px; }
    `;
    document.head.appendChild(style);

    // 构建 HTML
    const nav = document.createElement('nav');
    nav.id = 'inso-nav';

    const logo = document.createElement('a');
    logo.className = 'nav-logo';
    logo.href = 'contact-log.html';
    logo.textContent = 'INSO';
    nav.appendChild(logo);

    const links = document.createElement('div');
    links.className = 'nav-links';

    PAGES.forEach(p => {
      const a = document.createElement('a');
      a.className = 'nav-link' + (current === p.href ? ' active' : '');
      a.href = p.href;
      a.innerHTML = `<span class="nav-icon">${p.icon}</span>${p.label}`;
      links.appendChild(a);
    });

    nav.appendChild(links);

    // 插入到 body 第一个子元素之前
    document.body.insertBefore(nav, document.body.firstChild);
  }

  if (document.body) {
    insertNav();
  } else {
    document.addEventListener('DOMContentLoaded', insertNav);
  }
})();
