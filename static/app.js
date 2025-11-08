import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.162.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.162.0/examples/jsm/loaders/GLTFLoader.js';

const canvas = document.getElementById('cv');
if (!canvas) {
  throw new Error('canvas element not found');
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x04111d, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b2233, 6, 18);

const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 50);
camera.position.set(0.0, 0.75, 5.4);
const cameraTarget = new THREE.Vector3(0, 0.3, 0);
camera.lookAt(cameraTarget);

const worldBounds = new THREE.Vector3(5.0, 2.4, 3.2);
const halfBounds = worldBounds.clone().multiplyScalar(0.5);

const header = document.querySelector('header');
const statusBadge = document.createElement('span');
statusBadge.style.float = 'right';
statusBadge.style.fontSize = '12px';
statusBadge.style.opacity = '0.7';
statusBadge.textContent = 'loading goldfish…';
header?.appendChild(statusBadge);

function setStatus(text, tint = '#c9f') {
  statusBadge.textContent = text;
  statusBadge.style.color = tint;
}

function resize() {
  const rect = canvas.parentElement?.getBoundingClientRect();
  const headerHeight = header ? header.getBoundingClientRect().height : 0;
  const footer = document.querySelector('footer');
  const footerHeight = footer ? footer.getBoundingClientRect().height : 0;
  const width = rect ? rect.width : window.innerWidth;
  const height = Math.max(1, (rect ? rect.height : window.innerHeight) - headerHeight - footerHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// --- Environment ------------------------------------------------------------

const ambient = new THREE.HemisphereLight(0x5f9dff, 0x06121f, 0.55);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xfff0c8, 1.2);
keyLight.position.set(-3.6, 5.2, 3.2);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 15;
keyLight.shadow.camera.left = -4;
keyLight.shadow.camera.right = 4;
keyLight.shadow.camera.top = 4;
keyLight.shadow.camera.bottom = -3;
scene.add(keyLight);

const rimLight = new THREE.PointLight(0x2f8dff, 0.6, 0, 2);
rimLight.position.set(3.4, 1.4, -2.8);
scene.add(rimLight);

const causticLight = new THREE.PointLight(0x4acfff, 0.4, 0, 2);
causticLight.position.set(-0.6, -0.3, 1.6);
scene.add(causticLight);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(worldBounds.x, worldBounds.z, 1, 1),
  new THREE.MeshStandardMaterial({
    color: 0x08212c,
    roughness: 0.95,
    metalness: 0.0,
    emissive: 0x041520,
  }),
);
floor.receiveShadow = true;
floor.rotation.x = -Math.PI / 2;
floor.position.y = -halfBounds.y + 0.02;
scene.add(floor);

const backWall = new THREE.Mesh(
  new THREE.PlaneGeometry(worldBounds.x, worldBounds.y),
  new THREE.MeshStandardMaterial({
    color: 0x071a27,
    roughness: 0.8,
    metalness: 0.0,
    emissive: 0x031019,
  }),
);
backWall.position.set(0, 0, -halfBounds.z);
scene.add(backWall);

const waterVolume = new THREE.Mesh(
  new THREE.BoxGeometry(worldBounds.x * 0.98, worldBounds.y * 0.98, worldBounds.z * 0.98),
  new THREE.MeshPhysicalMaterial({
    color: 0x0d2737,
    roughness: 0.1,
    metalness: 0,
    transparent: true,
    opacity: 0.18,
    side: THREE.BackSide,
    transmission: 1.0,
    thickness: 2.8,
  }),
);
scene.add(waterVolume);

const fogPlaneMaterial = new THREE.MeshBasicMaterial({
  color: 0x0b2436,
  transparent: true,
  opacity: 0.18,
  depthWrite: false,
});
for (let i = 0; i < 4; i += 1) {
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(worldBounds.x, worldBounds.y), fogPlaneMaterial.clone());
  plane.position.z = -halfBounds.z + (i + 1) * (worldBounds.z / 5);
  plane.material.opacity = 0.12 + i * 0.05;
  scene.add(plane);
}

// Soft particles in the volume
const particleGeometry = new THREE.BufferGeometry();
const particleCount = 180;
const positions = new Float32Array(particleCount * 3);
const sizes = new Float32Array(particleCount);
for (let i = 0; i < particleCount; i += 1) {
  positions[i * 3 + 0] = (Math.random() - 0.5) * worldBounds.x * 0.9;
  positions[i * 3 + 1] = (Math.random() - 0.3) * worldBounds.y * 0.8;
  positions[i * 3 + 2] = (Math.random() - 0.5) * worldBounds.z * 0.9;
  sizes[i] = 0.8 + Math.random() * 1.6;
}
particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
particleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

const particleMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(0x6ecbff) },
  },
  vertexShader: `
    uniform float uTime;
    attribute float size;
    varying float vAlpha;
    void main() {
      vec3 pos = position;
      pos.y += sin((pos.x + uTime * 0.3) * 0.7) * 0.05;
      pos.z += cos((pos.y + uTime * 0.5) * 0.6) * 0.04;
      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      vAlpha = clamp(size / 2.6, 0.2, 0.8);
      gl_PointSize = size * 22.0 / -mvPosition.z;
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying float vAlpha;
    uniform vec3 uColor;
    void main() {
      float r = length(gl_PointCoord - vec2(0.5));
      float alpha = smoothstep(0.5, 0.0, r) * vAlpha;
      gl_FragColor = vec4(uColor, alpha * 0.45);
    }
  `,
});
const particles = new THREE.Points(particleGeometry, particleMaterial);
scene.add(particles);

// --- Goldfish management ----------------------------------------------------

let templateRoot = null;
const fishActors = new Map();
const liveStates = new Map();
let lastLiveMessage = 0;

function createPrimitiveGoldfishTemplate() {
  const group = new THREE.Group();
  group.name = 'Goldfish';

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xffb07a,
    metalness: 0.08,
    roughness: 0.35,
    emissive: new THREE.Color(0x422312),
    emissiveIntensity: 0.08,
  });
  const finMaterial = new THREE.MeshStandardMaterial({
    color: 0xffefd7,
    transparent: true,
    opacity: 0.68,
    side: THREE.DoubleSide,
    metalness: 0.0,
    roughness: 0.55,
    emissive: new THREE.Color(0x331010),
    emissiveIntensity: 0.06,
  });

  const eyeWhiteMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.2,
    metalness: 0.0,
    emissive: new THREE.Color(0x111118),
    emissiveIntensity: 0.15,
  });
  const pupilMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1c25,
    roughness: 0.05,
    metalness: 0.2,
    emissive: new THREE.Color(0x05070a),
    emissiveIntensity: 0.35,
  });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.26, 36, 24), bodyMaterial);
  body.scale.set(1.7, 1.0, 1.05);
  body.position.set(0.08, 0, 0);
  body.castShadow = true;
  group.add(body);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.8, 24, 1, true), finMaterial);
  tail.name = 'Tail';
  tail.scale.set(1, 1, 0.55);
  tail.rotation.set(THREE.MathUtils.degToRad(88), 0, Math.PI);
  tail.position.set(-0.55, 0.02, 0);
  group.add(tail);

  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.55, 16, 1, true), finMaterial);
  dorsal.name = 'Dorsal';
  dorsal.scale.set(1, 0.7, 0.65);
  dorsal.rotation.set(Math.PI, 0, 0);
  dorsal.position.set(0.05, 0.24, -0.02);
  group.add(dorsal);

  const pelvic = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.42, 14, 1, true), finMaterial);
  pelvic.name = 'Pelvic';
  pelvic.scale.set(1, 0.7, 0.6);
  pelvic.rotation.set(Math.PI, 0, 0);
  pelvic.position.set(-0.1, -0.16, -0.05);
  group.add(pelvic);

  const pectoralL = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 16, 1, true), finMaterial);
  pectoralL.name = 'PectoralL';
  pectoralL.scale.set(1, 0.7, 0.6);
  pectoralL.rotation.set(Math.PI, THREE.MathUtils.degToRad(-36), THREE.MathUtils.degToRad(-86));
  pectoralL.position.set(0.16, 0.02, 0.16);
  group.add(pectoralL);

  const pectoralR = pectoralL.clone();
  pectoralR.name = 'PectoralR';
  pectoralR.rotation.set(Math.PI, THREE.MathUtils.degToRad(36), THREE.MathUtils.degToRad(86));
  pectoralR.position.set(0.16, 0.02, -0.16);
  group.add(pectoralR);

  const eyeWhiteL = new THREE.Mesh(new THREE.SphereGeometry(0.08, 18, 12), eyeWhiteMaterial);
  eyeWhiteL.position.set(0.28, 0.05, 0.16);
  group.add(eyeWhiteL);

  const eyeWhiteR = eyeWhiteL.clone();
  eyeWhiteR.position.set(0.28, 0.05, -0.16);
  group.add(eyeWhiteR);

  const pupilL = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 12), pupilMaterial);
  pupilL.position.set(0.32, 0.05, 0.18);
  group.add(pupilL);

  const pupilR = pupilL.clone();
  pupilR.position.set(0.32, 0.05, -0.18);
  group.add(pupilR);

  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.receiveShadow = obj.material.transparent ? false : true;
    }
  });

  return group;
}

function replaceTemplateRoot(newRoot) {
  templateRoot = newRoot;
  if (templateRoot) {
    templateRoot.visible = false;
  }
  fishActors.forEach((actor) => {
    scene.remove(actor.root);
  });
  fishActors.clear();
}

replaceTemplateRoot(createPrimitiveGoldfishTemplate());
setStatus('placeholder goldfish ready', '#e7f7ff');

class GoldfishActor {
  constructor(id, template) {
    this.id = id;
    this.root = template.clone(true);
    this.root.visible = false;
    this.root.traverse((obj) => {
      if (obj.isMesh) {
        obj.material = obj.material.clone();
        obj.castShadow = true;
        obj.receiveShadow = !obj.material.transparent;
      }
    });
    this.tail = this.root.getObjectByName('Tail');
    this.pectoralL = this.root.getObjectByName('PectoralL');
    this.pectoralR = this.root.getObjectByName('PectoralR');
    this.dorsal = this.root.getObjectByName('Dorsal');
    this.pelvic = this.root.getObjectByName('Pelvic');

    const deg = THREE.MathUtils.degToRad;
    if (this.pectoralL) {
      this.pectoralL.rotation.set(deg(65), deg(18), deg(40));
    }
    if (this.pectoralR) {
      this.pectoralR.rotation.set(deg(65), deg(-18), deg(-40));
    }
    if (this.pelvic) {
      this.pelvic.rotation.set(deg(105), 0, 0);
    }

    this.position = new THREE.Vector3();
    this.prevPosition = new THREE.Vector3();
    this.targetPosition = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.targetQuaternion = new THREE.Quaternion();
    this.headingHint = new THREE.Vector3(1, 0, 0);
    this.velocityHint = new THREE.Vector3(1, 0, 0);
    this.depth = (Math.random() - 0.5) * worldBounds.z * 0.7;
    this.presence = 0;
    this.currentScale = 0.9;
    this.targetScale = 1.0;
    this.swimPhase = Math.random() * Math.PI * 2;
    this.mode = 'fallback';
    this.frameActive = false;
    this.speedHint = 0.0;

    scene.add(this.root);
  }

  beginFrame() {
    this.frameActive = false;
  }

  applyLiveState(state) {
    const nx = (state.x - 0.5) * worldBounds.x * 0.8;
    const ny = (0.5 - state.y) * worldBounds.y * 0.75;
    const hasZ = Number.isFinite(state.z);
    const nz = hasZ ? (0.5 - state.z) * worldBounds.z * 0.85 : this.depth;
    if (hasZ) {
      this.depth = nz;
    }
    this.targetPosition.set(nx, ny, hasZ ? nz : this.depth);
    const scaleHint = Number.isFinite(state.scale) ? state.scale : 1;
    this.targetScale = 0.6 + scaleHint * 0.45;

    if (Number.isFinite(state.speed)) {
      this.speedHint = state.speed * worldBounds.x * 0.8;
    }

    const heading = state.heading;
    const hasHeading = heading && Number.isFinite(heading.x) && Number.isFinite(heading.y) && Number.isFinite(heading.z);
    if (hasHeading) {
      this.headingHint.set(heading.x, heading.y, heading.z).normalize();
    }

    const hasVelocity = Number.isFinite(state.vx) && Number.isFinite(state.vy) && Number.isFinite(state.vz);
    if (hasVelocity) {
      this.velocityHint.set(state.vx, state.vy, state.vz);
      if (!hasHeading && this.velocityHint.lengthSq() > 0) {
        this.headingHint.copy(this.velocityHint).normalize();
      }
    }

    if (!hasHeading && !hasVelocity && Number.isFinite(state.dir)) {
      this.headingHint.set(Math.cos(state.dir), Math.sin(state.dir) * 0.2, Math.sin(state.dir + Math.PI / 2));
    }
    this.mode = 'live';
    this.frameActive = true;
  }

  applyFallbackState(state) {
    this.targetPosition.copy(state.position);
    this.targetScale = state.scale;
    this.velocityHint.copy(state.velocity);
    this.speedHint = state.velocity.length();
    if (state.velocity.lengthSq() > 0) {
      this.headingHint.copy(state.velocity).normalize();
    }
    this.mode = 'fallback';
    this.frameActive = true;
  }

  update(dt, time) {
    const smooth = 1 - Math.exp(-dt * 5);
    this.position.lerp(this.targetPosition, smooth);
    const delta = this.position.clone().sub(this.prevPosition);
    const vel = delta.lengthSq() > 1e-8 ? delta.clone().divideScalar(Math.max(dt, 1e-3)) : new THREE.Vector3();
    this.velocity.lerp(vel, 0.6);
    this.prevPosition.copy(this.position);

    let forward = delta.clone();
    if (forward.lengthSq() < 1e-6) {
      forward = (this.mode === 'live' ? this.headingHint : this.velocityHint).clone();
    }
    if (forward.lengthSq() < 1e-6) {
      forward.set(1, 0, 0);
    }
    forward.normalize();

    const upCandidate = Math.abs(forward.y) > 0.85 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(upCandidate, forward).normalize();
    const up = new THREE.Vector3().crossVectors(forward, right).normalize();
    const basis = new THREE.Matrix4().makeBasis(forward, up, right);
    this.targetQuaternion.setFromRotationMatrix(basis);
    const slerp = 1 - Math.exp(-dt * 6);
    this.quaternion.slerp(this.targetQuaternion, slerp);
    this.root.quaternion.copy(this.quaternion);

    const scaleSmooth = 1 - Math.exp(-dt * 3);
    this.currentScale = THREE.MathUtils.lerp(this.currentScale, this.targetScale, scaleSmooth);
    const presenceTarget = this.frameActive ? 1 : 0;
    this.presence = THREE.MathUtils.lerp(this.presence, presenceTarget, 1 - Math.exp(-dt * 5));

    const finalScale = this.currentScale * this.presence;
    this.root.scale.setScalar(finalScale);
    this.root.visible = finalScale > 0.02;
    this.root.position.copy(this.position);

    const swimMetric = Math.max(this.velocity.length(), this.speedHint);
    const swimSpeed = 2.2 + swimMetric * 0.9;
    this.swimPhase += dt * swimSpeed;
    const tailSwing = 0.35 + swimMetric * 0.18;
    if (this.tail) {
      this.tail.rotation.y = Math.sin(this.swimPhase) * tailSwing;
      this.tail.position.y = Math.sin(this.swimPhase * 0.5) * 0.015;
    }
    if (this.pectoralL) {
      this.pectoralL.rotation.z = 0.9 + Math.sin(this.swimPhase + 0.5) * 0.25;
      this.pectoralL.rotation.y = 0.3 + Math.sin(time * 1.2 + this.id) * 0.08;
    }
    if (this.pectoralR) {
      this.pectoralR.rotation.z = -0.9 + Math.sin(this.swimPhase + 0.8) * -0.25;
      this.pectoralR.rotation.y = -0.3 + Math.sin(time * 1.1 + this.id * 0.7) * 0.08;
    }
    if (this.pelvic) {
      this.pelvic.rotation.x = THREE.MathUtils.degToRad(105) + Math.sin(this.swimPhase * 0.8) * 0.12;
    }
    if (this.dorsal) {
      this.dorsal.rotation.x = Math.sin(this.swimPhase * 0.6) * 0.05;
    }
  }
}

function ensureActor(id) {
  if (!templateRoot) {
    return null;
  }
  let actor = fishActors.get(id);
  if (!actor) {
    actor = new GoldfishActor(id, templateRoot);
    const colorShift = new THREE.Color().setHSL(0.04 + Math.random() * 0.04, 0.7 + Math.random() * 0.1, 0.55 + Math.random() * 0.08);
    actor.root.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        obj.material.color?.lerp(colorShift, 0.6);
        if (obj.material.emissive) {
          obj.material.emissive.lerp(colorShift, 0.2);
        }
        if (obj.material.transparent) {
          obj.material.opacity = obj.material.opacity ?? 0.8;
        }
      }
    });
    fishActors.set(id, actor);
  }
  return actor;
}

// --- Fallback simulation ----------------------------------------------------

function createFallbackSchool(count) {
  const school = [];
  for (let i = 0; i < count; i += 1) {
    const pos = new THREE.Vector3(
      (Math.random() - 0.5) * worldBounds.x * 0.7,
      (Math.random() - 0.2) * worldBounds.y * 0.6,
      (Math.random() - 0.5) * worldBounds.z * 0.7,
    );
    const dir = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.4, Math.random() - 0.5).normalize();
    const speed = 0.45 + Math.random() * 0.45;
    const vel = dir.multiplyScalar(speed);
    school.push({
      id: `fallback-${i}`,
      position: pos,
      velocity: vel,
      speed,
      scale: 0.7 + Math.random() * 0.4,
    });
  }
  return school;
}

const fallbackSchool = createFallbackSchool(12);

function updateFallbackSchool(dt) {
  const center = new THREE.Vector3();
  fallbackSchool.forEach((fish) => center.add(fish.position));
  center.multiplyScalar(1 / fallbackSchool.length);

  fallbackSchool.forEach((fish) => {
    const jitter = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.6, Math.random() - 0.5).multiplyScalar(0.25 * dt);
    fish.velocity.add(jitter);

    const toCenter = center.clone().sub(fish.position).multiplyScalar(0.15 * dt);
    fish.velocity.add(toCenter);

    fish.velocity.clampLength(fish.speed * 0.6, fish.speed * 1.4);
    fish.position.addScaledVector(fish.velocity, dt);

    if (fish.position.x < -halfBounds.x * 0.9 || fish.position.x > halfBounds.x * 0.9) {
      fish.velocity.x *= -1;
      fish.position.x = THREE.MathUtils.clamp(fish.position.x, -halfBounds.x * 0.9, halfBounds.x * 0.9);
    }
    if (fish.position.y < -halfBounds.y * 0.85 || fish.position.y > halfBounds.y * 0.85) {
      fish.velocity.y *= -0.8;
      fish.position.y = THREE.MathUtils.clamp(fish.position.y, -halfBounds.y * 0.85, halfBounds.y * 0.85);
    }
    if (fish.position.z < -halfBounds.z * 0.9 || fish.position.z > halfBounds.z * 0.9) {
      fish.velocity.z *= -1;
      fish.position.z = THREE.MathUtils.clamp(fish.position.z, -halfBounds.z * 0.9, halfBounds.z * 0.9);
    }
  });
}

// --- WebSocket --------------------------------------------------------------

let socket = null;
let reconnectTimer = null;

function connectWebSocket() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${window.location.host}/ws`;
  try {
    socket = new WebSocket(url);
  } catch (err) {
    scheduleReconnect();
    return;
  }

  socket.addEventListener('open', () => {
    setStatus('online', '#8ff');
  });

  socket.addEventListener('close', () => {
    setStatus('offline', '#fbb');
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    socket?.close();
  });

  socket.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload?.type === 'state' && Array.isArray(payload.fish)) {
        lastLiveMessage = performance.now();
        liveStates.clear();
        payload.fish.forEach((fish) => {
          if (typeof fish.id !== 'undefined') {
            liveStates.set(String(fish.id), fish);
          }
        });
      }
    } catch (err) {
      console.warn('failed to parse message', err);
    }
  });
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, 3000);
}

connectWebSocket();

// --- Loading model ----------------------------------------------------------

const loader = new GLTFLoader();
loader.load(
  '/static/models/goldfish.gltf',
  (gltf) => {
    const highDetail = gltf.scene.getObjectByName('Goldfish') || gltf.scene.children[0] || gltf.scene;
    replaceTemplateRoot(highDetail);
    setStatus('waiting for data…', '#aff');
  },
  undefined,
  (error) => {
    console.error('Failed to load goldfish glTF', error);
    setStatus('using placeholder model', '#ffd18f');
  },
);

// --- Animation loop --------------------------------------------------------

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  const now = performance.now();
  particles.material.uniforms.uTime.value += dt;

  if (!templateRoot) {
    renderer.render(scene, camera);
    return;
  }

  fishActors.forEach((actor) => actor.beginFrame());

  const useFallback = now - lastLiveMessage > 2500 || liveStates.size === 0;
  if (useFallback) {
    updateFallbackSchool(dt);
    fallbackSchool.forEach((state) => {
      const actor = ensureActor(state.id);
      if (actor) {
        actor.applyFallbackState(state);
      }
    });
    const offline = liveStates.size === 0;
    setStatus(offline ? 'offline simulation' : 'buffering', offline ? '#ffd18f' : '#ffe8a3');
  } else {
    liveStates.forEach((fish, key) => {
      const actor = ensureActor(key);
      if (actor) {
        actor.applyLiveState(fish);
      }
    });
    setStatus('streaming', '#8ff0ff');
  }

  fishActors.forEach((actor) => actor.update(dt, now * 0.001));

  fishActors.forEach((actor, key) => {
    if (!actor.frameActive && actor.presence < 0.01) {
      scene.remove(actor.root);
      fishActors.delete(key);
    }
  });

  renderer.render(scene, camera);
}

animate();
