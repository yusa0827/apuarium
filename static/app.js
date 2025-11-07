// static/app.js
(() => {
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');

  // レイアウトに応じてキャンバスをリサイズ
  function fit() {
    const ratio = window.devicePixelRatio || 1;
    const rect = cv.getBoundingClientRect();
    const width = rect.width || window.innerWidth;
    const wrap = document.getElementById('wrap');
    const header = wrap?.querySelector('header');
    const footer = wrap?.querySelector('footer');
    const headerHeight = header ? header.getBoundingClientRect().height : 0;
    const footerHeight = footer ? footer.getBoundingClientRect().height : 0;
    const height = Math.max(1, window.innerHeight - headerHeight - footerHeight);

    cv.width = Math.max(1, Math.floor(width * ratio));
    cv.height = Math.max(1, Math.floor(height * ratio));
  }
  window.addEventListener('resize', fit);
  fit();

  // ドット絵金魚のロード
  const fishImg = new Image();
  fishImg.src = '/static/goldfish.png'; // 32x20 くらいのPNGを想定

  // 受信状態
  let fishState = []; // {id, x, y, dir, scale, flip}
  let lastFrame = performance.now();
  let fallbackTimer = null;
  let fallbackActive = false;
  let fallbackFish = [];

  // 簡易泡エフェクト
  const bubbles = [];
  function spawnBubble() {
    bubbles.push({
      x: Math.random() * cv.width,
      y: cv.height + Math.random() * 50,
      r: 2 + Math.random() * 3,
      vy: - (0.3 + Math.random() * 0.7) * (window.devicePixelRatio || 1),
      drift: (Math.random() - 0.5) * 0.3
    });
  }
  setInterval(() => { for (let i = 0; i < 2; i++) spawnBubble(); }, 300);

  function createFallbackFish(count = 8) {
    const fish = [];
    for (let i = 0; i < count; i++) {
      fish.push({
        id: `fallback-${i}`,
        x: Math.random(),
        y: Math.random(),
        dir: Math.random() * Math.PI * 2,
        scale: 0.8 + Math.random() * 0.4,
        flip: 1,
        speed: 0.03 + Math.random() * 0.07,
      });
    }
    return fish;
  }

  function activateFallback() {
    if (!fallbackActive) {
      fallbackActive = true;
      fallbackFish = createFallbackFish();
    }
    fishState = fallbackFish;
  }

  function stopFallback() {
    if (!fallbackActive) return;
    fallbackActive = false;
    fallbackFish = [];
  }

  function updateFallbackFish(dt) {
    if (!fallbackActive) return;
    fallbackFish.forEach(f => {
      f.dir += (Math.random() - 0.5) * 0.8 * dt;
      const vx = Math.cos(f.dir) * f.speed;
      const vy = Math.sin(f.dir) * f.speed;
      f.x += vx * dt;
      f.y += vy * dt;
      let bounced = false;
      if (f.x < 0.02) { f.x = 0.02; f.dir = Math.PI - f.dir; bounced = true; }
      else if (f.x > 0.98) { f.x = 0.98; f.dir = Math.PI - f.dir; bounced = true; }
      if (f.y < 0.05) { f.y = 0.05; f.dir = -f.dir; bounced = true; }
      else if (f.y > 0.95) { f.y = 0.95; f.dir = -f.dir; bounced = true; }
      if (bounced) {
        f.speed = Math.max(0.02, f.speed * 0.9);
      } else if (Math.random() < 0.02) {
        f.speed = Math.min(0.12, f.speed * 1.05);
      }
      f.flip = vx < 0 ? -1 : 1;
    });
  }

  function scheduleFallback(delay = 3000) {
    if (fallbackTimer !== null) {
      window.clearTimeout(fallbackTimer);
    }
    fallbackTimer = window.setTimeout(() => {
      fallbackTimer = null;
      activateFallback();
    }, delay);
  }

  function clearFallbackTimer() {
    if (fallbackTimer === null) return;
    window.clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }

  // 描画ループ（サーバー更新は20Hz、描画はブラウザvsync）
  function render(ts) {
    const w = cv.width;
    const h = cv.height;
    const ratio = window.devicePixelRatio || 1;
    const dt = Math.min(0.05, Math.max(0.001, (ts - lastFrame) / 1000));
    lastFrame = ts;

    if (fallbackActive) {
      updateFallbackFish(dt);
    }

    // 背景（水流：縦グラデ＋さざ波）
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0b3450');
    grad.addColorStop(0.7, '#0b2640');
    grad.addColorStop(1, '#0b1e2b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // さざ波
    ctx.globalAlpha = 0.07;
    ctx.beginPath();
    const amp = 8;
    const k = 2 * Math.PI / 180;
    for (let x = 0; x <= w; x += 6) {
      const y = h * 0.2 + Math.sin((x + ts * 0.05) * k) * amp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#7fd';
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    // 泡更新＋描画
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.y += b.vy;
      b.x += b.drift;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(200,240,255,0.6)';
      ctx.fill();
      if (b.y < -10) bubbles.splice(i, 1);
    }

    // 魚
    if (fishImg.complete && fishImg.naturalWidth > 0) {
      fishState.forEach(f => {
        const px = f.x * w;
        const py = f.y * h;
        const baseW = 32 * f.scale * ratio;
        const baseH = 20 * f.scale * ratio;

        ctx.save();
        ctx.translate(px, py);
        const angle = Math.atan2(Math.sin(f.dir), Math.cos(f.dir)) * 0.15;
        ctx.rotate(angle);
        ctx.scale(f.flip, 1);
        ctx.drawImage(fishImg, -baseW / 2, -baseH / 2, baseW, baseH);
        ctx.restore();
      });
    }

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  // WebSocket接続
  let ws = null;
  activateFallback();
  scheduleFallback();
  try {
    const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
    const host = location.host;
    if (!host) {
      throw new Error('WebSocket host is empty');
    }
    ws = new WebSocket(`${wsProto}://${host}/ws`);
  } catch (err) {
    console.warn('WebSocket を初期化できませんでした。オフラインモードに切り替えます。', err);
  }

  if (ws) {
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'state') {
          const list = Array.isArray(msg.fish) ? msg.fish : [];
          if (list.length > 0) {
            fishState = list;
            stopFallback();
            clearFallbackTimer();
          } else {
            scheduleFallback(1000);
            activateFallback();
          }
        }
      } catch (e) {
        console.warn('受信メッセージの解析に失敗しました', e);
      }
    };
    ws.onopen = () => {
      // 将来：設定変更など送る場合に使用
      try {
        ws.send(JSON.stringify({ type: 'hello' }));
      } catch (e) {
        console.warn('WebSocket 初期メッセージ送信に失敗しました', e);
      }
    };
    ws.onerror = () => {
      scheduleFallback(1000);
      activateFallback();
    };
    ws.onclose = () => {
      scheduleFallback(1000);
      activateFallback();
    };
  }
})();
