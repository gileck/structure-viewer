(function () {
  'use strict';

  const siteInput = document.getElementById('siteInput');
  const loadSiteBtn = document.getElementById('loadSiteBtn');
  const pagesContainer = document.getElementById('pagesContainer');
  const siteStatus = document.getElementById('siteStatus');

  function setStatus(msg) {
    siteStatus.textContent = msg || '';
  }

  function sanitizeBase(url) {
    try {
      const u = new URL(url);
      u.hash = '';
      // Keep existing query if any; we will append dumpSiteModels if missing
      return u.toString();
    } catch (_) {
      return String(url || '').trim();
    }
  }

  function buildDumpModelsUrl(siteUrl) {
    const base = sanitizeBase(siteUrl);
    try {
      const u = new URL(base);
      if (!u.searchParams.has('dumpSiteModels')) {
        u.searchParams.append('dumpSiteModels', 'true');
      } else if (u.searchParams.get('dumpSiteModels') === '') {
        u.searchParams.set('dumpSiteModels', 'true');
      }
      return u.toString();
    } catch (_) {
      // Fallback simple concat
      return base.includes('?') ? `${base}&dumpSiteModels=true` : `${base}?dumpSiteModels=true`;
    }
  }

  function getPagesFromSiteModels(siteModels) {
    try {
      return siteModels && siteModels.rendererModel && siteModels.rendererModel.pageList && siteModels.rendererModel.pageList.pages
        ? siteModels.rendererModel.pageList.pages
        : [];
    } catch (_) {
      return [];
    }
  }

  function clearPages() {
    pagesContainer.innerHTML = '';
  }

  function renderPages(pages) {
    clearPages();
    if (!Array.isArray(pages) || pages.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No pages found.';
      pagesContainer.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.style.display = 'grid';
    list.style.gridTemplateColumns = 'repeat(auto-fill, minmax(260px, 1fr))';
    list.style.gap = '8px';

    for (const page of pages) {
      const title = page.title || '(untitled)';
      const pageId = page.pageId || '';
      const fileName = page.pageJsonFileName || '';
      const jsonUrl = fileName ? `https://pages.parastorage.com/sites/${fileName}` : '';
      const viewerUrl = jsonUrl ? `${location.origin}${location.pathname.replace(/site\.html$/, 'index.html').replace(/\/site$/, '/index.html').replace(/index\.html$/, '')}?url=${encodeURIComponent(jsonUrl)}`
                                : '';

      const btn = document.createElement('a');
      btn.href = viewerUrl || '#';
      btn.textContent = `${title} (${pageId})`;
      btn.style.display = 'inline-block';
      btn.style.padding = '8px 12px';
      btn.style.border = '1px solid var(--border)';
      btn.style.borderRadius = '8px';
      btn.style.background = 'var(--panel)';
      btn.style.color = 'var(--text)';
      btn.style.textDecoration = 'none';
      btn.style.cursor = jsonUrl ? 'pointer' : 'not-allowed';
      if (!jsonUrl) btn.setAttribute('aria-disabled', 'true');
      btn.target = '_blank';
      btn.rel = 'noopener';

      list.appendChild(btn);
    }

    pagesContainer.appendChild(list);
  }

  async function loadSite(siteUrl) {
    const src = String(siteUrl || '').trim();
    if (!src) { setStatus('Enter a valid site URL'); return; }
    try {
      clearPages();
      const dumpUrl = buildDumpModelsUrl(src);
      setStatus(`Fetching site models…`);
      let siteModels = null;
      try {
        const res = await fetch(dumpUrl, { mode: 'cors' });
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
        siteModels = await res.json();
      } catch (primaryErr) {
        // Likely CORS. Try a public CORS proxy fallback for local dev.
        try {
          setStatus('Direct fetch blocked by CORS. Retrying via proxy…');
          const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(dumpUrl)}`;
          const proxied = await fetch(proxyUrl, { mode: 'cors' });
          if (!proxied.ok) throw new Error(`Proxy failed: ${proxied.status} ${proxied.statusText}`);
          const text = await proxied.text();
          siteModels = JSON.parse(text);
        } catch (proxyErr) {
          throw primaryErr;
        }
      }
      const pages = getPagesFromSiteModels(siteModels);
      renderPages(pages);
      setStatus(`Loaded ${pages.length} pages`);
      // Update query param
      updateQueryParam('site', src);
    } catch (e) {
      setStatus(e && e.message ? e.message : 'Failed to load site models');
    }
  }

  function updateQueryParam(key, value) {
    const url = new URL(window.location.href);
    if (value === null || value === undefined || value === '') {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
    window.history.replaceState({}, '', url);
  }

  if (loadSiteBtn) {
    loadSiteBtn.addEventListener('click', () => {
      const siteUrl = siteInput && siteInput.value;
      loadSite(siteUrl);
    });
  }
  if (siteInput) {
    siteInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        loadSite(siteInput.value);
      }
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const site = params.get('site');
    if (site) {
      if (siteInput) siteInput.value = site;
      loadSite(site);
    }
  });
})();


