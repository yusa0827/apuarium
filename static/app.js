// static/app.js
(() => {
  const canvas = document.getElementById('cv');
  if (!canvas) return;

  if (typeof window.THREE === 'undefined') {
    const warning = document.createElement('div');
    warning.style.padding = '18px';
    warning.style.color = '#fdd';
    warning.style.fontSize = '16px';
    warning.textContent = 'Three.js を読み込めませんでした。インターネット接続を確認してください。';
    canvas.replaceWith(warning);
    return;
  }

  const THREE = window.THREE;

  const world = {
    width: 4.6,
    height: 1.8,
    depth: 2.8,
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x031624);
  scene.fog = new THREE.FogExp2(0x041f33, 0.22);

  const volumetricPlanes = [];
  const floatingLayers = [];

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setAnimationLoop(animationLoop);
  if ('outputColorSpace' in renderer) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } else if ('outputEncoding' in renderer) {
    renderer.outputEncoding = THREE.sRGBEncoding;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;

  const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 40);
  camera.position.set(0.0, 0.52, 3.9);
  const cameraTarget = new THREE.Vector3(0, 0.2, 0);
  camera.lookAt(cameraTarget);

  function resize() {
    const rect = canvas.parentElement?.getBoundingClientRect();
    const width = rect ? rect.width : window.innerWidth;
    const header = document.querySelector('header');
    const footer = document.querySelector('footer');
    const headerHeight = header ? header.getBoundingClientRect().height : 0;
    const footerHeight = footer ? footer.getBoundingClientRect().height : 0;
    const height = Math.max(1, (rect ? rect.height : window.innerHeight) - headerHeight - footerHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // Lighting ---------------------------------------------------------------
  const hemiLight = new THREE.HemisphereLight(0x9bd8ff, 0x13263d, 0.7);
  hemiLight.position.set(0, 1, 0);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xfff4c7, 1.35);
  keyLight.position.set(-1.8, 1.5, 1.0);
  keyLight.target.position.set(0, 0.15, 0);
  scene.add(keyLight);
  scene.add(keyLight.target);

  const rimLight = new THREE.DirectionalLight(0x5fc9ff, 0.55);
  rimLight.position.set(1.2, 0.8, -1.4);
  scene.add(rimLight);

  const causticLight = new THREE.PointLight(0x4dc0ff, 0.35, 0, 2);
  causticLight.position.set(0.6, 1.5, 0.2);
  scene.add(causticLight);

  // Environment -----------------------------------------------------------
  let waterSurface = null;
  createSeabed();
  createBackgroundParticles();
  createVolumetricLayers();
  createKelpClusters();
  waterSurface = createWaterSurface();

  // Fish management -------------------------------------------------------
  const fishActors = new Map();
  const liveStates = new Map();
  const fallbackSchool = createFallbackSchool(12);

  let lastLiveMessage = 0;
  let lastFrameTime = performance.now();

  let ws = null;
  let reconnectTimer = null;

  connectWebSocket();

  // Animation loop --------------------------------------------------------
  function animationLoop() {
    const now = performance.now();
    const dt = Math.min(0.06, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    fishActors.forEach((actor) => actor.beginFrame());

    const useFallback = now - lastLiveMessage > 3200;
    if (useFallback) {
      updateFallbackSchool(fallbackSchool, dt, now);
      for (const fishState of fallbackSchool) {
        const actor = ensureActor(fishState.id, 'fallback');
        actor.ingestFallback(buildFallbackIntent(fishState, now));
      }
    } else {
      const intents = buildLiveIntents(now);
      if (intents.length === 0) {
        updateFallbackSchool(fallbackSchool, dt, now);
        for (const fishState of fallbackSchool) {
          const actor = ensureActor(fishState.id, 'fallback');
          actor.ingestFallback(buildFallbackIntent(fishState, now));
        }
      } else {
        for (const intent of intents) {
          const actor = ensureActor(intent.id, 'live');
          actor.ingestLive(intent);
        }
      }
    }

    floatingLayers.forEach((layer) => {
      const positions = layer.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i += 1) {
        let y = positions.getY(i) + dt * layer.speed;
        if (y > layer.bounds.max) y = layer.bounds.min;
        positions.setY(i, y);
      }
      positions.needsUpdate = true;
      layer.points.rotation.y += dt * 0.05;
    });

    const time = now * 0.001;
    volumetricPlanes.forEach((layer, idx) => {
      layer.mesh.position.z = layer.baseZ + Math.sin(time * layer.speed + layer.offset) * 0.18;
      layer.mesh.material.opacity = 0.32 + Math.sin(time * 0.37 + idx) * 0.08;
    });

    if (waterSurface) {
      updateWaterSurface(waterSurface, time);
    }

    fishActors.forEach((actor, id) => {
      actor.update(dt, now);
      if (actor.shouldDispose()) {
        scene.remove(actor.group);
        actor.dispose();
        fishActors.delete(id);
      }
    });

    renderer.render(scene, camera);
  }

  function connectWebSocket() {
    clearTimeout(reconnectTimer);
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    try {
      ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
    } catch (err) {
      scheduleReconnect();
      return;
    }

    ws.addEventListener('open', () => {
      lastLiveMessage = performance.now();
    });

    ws.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload && payload.type === 'state' && Array.isArray(payload.fish)) {
          ingestLivePayload(payload.fish);
          lastLiveMessage = performance.now();
        }
      } catch (err) {
        console.warn('WebSocket parse error', err);
      }
    });

    ws.addEventListener('close', () => {
      scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    lastLiveMessage = performance.now() - 10000;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectWebSocket();
    }, 2500);
  }

  function ensureActor(id, initialMode) {
    if (!fishActors.has(id)) {
      const actor = new GoldfishActor(id, initialMode);
      scene.add(actor.group);
      fishActors.set(id, actor);
    }
    return fishActors.get(id);
  }

  function buildLiveIntents(now) {
    const intents = [];
    liveStates.forEach((record, id) => {
      if (now - record.lastSeen > 4000) return;
      const baseHeight = mix(record.baseHeight, (0.5 - record.y) * world.height, 0.65);
      const bob = Math.sin(now * 0.0015 + record.phase) * 0.06;
      const depthDrift = Math.sin(now * 0.0011 + record.phase * 2) * 0.22;
      const position = new THREE.Vector3(
        (record.x - 0.5) * world.width,
        baseHeight + bob,
        record.baseDepth + depthDrift + (record.y - 0.5) * 0.25,
      );
      const dirVec = new THREE.Vector3(Math.cos(record.dir), -Math.sin(record.dir) * 0.45, Math.sin(record.dir));
      if (dirVec.lengthSq() < 1e-6) dirVec.set(1, 0, 0);
      dirVec.normalize();
      const yaw = Math.atan2(dirVec.z, dirVec.x);
      const pitch = Math.asin(clamp(dirVec.y, -0.95, 0.95));
      const roll = -Math.sin(now * 0.0023 + record.phase) * 0.28 + dirVec.y * 0.35;
      const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'XYZ'));
      const scale = 0.62 + record.scale * 0.55;
      const swimRate = 2.8 + record.speed * 12 + record.speedBias;
      intents.push({ id, position, quaternion, scale, swimRate, mode: 'live' });
    });
    return intents;
  }

  function buildFallbackIntent(state, now) {
    const position = state.position.clone();
    position.y += Math.sin(now * 0.001 + state.phase) * 0.05;
    const dir = state.velocity.clone();
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    dir.normalize();
    const yaw = Math.atan2(dir.z, dir.x);
    const pitch = Math.asin(clamp(dir.y, -0.95, 0.95));
    const roll = Math.sin(now * 0.0017 + state.phase) * 0.24 + -dir.y * 0.32;
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'XYZ'));
    const swimRate = 2.4 + state.speed * 1.6;
    const scale = 0.6 + state.sizeBias * 0.45;
    return { id: state.id, position, quaternion, scale, swimRate, mode: 'fallback' };
  }

  function mix(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function damp(current, target, lambda, dt) {
    return mix(current, target, 1 - Math.exp(-lambda * dt));
  }

  function hashToUnit(str, offset = 0) {
    let h = 2166136261 ^ offset;
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967295;
  }

  function ingestLivePayload(fishArray) {
    const now = performance.now();
    const seen = new Set();
    fishArray.forEach((fish) => {
      const id = `live-${fish.id}`;
      let record = liveStates.get(id);
      if (!record) {
        record = {
          id,
          baseDepth: (hashToUnit(id, 31) - 0.5) * world.depth * 0.8,
          baseHeight: (hashToUnit(id, 32) - 0.3) * world.height * 0.7,
          phase: hashToUnit(id, 33) * Math.PI * 2,
          speedBias: hashToUnit(id, 34) * 0.8,
          prevX: fish.x,
          prevY: fish.y,
          speed: 0.05,
        };
        liveStates.set(id, record);
      }
      const dt = (now - (record.lastSeen || now)) / 1000;
      const dx = fish.x - (record.prevX ?? fish.x);
      const dy = fish.y - (record.prevY ?? fish.y);
      if (dt > 1e-3) {
        const newSpeed = Math.hypot(dx, dy) / dt;
        record.speed = clamp(mix(record.speed, newSpeed, 0.3), 0, 1.4);
      }
      record.prevX = fish.x;
      record.prevY = fish.y;
      record.x = fish.x;
      record.y = fish.y;
      record.dir = fish.dir;
      record.scale = fish.scale ?? 1;
      record.lastSeen = now;
      seen.add(id);
    });

    liveStates.forEach((record, id) => {
      if (!seen.has(id) && now - record.lastSeen > 4000) {
        liveStates.delete(id);
      }
    });
  }

  // Goldfish actor --------------------------------------------------------
  class GoldfishActor {
    constructor(id, initialMode) {
      this.id = id;
      this.mode = initialMode;
      this.group = new THREE.Group();
      this.group.visible = false;
      this.waveOffset = hashToUnit(id, 5) * Math.PI * 2;
      this.speedBias = hashToUnit(id, 6) * 0.7;
      this.presence = 0;
      this.frameActive = false;

      this.position = new THREE.Vector3();
      this.targetPosition = new THREE.Vector3();
      this.quaternion = new THREE.Quaternion();
      this.targetQuaternion = new THREE.Quaternion();
      this.scale = 1;
      this.targetScale = 1;
      this.swimRate = 2.6;

      this.buildMeshes();
    }

    buildMeshes() {
      const baseHue = 0.05 + hashToUnit(this.id, 7) * 0.05;
      const bodyTexture = createBodyTexture(baseHue);
      const bodyColor = new THREE.Color().setHSL(baseHue, 0.78, 0.56);
      const bodyMaterial = new THREE.MeshPhysicalMaterial({
        color: bodyColor,
        map: bodyTexture,
        roughness: 0.32,
        metalness: 0.08,
        sheen: 0.7,
        sheenRoughness: 0.3,
        clearcoat: 0.92,
        clearcoatRoughness: 0.18,
        envMapIntensity: 0.7,
        transmission: 0.07,
        thickness: 0.32,
        iridescence: 0.28,
        iridescenceIOR: 1.25,
        iridescenceThicknessRange: [180, 320],
      });
      const bodyGeometry = new THREE.CapsuleGeometry(0.32, 0.24, 18, 32);
      bodyGeometry.rotateZ(Math.PI / 2);
      const bodyAttr = bodyGeometry.getAttribute('position');
      const bodyArr = bodyAttr.array;
      for (let i = 0; i < bodyAttr.count; i += 1) {
        const x = bodyArr[i * 3 + 0];
        const y = bodyArr[i * 3 + 1];
        const z = bodyArr[i * 3 + 2];
        const belly = Math.exp(-Math.pow((x + 0.08) / 0.42, 2)) * 0.08;
        const taper = 1 - clamp((x + 0.34) / 0.7, 0, 1);
        bodyArr[i * 3 + 0] = x;
        bodyArr[i * 3 + 1] = y + belly * (1 - Math.abs(z) * 1.4);
        bodyArr[i * 3 + 2] = z * (0.72 + taper * 0.15);
      }
      bodyAttr.needsUpdate = true;
      bodyGeometry.computeVertexNormals();
      this.body = new THREE.Mesh(bodyGeometry, bodyMaterial);
      this.body.scale.set(1.02, 0.86, 0.95);
      this.group.add(this.body);

      const bellyMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xfff4d6,
        transparent: true,
        opacity: 0.45,
        roughness: 0.6,
        transmission: 0.24,
        thickness: 0.18,
        depthWrite: false,
      });
      const bellyGeometry = new THREE.SphereGeometry(0.26, 24, 18, 0, Math.PI * 2, 0, Math.PI / 1.6);
      bellyGeometry.rotateZ(Math.PI / 2);
      this.belly = new THREE.Mesh(bellyGeometry, bellyMaterial);
      this.belly.scale.set(0.78, 0.62, 0.66);
      this.belly.position.set(0.08, -0.05, 0);
      this.group.add(this.belly);

      const glowMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color(bodyColor).multiplyScalar(1.6),
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.bodyGlow = new THREE.Mesh(new THREE.SphereGeometry(0.46, 20, 16, 0, Math.PI * 1.5, 0, Math.PI / 1.4), glowMaterial);
      this.bodyGlow.scale.set(0.6, 0.42, 0.55);
      this.bodyGlow.position.set(0.04, 0.02, 0);
      this.group.add(this.bodyGlow);

      const tailMaterial = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0xffc89c).lerp(bodyColor, 0.3),
        transparent: true,
        opacity: 0.82,
        side: THREE.DoubleSide,
        roughness: 0.42,
        metalness: 0.02,
        transmission: 0.62,
        thickness: 0.28,
        depthWrite: false,
        envMapIntensity: 0.5,
      });
      this.tailMaterial = tailMaterial;

      this.tailPivot = new THREE.Group();
      this.tailPivot.position.set(-0.26, 0.01, 0);

      const tailGeometry = new THREE.PlaneGeometry(0.72, 0.46, 24, 10);
      tailGeometry.translate(-0.36, 0, 0);
      const tailAttribute = tailGeometry.getAttribute('position');
      this.tailBase = tailAttribute.array.slice();
      this.tailLength = 0.72;
      this.tailMesh = new THREE.Mesh(tailGeometry, tailMaterial);
      this.tailGeometry = tailGeometry;
      this.tailAttribute = tailAttribute;
      this.tailPivot.add(this.tailMesh);

      const tailSecondaryGeometry = new THREE.PlaneGeometry(0.56, 0.36, 18, 8);
      tailSecondaryGeometry.translate(-0.28, 0, 0);
      const tailSecondaryAttribute = tailSecondaryGeometry.getAttribute('position');
      this.tailSecondaryBase = tailSecondaryAttribute.array.slice();
      this.tailSecondaryLength = 0.56;
      this.tailSecondaryMesh = new THREE.Mesh(tailSecondaryGeometry, tailMaterial);
      this.tailSecondaryMesh.position.set(-0.05, 0, 0);
      this.tailSecondaryGeometry = tailSecondaryGeometry;
      this.tailSecondaryAttribute = tailSecondaryAttribute;
      this.tailPivot.add(this.tailSecondaryMesh);

      this.group.add(this.tailPivot);

      const finMaterial = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0xffd9b0).lerp(bodyColor, 0.18),
        transparent: true,
        opacity: 0.76,
        side: THREE.DoubleSide,
        roughness: 0.5,
        metalness: 0.02,
        transmission: 0.64,
        thickness: 0.22,
        depthWrite: false,
        envMapIntensity: 0.4,
      });
      this.finMaterial = finMaterial;

      const dorsalGeometry = new THREE.PlaneGeometry(0.46, 0.32, 8, 6);
      dorsalGeometry.rotateX(Math.PI / 2.3);
      const dorsalAttr = dorsalGeometry.getAttribute('position');
      this.dorsalBase = dorsalAttr.array.slice();
      this.dorsalGeometry = dorsalGeometry;
      this.dorsalAttribute = dorsalAttr;
      this.dorsal = new THREE.Mesh(dorsalGeometry, finMaterial);
      this.dorsal.position.set(-0.02, 0.16, 0);
      this.group.add(this.dorsal);

      const pectoralGeometryL = new THREE.PlaneGeometry(0.32, 0.22, 6, 5);
      pectoralGeometryL.translate(0.16, 0, 0);
      const pectoralAttrL = pectoralGeometryL.getAttribute('position');
      this.pectoralBaseL = pectoralAttrL.array.slice();
      this.pectoralGeometryL = pectoralGeometryL;
      this.pectoralAttributeL = pectoralAttrL;
      this.pectoralL = new THREE.Mesh(pectoralGeometryL, finMaterial);
      this.pectoralL.position.set(0.12, -0.02, 0.15);
      this.pectoralL.rotation.set(Math.PI / 3.2, 0, Math.PI / 6);
      this.group.add(this.pectoralL);

      const pectoralGeometryR = new THREE.PlaneGeometry(0.32, 0.22, 6, 5);
      pectoralGeometryR.translate(0.16, 0, 0);
      const pectoralAttrR = pectoralGeometryR.getAttribute('position');
      this.pectoralBaseR = pectoralAttrR.array.slice();
      this.pectoralGeometryR = pectoralGeometryR;
      this.pectoralAttributeR = pectoralAttrR;
      this.pectoralR = new THREE.Mesh(pectoralGeometryR, finMaterial);
      this.pectoralR.position.set(0.12, -0.02, -0.15);
      this.pectoralR.rotation.set(Math.PI / 3.2, 0, -Math.PI / 6);
      this.group.add(this.pectoralR);

      const pelvicGeometry = new THREE.PlaneGeometry(0.26, 0.2, 5, 4);
      pelvicGeometry.translate(0.08, 0, 0);
      const pelvicAttr = pelvicGeometry.getAttribute('position');
      this.pelvicBase = pelvicAttr.array.slice();
      this.pelvicGeometry = pelvicGeometry;
      this.pelvicAttribute = pelvicAttr;
      this.pelvic = new THREE.Mesh(pelvicGeometry, finMaterial);
      this.pelvic.position.set(-0.02, -0.16, 0);
      this.pelvic.rotation.set(Math.PI / 1.7, 0, 0);
      this.group.add(this.pelvic);

      const gillMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color(bodyColor).multiplyScalar(0.6),
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      });
      const gillGeometry = new THREE.PlaneGeometry(0.2, 0.26);
      this.gillL = new THREE.Mesh(gillGeometry, gillMaterial);
      this.gillL.position.set(-0.02, -0.02, 0.16);
      this.gillL.rotation.y = Math.PI / 2.3;
      this.group.add(this.gillL);
      this.gillR = this.gillL.clone();
      this.gillR.position.z = -this.gillL.position.z;
      this.gillR.rotation.y = -Math.PI / 2.3;
      this.group.add(this.gillR);

      const eyeGeometry = new THREE.SphereGeometry(0.048, 18, 14);
      const eyeMaterial = new THREE.MeshStandardMaterial({
        color: 0x050505,
        roughness: 0.25,
        metalness: 0.6,
        envMapIntensity: 1.4,
      });
      this.eyeL = new THREE.Mesh(eyeGeometry, eyeMaterial);
      this.eyeL.position.set(0.12, 0.04, 0.14);
      this.group.add(this.eyeL);
      this.eyeR = this.eyeL.clone();
      this.eyeR.position.z = -this.eyeL.position.z;
      this.group.add(this.eyeR);

      const eyeHighlightMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const eyeHighlightGeometry = new THREE.CircleGeometry(0.022, 12);
      const highlightL = new THREE.Mesh(eyeHighlightGeometry, eyeHighlightMaterial);
      highlightL.position.set(0.155, 0.055, 0.152);
      highlightL.rotation.y = Math.PI / 6;
      const highlightR = highlightL.clone();
      highlightR.position.z = -highlightL.position.z;
      highlightR.rotation.y = -Math.PI / 6;
      this.group.add(highlightL);
      this.group.add(highlightR);
      this.eyeHighlights = [highlightL, highlightR];

      this.shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(0.96, 0.42),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.15, depthWrite: false }),
      );
      this.shadow.rotation.x = -Math.PI / 2;
      this.shadow.position.set(0, -0.36, 0);
      this.group.add(this.shadow);
    }

    beginFrame() {
      this.frameActive = false;
    }

    ingestLive(intent) {
      this.mode = 'live';
      this.frameActive = true;
      this.targetPosition.copy(intent.position);
      this.targetQuaternion.copy(intent.quaternion);
      this.targetScale = intent.scale;
      this.swimRate = intent.swimRate + this.speedBias;
    }

    ingestFallback(intent) {
      this.mode = 'fallback';
      this.frameActive = true;
      this.targetPosition.copy(intent.position);
      this.targetQuaternion.copy(intent.quaternion);
      this.targetScale = intent.scale;
      this.swimRate = intent.swimRate + this.speedBias * 0.5;
    }

    update(dt, now) {
      const posT = 1 - Math.exp(-6 * dt);
      this.position.lerp(this.targetPosition, posT);
      this.group.position.copy(this.position);

      const rotT = 1 - Math.exp(-5 * dt);
      this.quaternion.slerp(this.targetQuaternion, rotT);
      this.group.quaternion.copy(this.quaternion);

      this.scale = damp(this.scale, this.targetScale, 4, dt);
      this.group.scale.setScalar(this.scale);

      const presenceTarget = this.frameActive ? 1 : 0;
      this.presence = damp(this.presence, presenceTarget, 3.5, dt);
      if (this.presence < 0.02) {
        this.group.visible = false;
        return;
      }
      this.group.visible = true;

      const time = now * 0.001;
      const tailWave = Math.sin(time * this.swimRate + this.waveOffset) * this.presence;
      this.tailPivot.rotation.y = tailWave * 0.35;
      this.tailPivot.rotation.x = Math.sin(time * (this.swimRate * 0.6) + this.waveOffset * 0.5) * 0.08 * this.presence;
      this.deformTail(this.tailAttribute, this.tailBase, this.tailLength, time, this.swimRate * 1.45, 0.26);
      this.deformTail(this.tailSecondaryAttribute, this.tailSecondaryBase, this.tailSecondaryLength, time, this.swimRate * 1.7, 0.2);
      this.tailGeometry.computeVertexNormals();
      this.tailSecondaryGeometry.computeVertexNormals();

      const finWave = Math.sin(time * (this.swimRate * 1.2) + this.waveOffset);
      const finFold = Math.cos(time * (this.swimRate * 0.7) + this.waveOffset * 0.8) * 0.35;
      this.pectoralL.rotation.z = Math.PI / 6 + finFold * 0.45;
      this.pectoralR.rotation.z = -Math.PI / 6 - finFold * 0.45;
      this.deformFin(this.pectoralAttributeL, this.pectoralBaseL, finWave, 0.18);
      this.deformFin(this.pectoralAttributeR, this.pectoralBaseR, -finWave, 0.18);
      this.pectoralGeometryL.computeVertexNormals();
      this.pectoralGeometryR.computeVertexNormals();

      const dorsalWave = Math.sin(time * (this.swimRate * 0.9) + this.waveOffset * 0.5);
      this.deformVerticalFin(this.dorsalAttribute, this.dorsalBase, dorsalWave, 0.12);
      this.dorsalGeometry.computeVertexNormals();

      const pelvicWave = Math.sin(time * (this.swimRate * 1.05) + this.waveOffset * 0.6);
      this.deformFin(this.pelvicAttribute, this.pelvicBase, pelvicWave, 0.14);
      this.pelvicGeometry.computeVertexNormals();

      this.tailMaterial.opacity = 0.32 + 0.5 * this.presence;
      this.tailMaterial.thickness = 0.22 + 0.12 * this.presence;
      this.finMaterial.opacity = 0.34 + 0.42 * this.presence;
      this.bodyGlow.material.opacity = 0.12 + 0.18 * this.presence;
      this.belly.material.opacity = 0.22 + 0.24 * this.presence;
      this.gillL.material.opacity = 0.2 + 0.15 * this.presence;
      this.gillR.material.opacity = 0.2 + 0.15 * this.presence;
      this.shadow.material.opacity = 0.12 + 0.22 * this.presence;
      this.shadow.scale.set(0.88 + this.presence * 0.18, 1, 0.88 + this.presence * 0.18);
      this.eyeHighlights.forEach((mesh) => {
        mesh.lookAt(camera.position);
      });
    }

    deformTail(attribute, base, length, time, speed, amplitude) {
      const arr = attribute.array;
      for (let i = 0; i < attribute.count; i += 1) {
        const baseX = base[i * 3 + 0];
        const baseY = base[i * 3 + 1];
        const baseZ = base[i * 3 + 2];
        const along = clamp((-baseX) / length, 0, 1);
        const wave = Math.sin(time * speed + along * 3.6 + this.waveOffset) * amplitude * Math.pow(along, 1.1) * this.presence;
        const lift = Math.sin(time * speed * 0.5 + along * 4.4 + this.waveOffset * 0.7) * amplitude * 0.32 * Math.pow(along, 1.4) * this.presence;
        arr[i * 3 + 0] = baseX;
        arr[i * 3 + 1] = baseY + lift;
        arr[i * 3 + 2] = baseZ + wave;
      }
      attribute.needsUpdate = true;
    }

    deformFin(attribute, base, wave, amplitude) {
      const arr = attribute.array;
      for (let i = 0; i < attribute.count; i += 1) {
        const baseX = base[i * 3 + 0];
        const baseY = base[i * 3 + 1];
        const baseZ = base[i * 3 + 2];
        const span = clamp((baseX + Math.abs(baseX)) / (Math.abs(baseX) + 1e-6), 0, 1);
        const weight = Math.pow(clamp((baseX + 0.18) / 0.36, 0, 1), 1.1);
        const offset = wave * amplitude * weight * this.presence;
        arr[i * 3 + 0] = baseX;
        arr[i * 3 + 1] = baseY + offset * 0.35;
        arr[i * 3 + 2] = baseZ + offset * (0.8 + span * 0.2);
      }
      attribute.needsUpdate = true;
    }

    deformVerticalFin(attribute, base, wave, amplitude) {
      const arr = attribute.array;
      for (let i = 0; i < attribute.count; i += 1) {
        const baseX = base[i * 3 + 0];
        const baseY = base[i * 3 + 1];
        const baseZ = base[i * 3 + 2];
        const weight = clamp((baseY + 0.18) / 0.36, 0, 1);
        const offset = wave * amplitude * weight * this.presence;
        arr[i * 3 + 0] = baseX + offset * 0.2;
        arr[i * 3 + 1] = baseY;
        arr[i * 3 + 2] = baseZ + offset;
      }
      attribute.needsUpdate = true;
    }

    shouldDispose() {
      return this.presence < 0.01 && !this.frameActive;
    }

    dispose() {
      const disposeMaterial = (material) => {
        if (material && material.dispose) material.dispose();
      };
      const disposeGeometry = (geometry) => {
        if (geometry && geometry.dispose) geometry.dispose();
      };
      this.group.traverse((child) => {
        if (child.isMesh) {
          disposeMaterial(child.material);
          disposeGeometry(child.geometry);
        }
      });
    }
  }

  // Environment helpers ---------------------------------------------------
  function createSeabed() {
    const geometry = new THREE.PlaneGeometry(world.width * 1.6, world.depth * 1.8, 60, 60);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.attributes.position;
    const colors = [];
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const ridge = Math.sin(x * 0.7) * 0.12 + Math.cos(z * 0.9) * 0.08;
      const noise = (hashToUnit(`seabed-${i}`, 1) - 0.5) * 0.05;
      const y = -0.9 + ridge + noise;
      position.setY(i, y);
      const depth = clamp((y + 1.2) / 1.8, 0, 1);
      const color = new THREE.Color().setHSL(0.07 + depth * 0.1, 0.5, 0.24 + depth * 0.16);
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = -0.84;
    scene.add(mesh);
  }

  function createBackgroundParticles() {
    const count = 420;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * world.width * 2.1;
      positions[i * 3 + 1] = Math.random() * 1.4 - 0.4;
      positions[i * 3 + 2] = (Math.random() - 0.5) * world.depth * 2.3;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0x6fb2ff,
      transparent: true,
      opacity: 0.16,
      size: 0.08,
      sizeAttenuation: true,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    scene.add(points);
    floatingLayers.push({ geometry, points, speed: 0.12, bounds: { min: -0.6, max: 1.0 } });
  }

  function createGradientTexture(stops) {
    const canvasTex = document.createElement('canvas');
    canvasTex.width = 32;
    canvasTex.height = 256;
    const ctx = canvasTex.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, canvasTex.height);
    stops.forEach((stop) => {
      gradient.addColorStop(stop.offset, stop.color);
    });
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvasTex.width, canvasTex.height);
    const texture = new THREE.CanvasTexture(canvasTex);
    texture.wrapS = THREE.MirroredRepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  }

  function createBodyTexture(baseHue) {
    const canvasTex = document.createElement('canvas');
    canvasTex.width = 128;
    canvasTex.height = 64;
    const ctx = canvasTex.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, canvasTex.width, 0);
    const hueDeg = baseHue * 360;
    gradient.addColorStop(0, `hsl(${Math.max(0, hueDeg - 8)}, 78%, 48%)`);
    gradient.addColorStop(0.55, `hsl(${hueDeg}, 84%, 57%)`);
    gradient.addColorStop(1, `hsl(${Math.min(360, hueDeg + 12)}, 72%, 63%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvasTex.width, canvasTex.height);

    const vertical = ctx.createLinearGradient(0, 0, 0, canvasTex.height);
    vertical.addColorStop(0, 'rgba(255,255,255,0.26)');
    vertical.addColorStop(0.45, 'rgba(255,255,255,0.1)');
    vertical.addColorStop(1, 'rgba(30,18,0,0.15)');
    ctx.fillStyle = vertical;
    ctx.fillRect(0, 0, canvasTex.width, canvasTex.height);

    const texture = new THREE.CanvasTexture(canvasTex);
    texture.wrapS = THREE.MirroredRepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;
    texture.anisotropy = maxAniso;
    texture.needsUpdate = true;
    return texture;
  }

  function createVolumetricLayers() {
    const texture = createGradientTexture([
      { offset: 0, color: 'rgba(8,28,46,0.0)' },
      { offset: 0.4, color: 'rgba(18,70,110,0.18)' },
      { offset: 1, color: 'rgba(8,32,55,0.55)' },
    ]);
    for (let i = 0; i < 3; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(world.width * 1.4, world.height * 1.8), material);
      plane.position.set(0, 0.5, -0.8 + i * 0.65);
      plane.rotation.x = Math.PI / 2.1;
      scene.add(plane);
      volumetricPlanes.push({ mesh: plane, baseZ: plane.position.z, speed: 0.35 + i * 0.08, offset: Math.random() * Math.PI * 2 });
    }
  }

  function createKelpClusters() {
    const kelpMaterial = new THREE.MeshStandardMaterial({
      color: 0x1c7c4a,
      emissive: 0x042814,
      roughness: 0.8,
      metalness: 0.05,
    });
    for (let i = 0; i < 5; i += 1) {
      const group = new THREE.Group();
      const baseX = (i - 2) * 0.75;
      const baseZ = -0.9 + (i % 2) * 1.2;
      const stalks = 3 + Math.floor(Math.random() * 3);
      for (let s = 0; s < stalks; s += 1) {
        const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.05, 0.9, 6, 1), kelpMaterial);
        stalk.position.set(baseX + (Math.random() - 0.5) * 0.3, -0.35, baseZ + (Math.random() - 0.5) * 0.4);
        stalk.rotation.z = (Math.random() - 0.5) * 0.3;
        group.add(stalk);
      }
      scene.add(group);
    }
  }

  function createWaterSurface() {
    const geometry = new THREE.PlaneGeometry(world.width * 1.45, world.depth * 1.45, 60, 60);
    geometry.rotateX(-Math.PI / 2);
    const attribute = geometry.getAttribute('position');
    const basePositions = attribute.array.slice();
    const material = new THREE.MeshPhysicalMaterial({
      color: 0x0d2f4a,
      transparent: true,
      opacity: 0.68,
      transmission: 0.86,
      thickness: 0.9,
      roughness: 0.16,
      metalness: 0.02,
      clearcoat: 1,
      clearcoatRoughness: 0.18,
      reflectivity: 0.72,
      envMapIntensity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = world.height * 0.52;
    mesh.renderOrder = 2;
    scene.add(mesh);
    return { mesh, geometry, basePositions, normalCounter: 0 };
  }

  function updateWaterSurface(surface, time) {
    const attribute = surface.geometry.getAttribute('position');
    const arr = attribute.array;
    const base = surface.basePositions;
    for (let i = 0; i < attribute.count; i += 1) {
      const bx = base[i * 3 + 0];
      const by = base[i * 3 + 1];
      const bz = base[i * 3 + 2];
      const ripple = Math.sin(bx * 1.2 + time * 1.4) * 0.035 + Math.cos(bz * 1.6 + time * 0.9) * 0.028;
      arr[i * 3 + 0] = bx;
      arr[i * 3 + 1] = by + ripple;
      arr[i * 3 + 2] = bz;
    }
    attribute.needsUpdate = true;
    surface.normalCounter += 1;
    if (surface.normalCounter % 2 === 0) {
      surface.geometry.computeVertexNormals();
    }
    const material = surface.mesh.material;
    material.opacity = 0.64 + Math.sin(time * 0.45) * 0.05;
    material.thickness = 0.85 + Math.sin(time * 0.3 + 1.1) * 0.08;
  }

  // Fallback school -------------------------------------------------------
  function createFallbackSchool(count) {
    const school = [];
    for (let i = 0; i < count; i += 1) {
      const id = `fallback-${i}`;
      school.push({
        id,
        position: new THREE.Vector3(
          (hashToUnit(id, 11) - 0.5) * world.width * 0.9,
          (hashToUnit(id, 12) - 0.3) * world.height * 0.8,
          (hashToUnit(id, 13) - 0.5) * world.depth * 0.9,
        ),
        velocity: new THREE.Vector3(
          (hashToUnit(id, 14) - 0.5) * 0.5,
          (hashToUnit(id, 15) - 0.5) * 0.3,
          (hashToUnit(id, 16) - 0.5) * 0.5,
        ),
        target: new THREE.Vector3(),
        speed: 0.25 + hashToUnit(id, 17) * 0.45,
        sizeBias: hashToUnit(id, 18),
        phase: hashToUnit(id, 19) * Math.PI * 2,
        turnTimer: 0,
      });
    }
    return school;
  }

  function updateFallbackSchool(school, dt, now) {
    const bounds = {
      x: (world.width * 0.5) * 0.95,
      y: (world.height * 0.5) * 0.9,
      z: (world.depth * 0.5) * 0.95,
    };
    school.forEach((fish, index) => {
      fish.turnTimer -= dt;
      if (fish.turnTimer <= 0) {
        fish.turnTimer = 1.6 + hashToUnit(fish.id, index + Math.floor(now * 0.001)) * 1.8;
        const heading = new THREE.Vector3(
          (hashToUnit(fish.id, index + 40) - 0.5) * 2,
          (hashToUnit(fish.id, index + 41) - 0.5) * 1.2,
          (hashToUnit(fish.id, index + 42) - 0.5) * 2,
        );
        if (heading.lengthSq() < 1e-6) heading.set(1, 0, 0);
        heading.normalize();
        fish.target.copy(heading.multiplyScalar(fish.speed));
      }

      fish.velocity.lerp(fish.target, clamp(dt * 2.5, 0, 1));
      fish.position.addScaledVector(fish.velocity, dt);

      const centerForce = new THREE.Vector3(-fish.position.x, -fish.position.y * 0.4, -fish.position.z);
      centerForce.multiplyScalar(0.08 * dt);
      fish.velocity.add(centerForce);

      if (fish.position.x < -bounds.x) {
        fish.position.x = -bounds.x;
        fish.velocity.x = Math.abs(fish.velocity.x);
      } else if (fish.position.x > bounds.x) {
        fish.position.x = bounds.x;
        fish.velocity.x = -Math.abs(fish.velocity.x);
      }
      if (fish.position.y < -bounds.y) {
        fish.position.y = -bounds.y;
        fish.velocity.y = Math.abs(fish.velocity.y);
      } else if (fish.position.y > bounds.y) {
        fish.position.y = bounds.y;
        fish.velocity.y = -Math.abs(fish.velocity.y);
      }
      if (fish.position.z < -bounds.z) {
        fish.position.z = -bounds.z;
        fish.velocity.z = Math.abs(fish.velocity.z);
      } else if (fish.position.z > bounds.z) {
        fish.position.z = bounds.z;
        fish.velocity.z = -Math.abs(fish.velocity.z);
      }

      const maxSpeed = fish.speed * 1.3;
      if (fish.velocity.lengthSq() > maxSpeed * maxSpeed) {
        fish.velocity.setLength(maxSpeed);
      }
    });
  }
})();
