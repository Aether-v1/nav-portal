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

  // 延迟分级：<100优秀 / 100-200良好 / 200-400一般 / 400-800较高 / >800很高
  function getDelayClass(delay) {
    if (delay === null || delay === undefined) return 'delay-bad';
    if (delay < 100) return 'delay-excellent';
    if (delay < 200) return 'delay-good';
    if (delay < 400) return 'delay-normal';
    if (delay < 800) return 'delay-high';
    return 'delay-bad';
  }

  function getDelayLabel(delay) {
    if (delay === null || delay === undefined) return '无法访问';
    if (delay < 100) return '优秀';
    if (delay < 200) return '良好';
    if (delay < 400) return '一般';
    if (delay < 800) return '较高';
    return '很高';
  }

  function applyDelayResult(delayEl, ms, status) {
    if (status === 'unavailable' || ms === null || ms === undefined) {
      delayEl.className = 'link-delay delay-bad';
      delayEl.textContent = '无法访问';
      delayEl.setAttribute('aria-label', '延迟：无法访问');
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
    card.dataset.ping = link.ping || '';

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

  // 单次测速：浏览器直接访问目标 ping 地址
  function singlePing(pingUrl, signal) {
    return new Promise(function (resolve) {
      var sep = pingUrl.indexOf('?') === -1 ? '?' : '&';
      var url = pingUrl + sep + 't=' + Date.now() + '-' + Math.random().toString(36).slice(2);
      var start = performance.now();

      fetch(url, {
        method: 'GET',
        cache: 'no-store',
        signal: signal
      }).then(function (response) {
        var elapsed = Math.round(performance.now() - start);
        if (response.ok) {
          resolve(elapsed);
        } else {
          resolve(null);
        }
      }).catch(function (err) {
        if (err.name === 'AbortError') {
          resolve(null);
        } else {
          resolve(null);
        }
      });
    });
  }

  // 单条线路测速：预热1次 + 正式3次 + 取中位数
  async function pingLink(pingUrl, delayEl) {
    if (!pageVisible || !pingUrl) {
      applyDelayResult(delayEl, null, 'unavailable');
      return null;
    }

    var ctrl = createAbortController();
    var signal = ctrl ? ctrl.signal : undefined;

    try {
      // 预热1次，不计入结果
      await singlePing(pingUrl, signal);
      if (!pageVisible || (signal && signal.aborted)) return null;

      // 正式测试3次
      var results = [];
      for (var i = 0; i < 3; i++) {
        if (!pageVisible || (signal && signal.aborted)) break;
        var r = await singlePing(pingUrl, signal);
        if (r !== null) results.push(r);
      }

      if (results.length === 0) {
        applyDelayResult(delayEl, null, 'unavailable');
        return null;
      }

      // 取中位数
      results.sort(function (a, b) { return a - b; });
      var median;
      if (results.length % 2 === 1) {
        median = results[Math.floor(results.length / 2)];
      } else {
        median = Math.round((results[results.length / 2 - 1] + results[results.length / 2]) / 2);
      }

      applyDelayResult(delayEl, median, 'ok');
      return median;
    } catch (err) {
      if (err.name !== 'AbortError') {
        applyDelayResult(delayEl, null, 'unavailable');
      }
      return null;
    }
  }

  // 并行测速所有线路
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
      // 所有卡片重置为检测中
      cards.forEach(function (card) {
        var delayEl = card._delayEl || card.querySelector('.link-delay');
        if (delayEl) {
          delayEl.className = 'link-delay delay-normal';
          delayEl.textContent = '检测中...';
        }
      });

      // 完全并行测试所有线路
      var promises = cards.map(function (card) {
        if (!pageVisible) return null;
        var pingUrl = card.dataset.ping;
        var delayEl = card._delayEl || card.querySelector('.link-delay');
        return pingLink(pingUrl, delayEl);
      });

      await Promise.all(promises);
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

      // 尽早加载 Crisp
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
