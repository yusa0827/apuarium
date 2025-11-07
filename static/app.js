// static/app.js
(() => {
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  let deviceRatio = window.devicePixelRatio || 1;
  let backgroundGradient = null;

  // レイアウトに応じてキャンバスをリサイズ
  function fit() {
    const ratio = window.devicePixelRatio || 1;
    deviceRatio = ratio;
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
    backgroundGradient = null;
  }
  window.addEventListener('resize', fit);
  fit();

  // ドット絵金魚のロード
  const fishImg = new Image();
  let fishImageReady = false;
  fishImg.onload = () => { fishImageReady = true; };
  fishImg.onerror = () => { fishImageReady = false; };
  fishImg.src = '/static/goldfish.png'; // 32x20 くらいのPNGを想定

  // 受信状態
  let liveFish = []; // WebSocket 由来の魚データ
  let lastFrame = performance.now();
  let fallbackTimer = null;
  let fallbackActive = false;
  let fallbackFish = [];

  // 簡易泡エフェクト
  const bubbles = [];
  function spawnBubble() {
    const ratio = deviceRatio;
    const depth = Math.random();
    bubbles.push({
      x: Math.random() * cv.width,
      y: cv.height + Math.random() * 50,
      r: 2 + Math.random() * 3,
      vy: - (0.18 + Math.random() * 0.45) * ratio * (0.6 + depth * 0.7),
      drift: (Math.random() - 0.5) * 0.25 * (0.5 + depth),
      z: depth,
    });
    if (bubbles.length > 80) {
      bubbles.splice(0, bubbles.length - 80);
    }
  }
  const bubbleTimer = setInterval(() => {
    if (document.hidden) return;
    spawnBubble();
  }, 420);

  window.addEventListener('beforeunload', () => {
    clearInterval(bubbleTimer);
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      lastFrame = performance.now();
    }
  });

  function createFallbackFish(count = 5) {
    const fish = [];
    for (let i = 0; i < count; i++) {
      fish.push({
        id: `fallback-${i}`,
        x: Math.random(),
        y: Math.random(),
        dir: Math.random() * Math.PI * 2,
        scale: 0.8 + Math.random() * 0.4,
        flip: 1,
        speed: 0.025 + Math.random() * 0.05,
        z: 0.2 + Math.random() * 0.65,
        bob: Math.random() * Math.PI * 2,
      });
    }
    return fish;
  }

  function activateFallback(forceReset = false) {
    if (!fallbackActive || forceReset || fallbackFish.length === 0) {
      fallbackActive = true;
      fallbackFish = createFallbackFish();
      fallbackAccumulator = 0;
    } else {
      fallbackActive = true;
    }
  }

  function stopFallback() {
    if (!fallbackActive) return;
    fallbackActive = false;
    fallbackAccumulator = 0;
  }

  function normalizeAngle(rad) {
    const twoPi = Math.PI * 2;
    let n = rad % twoPi;
    if (n < 0) n += twoPi;
    return n;
  }

  function updateFallbackFish(dt) {
    if (!fallbackActive) return;
    fallbackFish.forEach(f => {
      f.dir = normalizeAngle(f.dir + (Math.random() - 0.5) * 0.5 * dt);
      const vx = Math.cos(f.dir) * f.speed;
      const vy = Math.sin(f.dir) * f.speed;
      f.x += vx * dt;
      f.y += vy * dt;
      let bounced = false;
      if (f.x < 0.02) { f.x = 0.02; f.dir = normalizeAngle(Math.PI - f.dir); bounced = true; }
      else if (f.x > 0.98) { f.x = 0.98; f.dir = normalizeAngle(Math.PI - f.dir); bounced = true; }
      if (f.y < 0.05) { f.y = 0.05; f.dir = normalizeAngle(-f.dir); bounced = true; }
      else if (f.y > 0.95) { f.y = 0.95; f.dir = normalizeAngle(-f.dir); bounced = true; }
      if (bounced) {
        f.speed = Math.max(0.02, f.speed * 0.9);
      } else if (Math.random() < 0.015) {
        f.speed = Math.min(0.09, f.speed * 1.04);
      }
      f.flip = Math.cos(f.dir) >= 0 ? 1 : -1;
      f.bob += dt * 1.2;
      const wobble = Math.sin(f.bob) * 0.08;
      f.z = Math.min(0.95, Math.max(0.18, f.z + wobble * dt));
    });
  }

  function scheduleFallback(delay = 3000) {
    if (fallbackTimer !== null) {
      window.clearTimeout(fallbackTimer);
    }
    fallbackTimer = window.setTimeout(() => {
      fallbackTimer = null;
      activateFallback(true);
    }, delay);
  }

  function clearFallbackTimer() {
    if (fallbackTimer === null) return;
    window.clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }

  let fallbackAccumulator = 0;
  let fpsAccumulator = 0;
  let fpsCounter = 0;
  let lastFps = 0;

  function sanitizeFishList(list, previous = new Map()) {
    const sanitized = [];
    list.forEach((item, idx) => {
      if (!item) return;
      const id = item.id ?? `live-${idx}`;
      const prev = previous.get(id);
      const x = typeof item.x === 'number' ? item.x : (prev?.x ?? 0.5);
      const y = typeof item.y === 'number' ? item.y : (prev?.y ?? 0.5);
      const dirRaw = typeof item.dir === 'number' ? item.dir : 0;
      const dir = normalizeAngle(dirRaw);
      const scale = typeof item.scale === 'number' ? item.scale : 1;
      const hasFlip = typeof item.flip === 'number' && (item.flip === -1 || item.flip === 1);
      const inferredFlip = Math.cos(dir) >= 0 ? 1 : -1;
      const flip = hasFlip ? item.flip : inferredFlip;
      const z = typeof item.z === 'number'
        ? Math.min(1, Math.max(0, item.z))
        : Math.min(1, Math.max(0, prev?.z ?? 0.5));
      const bob = typeof prev?.bob === 'number'
        ? prev.bob
        : Math.random() * Math.PI * 2;
      sanitized.push({
        id,
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
        dir,
        scale: Math.min(1.8, Math.max(0.4, scale)),
        flip,
        z,
        bob,
      });
    });
    return sanitized;
  }

  function ensureBackground() {
    if (backgroundGradient) return;
    backgroundGradient = ctx.createLinearGradient(0, 0, 0, cv.height);
    backgroundGradient.addColorStop(0, '#0b3450');
    backgroundGradient.addColorStop(0.7, '#0b2640');
    backgroundGradient.addColorStop(1, '#0b1e2b');
  }

  function drawBackground(context, ts, w, h, ratio) {
    ensureBackground();
    context.fillStyle = backgroundGradient;
    context.fillRect(0, 0, w, h);

    // 奥行きのある霞
    const fogGradient = context.createLinearGradient(0, 0, 0, h);
    fogGradient.addColorStop(0, 'rgba(24,70,110,0.25)');
    fogGradient.addColorStop(0.5, 'rgba(12,40,70,0.12)');
    fogGradient.addColorStop(1, 'rgba(6,20,35,0.4)');
    context.fillStyle = fogGradient;
    context.fillRect(0, 0, w, h);

    // 水面からの光条
    context.save();
    context.globalCompositeOperation = 'lighter';
    const beamCount = 5;
    for (let i = 0; i < beamCount; i++) {
      const phase = (ts * 0.00015 + i * 0.2) % 1;
      const beamWidth = w * (0.08 + 0.06 * Math.sin(ts * 0.0005 + i));
      const x = ((i / beamCount) + phase) % 1 * w;
      const gradient = context.createLinearGradient(x - beamWidth, 0, x + beamWidth, h * 0.85);
      gradient.addColorStop(0, 'rgba(120,200,255,0)');
      gradient.addColorStop(0.5, 'rgba(120,200,255,0.12)');
      gradient.addColorStop(1, 'rgba(120,200,255,0)');
      context.fillStyle = gradient;
      context.fillRect(x - beamWidth, 0, beamWidth * 2, h);
    }
    context.restore();

    // 浮遊する粒子
    context.save();
    context.globalAlpha = 0.28;
    context.fillStyle = 'rgba(180,220,255,0.35)';
    const particleCount = Math.max(12, Math.floor((w * h) / 48000));
    for (let i = 0; i < particleCount; i++) {
      const px = (i * 97 + Math.sin(ts * 0.0006 + i) * 130) % w;
      const py = (i * 37 + Math.cos(ts * 0.0003 + i) * 90 + h) % h;
      const pr = 0.5 * ratio + Math.abs(Math.sin(ts * 0.001 + i)) * ratio;
      context.beginPath();
      context.arc(px, py, pr, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();

    // さざ波の層
    context.save();
    context.globalAlpha = 0.12;
    context.lineWidth = 1.5 * ratio;
    const amp = 14 * ratio;
    const k = 2 * Math.PI / 220;
    for (let layer = 0; layer < 3; layer++) {
      context.beginPath();
      for (let x = -20; x <= w + 20; x += 6) {
        const wave = Math.sin((x + ts * (0.04 + layer * 0.01)) * k + layer) * amp;
        const y = h * (0.18 + layer * 0.06) + wave;
        if (x === -20) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.strokeStyle = `rgba(${120 + layer * 30}, ${210 - layer * 30}, 255, ${0.45 - layer * 0.12})`;
      context.stroke();
    }
    context.restore();
  }

  function renderFishSchool(context, fishList, params) {
    const { w, h, ratio, fishImg, fishImageReady, time } = params;
    if (fishList.length === 0) return;

    fishList.forEach(f => {
      const px = f.x * w;
      const depth = f.z ?? 0.5;
      const py = f.y * h * (0.85 + depth * 0.15);
      const perspective = 0.65 + (1 - depth) * 0.55;
      const baseW = 32 * f.scale * ratio * perspective;
      const baseH = 20 * f.scale * ratio * perspective;

      const animSeed = f.bob ?? 0;
      const lift = Math.sin(time * 1.4 + animSeed) * 4 * (1 - depth);
      const sway = Math.sin(time * 2 + animSeed * 1.5) * 0.12;

      context.save();
      context.translate(px, py + lift);
      context.rotate(Math.atan2(Math.sin(f.dir), Math.cos(f.dir)) * 0.2 + sway * 0.3);

      // 影
      context.save();
      context.scale(1, 0.5);
      context.globalAlpha = 0.22 * (0.4 + depth * 0.6);
      context.fillStyle = '#05121f';
      context.beginPath();
      context.ellipse(0, baseH * 0.55, baseW * 0.65, baseH * 0.35, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();

      context.scale(f.flip, 1);

      if (fishImageReady) {
        context.drawImage(fishImg, -baseW / 2, -baseH / 2, baseW, baseH);
      } else {
        context.fillStyle = 'rgba(255,160,90,0.92)';
        context.strokeStyle = 'rgba(255,210,160,0.6)';
        context.lineWidth = 0.8 * ratio;
        context.beginPath();
        context.ellipse(0, 0, baseW * 0.52, baseH * 0.32, 0, 0, Math.PI * 2);
        context.fill();
        context.beginPath();
        context.moveTo(baseW * -0.05, 0);
        context.lineTo(baseW * 0.6, baseH * 0.35);
        context.lineTo(baseW * 0.6, -baseH * 0.35);
        context.closePath();
        context.fill();
        context.stroke();
      }

      // 側面の陰影
      const sheen = context.createLinearGradient(-baseW * 0.5, 0, baseW * 0.5, 0);
      sheen.addColorStop(0, 'rgba(255,180,120,0.0)');
      sheen.addColorStop(0.5, 'rgba(255,240,220,0.18)');
      sheen.addColorStop(1, 'rgba(220,80,40,0.0)');
      context.globalCompositeOperation = 'lighter';
      context.fillStyle = sheen;
      context.globalAlpha = 0.8;
      context.fillRect(-baseW / 2, -baseH / 2, baseW, baseH);

      // 背ビレへの陰影
      const dorsal = context.createLinearGradient(0, -baseH / 2, 0, baseH / 2);
      dorsal.addColorStop(0, 'rgba(255,255,255,0.25)');
      dorsal.addColorStop(1, 'rgba(255,120,70,0.0)');
      context.fillStyle = dorsal;
      context.globalAlpha = 0.6;
      context.fillRect(-baseW * 0.2, -baseH * 0.5, baseW * 0.4, baseH * 0.4);

      context.globalCompositeOperation = 'source-over';
      context.globalAlpha = 1;

      context.restore();
    });
  }

  // 描画ループ（サーバー更新は20Hz、描画はブラウザvsync）
  function render(ts) {
    const w = cv.width;
    const h = cv.height;
    const ratio = deviceRatio;
    const dt = Math.min(0.05, Math.max(0.001, (ts - lastFrame) / 1000));
    lastFrame = ts;

    if (document.hidden) {
      requestAnimationFrame(render);
      return;
    }

    fallbackAccumulator += dt;
    if (fallbackActive) {
      const step = 1 / 45;
      while (fallbackAccumulator >= step) {
        updateFallbackFish(step);
        fallbackAccumulator -= step;
      }
    } else {
      fallbackAccumulator = 0;
    }

    drawBackground(ctx, ts, w, h, ratio);

    // 泡更新＋描画
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.y += b.vy;
      b.x += b.drift;
      ctx.beginPath();
      const bubbleScale = 0.7 + (1 - (b.z ?? 0.4)) * 0.6;
      const bubbleRadius = b.r * bubbleScale;
      const gradient = ctx.createRadialGradient(b.x - bubbleRadius * 0.2, b.y - bubbleRadius * 0.25, bubbleRadius * 0.2, b.x, b.y, bubbleRadius);
      gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
      gradient.addColorStop(0.4, 'rgba(210,245,255,0.55)');
      gradient.addColorStop(1, 'rgba(80,140,200,0.1)');
      ctx.fillStyle = gradient;
      ctx.arc(b.x, b.y, bubbleRadius, 0, Math.PI * 2);
      ctx.fill();
      if (b.y < -10) bubbles.splice(i, 1);
    }

    const activeFishRaw = fallbackActive && fallbackFish.length > 0
      ? fallbackFish
      : (liveFish.length > 0 ? liveFish : fallbackFish);
    const activeFish = [...activeFishRaw];
    activeFish.sort((a, b) => (a.z ?? 0.5) - (b.z ?? 0.5));

    if (!fallbackActive && liveFish.length === 0 && fallbackFish.length === 0) {
      activateFallback(true);
    }

    renderFishSchool(ctx, activeFish, {
      w,
      h,
      ratio,
      fishImg,
      fishImageReady,
      time: ts / 1000,
    });

    fpsAccumulator += dt;
    fpsCounter += 1;
    if (fpsAccumulator >= 0.5) {
      lastFps = Math.round((fpsCounter / fpsAccumulator) * 10) / 10;
      fpsAccumulator = 0;
      fpsCounter = 0;
    }

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(10 * ratio, 10 * ratio, 150 * ratio, 44 * ratio);
    ctx.fillStyle = '#cde';
    ctx.font = `${12 * ratio}px system-ui`;
    ctx.textBaseline = 'top';
    ctx.fillText(`FPS: ${lastFps}`, 18 * ratio, 16 * ratio);
    const modeLabel = fallbackActive
      ? 'Fallback'
      : (liveFish.length > 0 ? 'Live' : 'Idle');
    ctx.fillText(`Mode: ${modeLabel}`, 18 * ratio, 32 * ratio);

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  // WebSocket接続
  let ws = null;
  activateFallback(true);
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
            const previousMap = new Map(liveFish.map(f => [f.id, f]));
            liveFish = sanitizeFishList(list, previousMap);
            liveFish.forEach(f => {
              if (typeof f.z !== 'number') {
                f.z = 0.5;
              }
            });
            stopFallback();
            clearFallbackTimer();
          } else {
            liveFish = [];
            scheduleFallback(1000);
            activateFallback(true);
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
      liveFish = [];
      scheduleFallback(1000);
      activateFallback(true);
    };
    ws.onclose = () => {
      liveFish = [];
      scheduleFallback(1000);
      activateFallback(true);
    };
  }
})();
