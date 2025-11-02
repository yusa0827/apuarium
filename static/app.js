// static/app.js
(() => {
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');

  // リサイズ対応
  function fit() {
    const ratio = window.devicePixelRatio || 1;
    cv.width  = Math.floor(cv.clientWidth  * ratio);
    cv.height = Math.floor((window.innerHeight - 60 - 28) * ratio); // header+footerぶん引き
  }
  window.addEventListener('resize', fit);
  fit();

  // ドット絵金魚のロード
  const fishImg = new Image();
  fishImg.src = '/static/goldfish.png'; // 32x20 くらいのPNGを想定

  // 受信状態
  let fishState = []; // {id, x, y, dir, scale, flip}
  let lastTs = performance.now();

  // 簡易泡エフェクト
  const bubbles = [];
  function spawnBubble() {
    // 下部からランダムに
    bubbles.push({
      x: Math.random() * cv.width,
      y: cv.height + Math.random() * 50,
      r: 2 + Math.random() * 3,
      vy: - (0.3 + Math.random() * 0.7) * (window.devicePixelRatio || 1),
      drift: (Math.random() - 0.5) * 0.3
    });
  }
  setInterval(() => { for (let i=0;i<2;i++) spawnBubble(); }, 300);

  // 描画ループ（サーバー更新は20Hz、描画はブラウザvsync）
  function render(ts) {
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;

    // 背景（水流：縦グラデ＋さざ波）
    const w = cv.width, h = cv.height;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0b3450');
    grad.addColorStop(0.7, '#0b2640');
    grad.addColorStop(1, '#0b1e2b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // さざ波（薄い正弦ウェーブ）
    ctx.globalAlpha = 0.07;
    ctx.beginPath();
    const amp = 8, k = 2 * Math.PI / 180; // 波の振幅と波数
    for (let x=0; x<=w; x+=6) {
      const y = h*0.2 + Math.sin((x + ts*0.05) * k) * amp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#7fd';
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    // 泡
    for (let i=bubbles.length-1; i>=0; i--) {
      const b = bubbles[i];
      b.y += b.vy;
      b.x += b.drift;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(200,240,255,0.6)';
      ctx.fill();
      if (b.y < -10) bubbles.splice(i,1);
    }

    // 魚
    if (fishImg.complete && fishImg.naturalWidth > 0) {
      fishState.forEach(f => {
        const px = f.x * w;
        const py = f.y * h;
        const baseW = 32 * f.scale * (window.devicePixelRatio || 1);
        const baseH = 20 * f.scale * (window.devicePixelRatio || 1);

        // デバッグ: 最初の魚だけログ出力
        if (f.id === 0 && Math.random() < 0.01) {
          const vx = Math.cos(f.dir);
          console.log(`魚#${f.id}: dir=${f.dir.toFixed(2)}, vx=${vx.toFixed(2)} (${vx < 0 ? '左' : '右'}に進む), flip=${f.flip}`);
        }

        ctx.save();
        ctx.translate(px, py);
        // 向き：左右はflip、上下は微回転（dirはヒント程度）
        ctx.scale(f.flip, 1);  // 先にスケール
        const angle = Math.atan2(Math.sin(f.dir), Math.cos(f.dir)) * 0.15;
        ctx.rotate(angle);     // 後に回転
        ctx.drawImage(fishImg, -baseW/2, -baseH/2, baseW, baseH);
        ctx.restore();
      });
    }

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  // WebSocket接続
  const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${wsProto}://${location.host}/ws`);
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'state') {
        fishState = msg.fish || [];
      }
    } catch (e) {}
  };
  ws.onopen = () => {
    // 将来：設定変更など送る場合に使用
    ws.send(JSON.stringify({type:'hello'}));
  };
})();
