function getDelayClass(delay) {
  if (delay < 300) return 'delay-good';
  if (delay < 800) return 'delay-normal';
  return 'delay-bad';
}

function withCacheBuster(url) {
  return `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function measureDelayOnce(url, timeout = 2500) {
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(withCacheBuster(url), {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`测速失败: ${response.status}`);
    }

    return Math.round(performance.now() - start);
  } catch (error) {
    clearTimeout(timer);
    console.error('测速失败:', url, error);
    return null;
  }
}

function getMedian(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function warmup(url) {
  try {
    await measureDelayOnce(url, 3000);
  } catch (error) {
    console.warn('预热失败:', url, error);
  }
}

async function measureDelay(url) {
  await warmup(url);

  const results = [];
  results.push(await measureDelayOnce(url));
  results.push(await measureDelayOnce(url));
  results.push(await measureDelayOnce(url));

  const valid = results.filter((v) => typeof v === 'number');

  if (valid.length === 3) {
    return getMedian(valid);
  }

  if (valid.length === 2) {
    return Math.round((valid[0] + valid[1]) / 2);
  }

  return null;
}

function applyDelayResult(delayEl, ms) {
  if (ms === null) {
    delayEl.className = 'link-delay delay-bad';
    delayEl.textContent = '超时';
    return;
  }

  delayEl.className = `link-delay ${getDelayClass(ms)}`;
  delayEl.textContent = `${ms} ms`;
}

function getDirectLink(link) {
  return (
    link.url ||
    link.href ||
    link.link ||
    link.domain ||
    link.target ||
    '#'
  );
}

function normalizeUrl(url) {
  if (!url || url === '#') return '#';
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

function createLinkCard(link) {
  const card = document.createElement('div');
  card.className = 'link-card';
  card.dataset.ping = link.ping || '';

  card.innerHTML = `
    <div class="link-title"></div>
    <div class="link-delay delay-normal">检测中...</div>
    <button class="enter-button" type="button">点击进入</button>
  `;

  card.querySelector('.link-title').textContent = link.name || '线路';

  const delayEl = card.querySelector('.link-delay');
  card._delayEl = delayEl;

  if (!link.ping) {
    delayEl.className = 'link-delay delay-bad';
    delayEl.textContent = '--';
  }

  const directUrl = normalizeUrl(getDirectLink(link));

  card.querySelector('.enter-button').addEventListener('click', () => {
    if (!directUrl || directUrl === '#') {
      window.alert('该线路未配置直连地址');
      return;
    }
    window.location.href = directUrl;
  });

  return card;
}

async function refreshCardDelay(card) {
  const delayEl = card?._delayEl || card?.querySelector('.link-delay');
  const ping = card?.dataset?.ping;

  if (!delayEl) return;

  if (!ping) {
    delayEl.className = 'link-delay delay-bad';
    delayEl.textContent = '--';
    return;
  }

  delayEl.className = 'link-delay delay-normal';
  delayEl.textContent = '检测中...';

  const ms = await measureDelay(ping);
  applyDelayResult(delayEl, ms);
}

async function refreshAllDelays() {
  const button = document.getElementById('refreshDelayButton');
  const cards = Array.from(document.querySelectorAll('.link-card'));

  if (button) {
    button.disabled = true;
    button.classList.add('is-loading');
    button.textContent = '刷新中...';
  }

  try {
    await Promise.all(cards.map((card) => refreshCardDelay(card)));
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove('is-loading');
      button.textContent = '点击刷新延迟';
    }
  }
}

async function loadConfig() {
  const response = await fetch('/api/config', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('加载配置失败');
  }
  return response.json();
}

async function init() {
  try {
    const config = await loadConfig();

    document.title = `${config.siteName || '导航页'} - 导航页`;

    const siteNameEl = document.getElementById('siteName');
    const siteSubtitleEl = document.getElementById('siteSubtitle');
    const siteNoticeEl = document.getElementById('siteNotice');

    if (siteNameEl) siteNameEl.textContent = config.siteName || '';
    if (siteSubtitleEl) siteSubtitleEl.textContent = config.siteSubtitle || '';
    if (siteNoticeEl) siteNoticeEl.textContent = config.siteNotice || '';

    const heroButton = document.getElementById('heroButton');
    if (heroButton) {
      heroButton.textContent = config.heroButtonText || config.siteDomain || '';
      heroButton.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(config.siteDomain || '');
          heroButton.textContent = '已复制域名';
          setTimeout(() => {
            heroButton.textContent = config.heroButtonText || config.siteDomain || '';
          }, 1500);
        } catch {
          window.alert(`请手动复制域名：${config.siteDomain || ''}`);
        }
      });
    }

    const linksGrid = document.getElementById('linksGrid');
    if (linksGrid) {
      linksGrid.innerHTML = '';

      const enabledLinks = Array.isArray(config.links)
        ? config.links.filter((link) => link && link.enabled !== false)
        : [];

      if (enabledLinks.length === 0) {
        linksGrid.innerHTML = '<div class="error-tip">暂无可用线路，请稍后再试。</div>';
      } else {
        const cards = enabledLinks.map((link) => createLinkCard(link));
        cards.forEach((card) => linksGrid.appendChild(card));
        await Promise.all(cards.map((card) => refreshCardDelay(card)));
      }
    }

    const tgButton = document.getElementById('tgButton');
    if (tgButton) {
      tgButton.href = config.tg?.url || '#';
      tgButton.textContent = config.tg?.text || '官方TG群组';
    }

    const refreshDelayButton = document.getElementById('refreshDelayButton');
    if (refreshDelayButton) {
      refreshDelayButton.addEventListener('click', refreshAllDelays);
    }
  } catch (error) {
    console.error(error);
    const linksGrid = document.getElementById('linksGrid');
    if (linksGrid) {
      linksGrid.innerHTML = '<div class="error-tip">配置加载失败，请检查服务端或配置文件。</div>';
    }
  }
}

init();