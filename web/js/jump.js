(function () {
  'use strict';

  function getQueryParam(name) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  async function fetchJson(url) {
    var response = await fetch(url, { cache: 'no-store' });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      throw new Error(data.message || '请求失败');
    }
    return data;
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  async function init() {
    var id = getQueryParam('id');

    if (!id || !/^\d+$/.test(id) || Number(id) <= 0) {
      setText('jumpTitle', '参数错误');
      setText('jumpMessage', '缺少有效的线路参数，无法继续跳转。');
      var skipBtn = document.getElementById('skipButton');
      if (skipBtn) skipBtn.style.display = 'none';
      return;
    }

    try {
      var meta = await fetchJson('/api/jump/meta?id=' + encodeURIComponent(id));

      if (!meta.success) {
        throw new Error(meta.message || '线路不可用');
      }

      document.title = (meta.title || '安全连接') + ' - ' + (meta.name || '');
      setText('jumpTitle', meta.title || '正在建立安全连接');
      setText('jumpName', meta.name + (meta.badge ? ' · ' + meta.badge : ''));
      setText('jumpMessage', meta.message || '请稍候...');
      setText('jumpFooter', meta.footer || '');

      var seconds = Number(meta.seconds || 5);
      var countdown = document.getElementById('countdown');
      var skipButton = document.getElementById('skipButton');
      var jumped = false;

      async function resolveAndGo() {
        if (jumped) return;
        jumped = true;
        if (skipButton) {
          skipButton.disabled = true;
          skipButton.textContent = '正在进入...';
        }
        try {
          var result = await fetchJson('/api/jump/resolve?id=' + encodeURIComponent(id));
          if (!result.success || !result.url) {
            throw new Error(result.message || '跳转失败');
          }
          window.location.href = result.url;
        } catch (error) {
          jumped = false;
          if (skipButton) {
            skipButton.disabled = false;
            skipButton.textContent = '立即进入';
          }
          setText('jumpMessage', error.message || '跳转失败，请重试');
        }
      }

      if (skipButton) {
        skipButton.addEventListener('click', resolveAndGo);
      }

      if (countdown) countdown.textContent = String(seconds);

      var timer = setInterval(function () {
        seconds -= 1;
        if (countdown) countdown.textContent = String(Math.max(seconds, 0));
        if (seconds <= 0) {
          clearInterval(timer);
          resolveAndGo();
        }
      }, 1000);

      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          clearInterval(timer);
        }
      });
    } catch (error) {
      console.error('jump init error:', error);
      setText('jumpTitle', '线路不可用');
      setText('jumpMessage', error.message || '目标线路不存在或已关闭。');
      setText('jumpFooter', '请返回首页选择其他入口');
      var skipBtn2 = document.getElementById('skipButton');
      if (skipBtn2) skipBtn2.style.display = 'none';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
