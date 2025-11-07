// static/app.js
(() => {
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const threeContainer = document.getElementById('three-container');
  const modeButtons = {
    '2d': document.getElementById('mode-2d'),
    '3d': document.getElementById('mode-3d')
  };

  let currentMode = '2d';
  const hasThree = typeof window.THREE !== 'undefined';
  let threeReady = false;
  let renderer, scene, camera, fishGroup;
  const fishMeshes = new Map();
  const fishDepth = new Map();

  function updateMode(mode) {
    if (mode === '3d' && !hasThree) {
      return;
    }
    if (currentMode === mode) return;
    currentMode = mode;
    Object.entries(modeButtons).forEach(([key, btn]) => {
      if (!btn) return;
      btn.setAttribute('aria-pressed', key === mode ? 'true' : 'false');
    });
    if (mode === '2d') {
      cv.style.display = 'block';
      threeContainer.style.display = 'none';
      threeContainer.setAttribute('aria-hidden', 'true');
    } else {
      cv.style.display = 'none';
      threeContainer.style.display = 'block';
      threeContainer.removeAttribute('aria-hidden');
      if (!threeReady) initThree();
    }
    fit();
  }

  if (!hasThree && modeButtons['3d']) {
    modeButtons['3d'].disabled = true;
    modeButtons['3d'].textContent += '（未対応）';
  }
  if (modeButtons['2d']) {
    modeButtons['2d'].addEventListener('click', () => updateMode('2d'));
  }
  if (modeButtons['3d']) {
    modeButtons['3d'].addEventListener('click', () => updateMode('3d'));
  }

  // レイアウトに応じてキャンバスをリサイズ
  function fit() {
    const ratio = window.devicePixelRatio || 1;
    const holder = cv.parentElement;
    if (!holder) return;
    const rect = holder.getBoundingClientRect();
    if (currentMode === '2d') {
      cv.width  = Math.max(1, Math.floor(rect.width * ratio));
      cv.height = Math.max(1, Math.floor(rect.height * ratio));
    }
    if (threeReady && renderer) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(rect.width, rect.height, false);
      if (camera) {
        const aspect = rect.width > 0 ? rect.width / Math.max(rect.height, 1) : 1;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      }
    }
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
  setInterval(() => { for (let i = 0; i < 2; i++) spawnBubble(); }, 300);

  function createFallbackFish(count = 10) {
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
    if (fallbackActive) return;
    fallbackActive = true;
    fallbackFish = createFallbackFish();
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

  function initThree() {
    if (!hasThree || threeReady) return;
    const { THREE } = window;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x071726, 1);
    threeContainer.appendChild(renderer.domElement);

    scene = new THREE.Scene();

    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.7);
    keyLight.position.set(0.8, 1.2, 0.9);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x88bfff, 0.4);
    fillLight.position.set(-0.9, -0.4, -0.8);
    scene.add(fillLight);

    const rect = threeContainer.getBoundingClientRect();
    const aspect = rect.width > 0 ? rect.width / Math.max(rect.height, 1) : 1;
    camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 10);
    camera.position.set(0, 0.3, 1.5);
    camera.lookAt(0, 0.1, 0);

    fishGroup = new THREE.Group();
    scene.add(fishGroup);

    threeReady = true;
    fit();
  }

  function syncThreeFish() {
    if (!threeReady) return;
    const { THREE } = window;
    const seen = new Set();
    fishState.forEach(f => {
      seen.add(f.id);
      let mesh = fishMeshes.get(f.id);
      if (!mesh) {
        const hue = 0.02 + Math.random() * 0.06;
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color().setHSL(hue, 0.8, 0.6),
          roughness: 0.45,
          metalness: 0.1
        });
        const geometry = new THREE.CapsuleGeometry(0.05, 0.12, 6, 12);
        mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.userData.phase = Math.random() * Math.PI * 2;
        fishGroup.add(mesh);
        fishMeshes.set(f.id, mesh);
        if (!fishDepth.has(f.id)) {
          fishDepth.set(f.id, (Math.random() - 0.5) * 0.7);
        }
      }
      const depth = fishDepth.get(f.id) ?? 0;
      const worldX = (f.x - 0.5) * 1.4;
      const worldY = (0.5 - f.y) * 0.8;
      mesh.userData.targetPos = new THREE.Vector3(worldX, worldY, depth);
      mesh.userData.heading = -f.dir;
      const baseScale = 0.55 * f.scale;
      mesh.userData.scale = baseScale;
      mesh.userData.flip = f.flip;
    });

    fishMeshes.forEach((mesh, id) => {
      if (!seen.has(id)) {
        fishGroup.remove(mesh);
        fishMeshes.delete(id);
      }
    });
  }

  function renderThree(ts, dt) {
    if (!threeReady || !renderer || !scene || !camera) return;
    const { THREE } = window;
    const t = ts / 1000;
    const lerpFactor = Math.min(1, dt * 6);
    fishMeshes.forEach(mesh => {
      const target = mesh.userData.targetPos;
      if (target) {
        mesh.position.lerp(target, lerpFactor);
      }
      const baseScale = mesh.userData.scale || 0.5;
      const sY = THREE.MathUtils.lerp(mesh.scale.y, baseScale, lerpFactor);
      const sX = sY * 0.65;
      const sZ = sY * 0.9;
      mesh.scale.set(sX, sY, sZ);
      const heading = mesh.userData.heading || 0;
      const swim = Math.sin(t * 3 + mesh.userData.phase) * 0.18;
      mesh.rotation.set(
        Math.sin(t * 2.2 + mesh.userData.phase) * 0.08,
        heading + swim,
        Math.sin(t * 1.7 + mesh.userData.phase) * 0.05
      );
    });
    renderer.render(scene, camera);
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

    updateBubbles(dt);
    if (currentMode === '2d') {
      render2D(ts);
    } else {
      renderThree(ts, dt);
    }
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  function render2D(ts) {
    const w = cv.width, h = cv.height;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0b3450');
    grad.addColorStop(0.7, '#0b2640');
    grad.addColorStop(1, '#0b1e2b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.globalAlpha = 0.07;
    ctx.beginPath();
    const amp = 8, k = 2 * Math.PI / 180;
    for (let x=0; x<=w; x+=6) {
      const y = h*0.2 + Math.sin((x + ts*0.05) * k) * amp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    drawBubbles();
    drawFish2D();
  }

  function updateBubbles(dt) {
    for (let i=bubbles.length-1; i>=0; i--) {
      const b = bubbles[i];
      b.y += b.vy;
      b.x += b.drift;
      if (b.y < -10) bubbles.splice(i,1);
    }
  }

  function drawBubbles() {
    for (let i=0; i<bubbles.length; i++) {
      const b = bubbles[i];
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(200,240,255,0.6)';
      ctx.fill();
    }
  }

  function drawFish2D() {
    if (!(fishImg.complete && fishImg.naturalWidth > 0)) return;
    const w = cv.width, h = cv.height;
    const ratio = window.devicePixelRatio || 1;
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
      ctx.drawImage(fishImg, -baseW/2, -baseH/2, baseW, baseH);
      ctx.restore();
    });
  }

  // WebSocket接続
  const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${wsProto}://${location.host}/ws`);
  scheduleFallback();
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'state') {
        fishState = msg.fish || [];
        syncThreeFish();
      }
    } catch (e) {}
  };
  ws.onopen = () => {
    // 将来：設定変更など送る場合に使用
    ws.send(JSON.stringify({type:'hello'}));
  };
  ws.onerror = () => {
    activateFallback();
  };
  ws.onclose = () => {
    activateFallback();
  };
})();
