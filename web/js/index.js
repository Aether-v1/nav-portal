(function () {
  'use strict';

  var abortControllers = [];
  var isRefreshing = false;
  var pageVisible = true;

  document.addEventListener('visibilitychange', function () {
    pageVisible = !document.hidden;
    if (document.hidden) {
      cancelAllRequests();
    }
  });

  window.addEventListener('beforeunload', function () {
    cancelAllRequests();
  });

  function cancelAllRequests() {
    abortControllers.forEach(function (ctrl) {
      try { ctrl.abort(); } catch (_) {}
    });
    abortControllers = [];
  }

  function createAbortController() {
    if (typeof AbortController !== 'undefined') {
      var ctrl = new AbortController();
      abortControllers.push(ctrl);
      return ctrl;
    }
    return null;
  }

  function getDelayClass(delay) {
    if (delay === null || delay === undefined) return 'delay-bad';
    if (delay < 200) return 'delay-excellent';
    if (delay < 400) return 'delay-good';
    if (delay < 800) return 'delay-normal';
    return 'delay-bad';
  }

  function getDelayLabel(delay) {
    if (delay === null || delay === undefined) return '超时';
    if (delay < 200) return '优秀';
    if (delay < 400) return '良好';
    if (delay < 800) return '一般';
    return '较高';
  }

  function applyDelayResult(delayEl, ms) {
    if (ms === null || ms === undefined) {
      delayEl.className = 'link-delay delay-bad';
      delayEl.textContent = '超时';
      delayEl.setAttribute('aria-label', '延迟：超时');
      return;
    }
    delayEl.className = 'link-delay ' + getDelayClass(ms);
    delayEl.textContent = ms + ' ms';
    delayEl.setAttribute('aria-label', '延迟：' + ms + ' 毫秒，' + getDelayLabel(ms));
  }

  function copyToClipboard(text) {
    return new Promise(function (resolve, reject) {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(resolve).catch(function () {
          fallbackCopy(text, resolve, reject);
        });
      } else {
        fallbackCopy(text, resolve, reject);
      }
    });
  }

  function fallbackCopy(text, resolve, reject) {
    try {
      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (ok) resolve();
      else reject(new Error('copy failed'));
    } catch (err) {
      reject(err);
    }
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function createLinkCard(link) {
    var card = document.createElement('div');
    card.className = 'link-card';
    card.dataset.id = String(link.id);

    var badgeHtml = link.badge
      ? '<span class="link-badge">' + escapeHtml(link.badge) + '</span>'
      : '';

    card.innerHTML =
      '<div class="link-title">' + escapeHtml(link.name || '线路') + '</div>' +
      badgeHtml +
      '<div class="link-delay delay-normal" aria-live="polite">检测中...</div>' +
      '<button class="enter-button" type="button">点击进入</button>';

    var delayEl = card.querySelector('.link-delay');
    card._delayEl = delayEl;

    card.querySelector('.enter-button').addEventListener('click', function () {
      window.location.href = '/jump?id=' + encodeURIComponent(link.id);
    });

    return card;
  }

  async function pingLink(linkId, delayEl) {
    if (!pageVisible) return null;

    var ctrl = createAbortController();
    try {
      var response = await fetch('/api/ping?id=' + encodeURIComponent(linkId), {
        method: 'GET',
        cache: 'no-store',
        signal: ctrl ? ctrl.signal : undefined
      });

      if (!response.ok) {
        if (response.status === 429) {
          delayEl.textContent = '繁忙';
          delayEl.className = 'link-delay delay-normal';
          return null;
        }
        throw new Error('ping failed: ' + response.status);
      }

      var data = await response.json();
      if (data.success && data.status === 'ok') {
        applyDelayResult(delayEl, data.delay);
        return data.delay;
      }
      applyDelayResult(delayEl, null);
      return null;
    } catch (err) {
      if (err.name === 'AbortError') return null;
      applyDelayResult(delayEl, null);
      return null;
    }
  }

  async function refreshAllDelays() {
    if (isRefreshing) return;
    isRefreshing = true;

    var button = document.getElementById('refreshDelayButton');
    var cards = Array.from(document.querySelectorAll('.link-card'));

    if (button) {
      button.disabled = true;
      button.classList.add('is-loading');
      button.textContent = '刷新中...';
    }

    try {
      var MAX_CONCURRENT = 2;
      var index = 0;

      async function worker() {
        while (index < cards.length) {
          if (!pageVisible) return;
          var card = cards[index++];
          var linkId = card.dataset.id;
          var delayEl = card._delayEl || card.querySelector('.link-delay');
          if (delayEl) {
            delayEl.className = 'link-delay delay-normal';
            delayEl.textContent = '检测中...';
          }
          await pingLink(linkId, delayEl);
        }
      }

      var workers = [];
      for (var i = 0; i < Math.min(MAX_CONCURRENT, cards.length); i++) {
        workers.push(worker());
      }
      await Promise.all(workers);
    } finally {
      isRefreshing = false;
      if (button) {
        button.disabled = false;
        button.classList.remove('is-loading');
        button.textContent = '点击刷新延迟';
      }
    }
  }

  async function loadConfig() {
    var ctrl = createAbortController();
    var response = await fetch('/api/config', {
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    });
    if (!response.ok) {
      throw new Error('加载配置失败: ' + response.status);
    }
    return response.json();
  }

  async function init() {
    var yearEl = document.getElementById('footerYear');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    try {
      var config = await loadConfig();

      if (config.siteName) {
        document.title = config.siteName + ' - 导航门户';
      }

      var siteNameEl = document.getElementById('siteName');
      var siteSubtitleEl = document.getElementById('siteSubtitle');
      var siteNoticeEl = document.getElementById('siteNotice');

      if (siteNameEl && config.siteName) siteNameEl.textContent = config.siteName;
      if (siteSubtitleEl && config.siteSubtitle) siteSubtitleEl.textContent = config.siteSubtitle;
      if (siteNoticeEl && config.siteNotice) siteNoticeEl.textContent = config.siteNotice;

      var heroButton = document.getElementById('heroButton');
      if (heroButton) {
        var buttonText = config.heroButtonText || config.siteDomain || '牢记域名';
        heroButton.textContent = buttonText;
        heroButton.addEventListener('click', async function () {
          var domain = config.siteDomain || '';
          try {
            await copyToClipboard(domain);
            heroButton.textContent = '已复制域名';
            setTimeout(function () {
              heroButton.textContent = buttonText;
            }, 1500);
          } catch (_) {
            window.prompt('请手动复制域名：', domain);
          }
        });
      }

      var linksGrid = document.getElementById('linksGrid');
      if (linksGrid) {
        linksGrid.innerHTML = '';

        var enabledLinks = Array.isArray(config.links)
          ? config.links.filter(function (link) { return link && link.enabled !== false; })
          : [];

        if (enabledLinks.length === 0) {
          linksGrid.innerHTML = '<div class="error-tip">暂无可用线路，请稍后再试。</div>';
        } else {
          enabledLinks.forEach(function (link) {
            var card = createLinkCard(link);
            linksGrid.appendChild(card);
          });
          refreshAllDelays();
        }
      }

      var tgButton = document.getElementById('tgButton');
      if (tgButton) {
        if (config.tg && config.tg.url) {
          tgButton.href = config.tg.url;
          tgButton.textContent = config.tg.text || '官方TG群组';
        } else {
          tgButton.style.display = 'none';
        }
      }

      // 动态加载 Crisp 客服（如果配置了 WEBSITE_ID）
      if (config.crispWebsiteId) {
        try {
          window.$crisp = [];
          window.CRISP_WEBSITE_ID = config.crispWebsiteId;
          var crispScript = document.createElement('script');
          crispScript.src = 'https://client.crisp.chat/l.js';
          crispScript.async = 1;
          document.getElementsByTagName('head')[0].appendChild(crispScript);
        } catch (_) {}
      }

      var refreshDelayButton = document.getElementById('refreshDelayButton');
      if (refreshDelayButton) {
        refreshDelayButton.addEventListener('click', refreshAllDelays);
      }
    } catch (error) {
      console.error('init failed:', error);
      var linksGrid = document.getElementById('linksGrid');
      if (linksGrid) {
        linksGrid.innerHTML = '<div class="error-tip">配置加载失败，请检查网络或稍后重试。</div>';
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
