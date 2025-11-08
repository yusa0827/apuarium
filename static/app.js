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
    fishActors.set(id, actor);
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
    ctx.strokeStyle = '#7fd';
    ctx.stroke();
    ctx.globalAlpha = 1.0;

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
