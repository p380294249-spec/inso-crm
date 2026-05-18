// ── INSO CRM 共用导航栏 ──────────────────────────────
// 所有页面 <head> 里引入：<script src="nav.js"></script>
// 会自动在 body 顶部插入导航栏

(function () {
  const PAGES = [
    { label: 'Dashboard',  href: 'dashboard.html',    icon: '▤' },
    { label: '客户列表',    href: 'customers.html',    icon: '◫' },
    { label: '记录沟通',    href: 'contact-log.html',  icon: '✎' },
  ];

  // 判断当前页面
  const current = location.pathname.split('/').pop() || 'dashboard.html';

  // 注入 CSS
  const style = document.createElement('style');
  style.textContent = `
    #inso-nav {
      position: sticky;
      top: 0;
      z-index: 200;
      background: rgba(13,15,17,0.92);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid #242628;
      display: flex;
      align-items: center;
      padding: 0 20px;
      height: 48px;
      gap: 0;
    }
    #inso-nav .nav-logo {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 11px;
      letter-spacing: 0.15em;
      color: #3a7bd5;
      border: 1px solid #3a7bd5;
      padding: 3px 9px;
      margin-right: 20px;
      text-decoration: none;
      flex-shrink: 0;
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
      color: #6b7280;
      text-decoration: none;
      padding: 0 14px;
      height: 48px;
      display: flex;
      align-items: center;
      gap: 6px;
      border-bottom: 2px solid transparent;
      transition: color 0.15s, border-color 0.15s;
      white-space: nowrap;
    }
    #inso-nav .nav-link:hover { color: #e8eaed; }
    #inso-nav .nav-link.active {
      color: #3a7bd5;
      border-bottom-color: #3a7bd5;
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
  logo.href = 'dashboard.html';
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
})();
