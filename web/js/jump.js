function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || '请求失败');
  }
  return data;
}

async function init() {
  const id = getQueryParam('id');
  if (!id) {
    document.getElementById('jumpTitle').textContent = '参数错误';
    document.getElementById('jumpMessage').textContent = '缺少线路参数，无法继续跳转。';
    document.getElementById('skipButton').style.display = 'none';
    return;
  }

  try {
    const meta = await fetchJson(`/api/jump/meta?id=${encodeURIComponent(id)}`);
    document.title = `${meta.title} - ${meta.name}`;
    document.getElementById('jumpTitle').textContent = meta.title;
    document.getElementById('jumpName').textContent = `${meta.name}${meta.badge ? ` · ${meta.badge}` : ''}`;
    document.getElementById('jumpMessage').textContent = meta.message;
    document.getElementById('jumpFooter').textContent = meta.footer;

    let seconds = Number(meta.seconds || 5);
    const countdown = document.getElementById('countdown');
    const skipButton = document.getElementById('skipButton');
    let jumped = false;

    async function resolveAndGo() {
      if (jumped) return;
      jumped = true;
      skipButton.disabled = true;
      skipButton.textContent = '正在进入...';
      const result = await fetchJson(`/api/jump/resolve?id=${encodeURIComponent(id)}`);
      window.location.href = result.url;
    }

    skipButton.addEventListener('click', () => {
      resolveAndGo().catch((error) => {
        console.error(error);
        skipButton.disabled = false;
        skipButton.textContent = '立即进入';
        document.getElementById('jumpMessage').textContent = error.message || '跳转失败';
        jumped = false;
      });
    });

    countdown.textContent = String(seconds);
    const timer = setInterval(() => {
      seconds -= 1;
      countdown.textContent = String(Math.max(seconds, 0));
      if (seconds <= 0) {
        clearInterval(timer);
        resolveAndGo().catch((error) => {
          console.error(error);
          document.getElementById('jumpMessage').textContent = error.message || '跳转失败';
        });
      }
    }, 1000);
  } catch (error) {
    console.error(error);
    document.getElementById('jumpTitle').textContent = '线路不可用';
    document.getElementById('jumpMessage').textContent = error.message || '目标线路不存在或已关闭。';
    document.getElementById('jumpFooter').textContent = '请返回首页选择其他入口';
    document.getElementById('skipButton').style.display = 'none';
  }
}

init();
