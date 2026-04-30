const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const fgCanvas = document.getElementById('fgCanvas');
const fgCtx = fgCanvas.getContext('2d');
let width, height;

const elTime = document.getElementById('time');
const elTarget = document.getElementById('target');
const elTargetBox = document.getElementById('target-box');
const elScore = document.getElementById('score');
const elCurrent = document.getElementById('current');
const elOverMsg = document.getElementById('over-msg');
const btnReset = document.getElementById('reset-btn');
const stageBtns = document.querySelectorAll('.stage-btn');
const overlay = document.getElementById('overlay');

const colors = {
  1: { base: '#ff0000', shadow: '#b30000', highlight: '#ff6633' },
  2: { base: '#ff7f00', shadow: '#b34d00', highlight: '#ffb266' },
  3: { base: '#ffd700', shadow: '#b39500', highlight: '#ffff66' },
  4: { base: '#00cc00', shadow: '#008000', highlight: '#66ff66' },
  5: { base: '#0066ff', shadow: '#0033b3', highlight: '#66b2ff' }
};

let isPlaying = false, score = 0, timeLeft = 120, targetNum = 7, currentSum = 0;
let bonusCombo = 0;
let isTutorial = false;
let tutorialStep = 0;
let isOver = false, creatures = [], absorbingCreatures = [];
let drawnPaths = [], currentPath = [], fadingPaths = [], particles = [];
let isDrawing = false, timerInterval;
let currentStage = 1;
let isSoundOn = true;

// フレームレート制御用
let lastTime = 0;
const targetFPS = 60;
const frameInterval = 1000 / targetFPS;

// BGMの設定
let bgm = new Audio();
bgm.loop = true;
// ループが効かない環境（特定のiOS/Safariなど）への対策
bgm.addEventListener('ended', function () {
  this.currentTime = 0;
  this.play();
}, false);

// SEの設定（Web Audio APIを使用して低遅延・安定化）
const seSources = {
  energy: 'assets/energy.mp3',
  splashes: 'assets/splashes.mp3'
};
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
const seBuffers = { energy: null, splashes: null };

// サウンドのプリロード
async function loadSESounds() {
  if (!audioCtx) audioCtx = new AudioContext();
  for (const key in seSources) {
    try {
      const response = await fetch(seSources[key]);
      const arrayBuffer = await response.arrayBuffer();
      seBuffers[key] = await audioCtx.decodeAudioData(arrayBuffer);
    } catch (e) {
      console.log(`Failed to load SE: ${key}`, e);
    }
  }
}

function playSE(type) {
  if (!isSoundOn || !audioCtx || !seBuffers[type]) return;

  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const source = audioCtx.createBufferSource();
  source.buffer = seBuffers[type];
  source.connect(audioCtx.destination);
  source.start(0);
}

const stageConfigs = {
  1: { timeLeft: 120, targetRange: [3, 8], creaturesCount: 15, subChance: 0, minCounts: { 1: 1 }, bgm: 'assets/BGM1.mp3' },
  2: { timeLeft: 120, targetRange: [3, 8], creaturesCount: 15, subChance: 0.3, minCounts: { 1: 1, 'high': 2 }, bgm: 'assets/BGM2.mp3' }
};

function resize() {
  width = window.innerWidth; height = window.innerHeight;
  canvas.width = width; canvas.height = height;
  fgCanvas.width = width; fgCanvas.height = height;
}
window.addEventListener('resize', resize); resize();

class Creature {
  constructor(fixedValue = null, onScreen = false) {
    const config = stageConfigs[currentStage];

    if (fixedValue !== null) {
      this.value = fixedValue;
      this.type = 'circle';
    } else if (isTutorial) {
      if (tutorialStep === 1) {
        this.value = 3;
      } else if (tutorialStep === 2) {
        this.value = Math.floor(Math.random() * 3) + 3; // 3, 4, 5
      }
      this.type = 'circle';
    } else {
      // 盤面上の各数値の数をカウント (足し算・引き算含む)
      const countV1 = creatures.filter(c => !c.dead && c.value === 1).length;
      const countHigh = creatures.filter(c => !c.dead && (c.value === 4 || c.value === 5) && c.type === 'circle').length;

      if (config.minCounts[1] && countV1 < config.minCounts[1]) {
        // 「1」が不足している場合
        this.value = 1;
        // 1の場合はステージ設定に合わせてタイプを決める
        this.type = (Math.random() < config.subChance) ? 'rhombus' : 'circle';
      } else if (config.minCounts['high'] && countHigh < config.minCounts['high']) {
        // 高数値(4, 5)が不足している場合
        this.value = Math.random() < 0.5 ? 4 : 5;
        this.type = 'circle';
      } else {
        // 通常生成
        this.value = Math.floor(Math.random() * 5) + 1;
        this.type = (Math.random() < config.subChance) ? 'rhombus' : 'circle';
      }
    }

    this.colorInfo = colors[this.value];
    this.baseRadius = 20;
    this.radius = this.baseRadius;

    let startX, startY;
    if (onScreen) {
      // チュートリアルなど、すぐに出現させたい場合
      startX = Math.random() * (width - 200) + 100;
      startY = Math.random() * (height - 300) + 150;
    } else {
      // 出現位置を画面外に設定（上下左右ランダム）
      const side = Math.floor(Math.random() * 4);
      const margin = 50;
      if (side === 0) { // 上
        startX = Math.random() * width; startY = -margin;
      } else if (side === 1) { // 下
        startX = Math.random() * width; startY = height + margin;
      } else if (side === 2) { // 左
        startX = -margin; startY = Math.random() * height;
      } else { // 右
        startX = width + margin; startY = Math.random() * height;
      }
    }

    this.segments = [];
    for (let i = 0; i < this.value; i++) {
      this.segments.push({ x: startX, y: startY });
    }

    // 画面中央付近に向かって移動開始するようにベクトルを設定
    let targetX = width / 2 + (Math.random() - 0.5) * 200;
    let targetY = height / 2 + (Math.random() - 0.5) * 200;
    let angle = Math.atan2(targetY - startY, targetX - startX);
    let speed = 2 + Math.random() * 2;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;

    this.isCaptured = false;
    this.isAbsorbing = false;
    this.dead = false;
  }

  // ★吸い込み開始のセットアップ
  startAbsorb(targetX, targetY) {
    this.isAbsorbing = true;
    this.absorbTargetX = targetX;
    this.absorbTargetY = targetY;
    this.absorbFrame = 0;
    this.absorbDuration = 50; // 吸い込みにかかるフレーム数（約0.8秒）
    this.absorbStartX = this.segments[0].x;
    this.absorbStartY = this.segments[0].y;

    // ★軌道をカーブさせるためのコントロールポイント（ランダムに左右に膨らませる）
    let distX = targetX - this.absorbStartX;
    let distY = targetY - this.absorbStartY;
    let angle = Math.atan2(distY, distX) + (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 4);
    let dist = Math.hypot(distX, distY) * 0.5;
    this.cpX = this.absorbStartX + Math.cos(angle) * dist;
    this.cpY = this.absorbStartY + Math.sin(angle) * dist;
  }

  // ★頭の移動処理（当たり判定や吸い込み）
  updateMotion() {
    let head = this.segments[0];

    if (this.isAbsorbing) {
      this.absorbFrame++;
      let t = this.absorbFrame / this.absorbDuration;
      if (t > 1) t = 1;

      // ★イージング（3乗カーブ）：最初はゆっくり、後半一気に加速
      let ease = t * t * t;

      let t1 = 1 - ease;
      // 2次ベジェ曲線で弧を描く軌道
      head.x = t1 * t1 * this.absorbStartX + 2 * t1 * ease * this.cpX + ease * ease * this.absorbTargetX;
      head.y = t1 * t1 * this.absorbStartY + 2 * t1 * ease * this.cpY + ease * ease * this.absorbTargetY;

      // サイズも後半に向けて一気に小さくする
      this.radius = this.baseRadius * (1 - ease) + 1;

      if (this.absorbFrame >= this.absorbDuration) {
        this.dead = true;
        triggerShake(); // 目標のところまで吸い込まれたら揺らす
        // 吸い込まれた瞬間にキラキラを少し出す
        createParticles(this.absorbTargetX, this.absorbTargetY, 15);
        // 数字に当たった時のSE
        playSE('splashes');
      }
    } else {
      // 壁バウンド
      if (head.x < this.radius) { head.x = this.radius; this.vx *= -1; }
      if (head.x > width - this.radius) { head.x = width - this.radius; this.vx *= -1; }
      if (head.y < this.radius) { head.y = this.radius; this.vy *= -1; }
      if (head.y > height - this.radius) { head.y = height - this.radius; this.vy *= -1; }

      // 揺らぎと速度制限
      this.vx += (Math.random() - 0.5) * 0.2;
      this.vy += (Math.random() - 0.5) * 0.2;
      let currentSpeed = Math.hypot(this.vx, this.vy);
      let maxSpeed = 3.5 - (this.value * 0.3);
      if (currentSpeed > maxSpeed) {
        this.vx = (this.vx / currentSpeed) * maxSpeed;
        this.vy = (this.vy / currentSpeed) * maxSpeed;
      }

      // 引いた線との当たり判定
      drawnPaths.forEach(path => {
        for (let i = 0; i < path.length - 1; i++) this.checkLineCollision(head, path[i], path[i + 1]);
      });
      if (currentPath.length > 1) {
        for (let i = 0; i < currentPath.length - 1; i++) this.checkLineCollision(head, currentPath[i], currentPath[i + 1]);
      }

      head.x += this.vx;
      head.y += this.vy;
    }
  }

  // ★関節（後ろの丸）を引っ張る処理
  updateSegments() {
    for (let i = 1; i < this.value; i++) {
      let prev = this.segments[i - 1];
      let curr = this.segments[i];
      let dx = prev.x - curr.x;
      let dy = prev.y - curr.y;
      let dist = Math.hypot(dx, dy);
      let targetDist = this.radius * 2; // サイズに比例して間隔も狭まる

      if (dist !== targetDist && dist > 0) {
        curr.x = prev.x - (dx / dist) * targetDist;
        curr.y = prev.y - (dy / dist) * targetDist;
      }
    }
  }

  checkLineCollision(head, p1, p2) {
    let l2 = Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2);
    if (l2 === 0) return;
    let t = ((head.x - p1.x) * (p2.x - p1.x) + (head.y - p1.y) * (p2.y - p1.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    let projX = p1.x + t * (p2.x - p1.x);
    let projY = p1.y + t * (p2.y - p1.y);
    let dist = Math.hypot(head.x - projX, head.y - projY);

    if (dist < this.radius) {
      let nx = head.x - projX; let ny = head.y - projY;
      let nLen = Math.hypot(nx, ny);
      if (nLen > 0) {
        nx /= nLen; ny /= nLen;
        let dot = this.vx * nx + this.vy * ny;
        if (dot < 0) {
          this.vx -= 2 * dot * nx; this.vy -= 2 * dot * ny;
          head.x += nx * (this.radius - dist); head.y += ny * (this.radius - dist);
        }
      }
    }
  }

  draw() {
    ctx.globalAlpha = this.isCaptured ? 0.4 : 1.0;
    if (this.isAbsorbing) ctx.globalAlpha = 0.9;

    for (let i = this.value - 1; i >= 0; i--) {
      let cx = this.segments[i].x;
      let cy = this.segments[i].y;
      let r = this.radius;

      if (r < 1) continue;

      ctx.save();
      ctx.beginPath();
      if (this.type === 'rhombus') {
        // 菱形のパス
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r, cy);
        ctx.closePath();
      } else {
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      }
      ctx.clip();

      ctx.fillStyle = this.colorInfo.shadow;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

      ctx.beginPath();
      let offset = r * 0.12;
      if (this.type === 'rhombus') {
        ctx.moveTo(cx - offset, cy - offset - r);
        ctx.lineTo(cx - offset + r, cy - offset);
        ctx.lineTo(cx - offset, cy - offset + r);
        ctx.lineTo(cx - offset - r, cy - offset);
        ctx.closePath();
      } else {
        ctx.arc(cx - offset, cy - offset, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = this.colorInfo.base; ctx.fill();

      ctx.beginPath();
      let hlOffset = r * 0.4; let hlRadius = r * 0.35;
      if (this.type === 'rhombus') {
        ctx.moveTo(cx - hlOffset, cy - hlOffset - hlRadius);
        ctx.lineTo(cx - hlOffset + hlRadius, cy - hlOffset);
        ctx.lineTo(cx - hlOffset, cy - hlOffset + hlRadius);
        ctx.lineTo(cx - hlOffset - hlRadius, cy - hlOffset);
        ctx.closePath();
      } else {
        ctx.arc(cx - hlOffset, cy - hlOffset, hlRadius, 0, Math.PI * 2);
      }
      ctx.fillStyle = this.colorInfo.highlight; ctx.fill();

      // 前回の save() に対応する restore()
      ctx.restore();

      // 引き算の記号 "-" を描画（一番先頭の節のみ）
      if (this.type === 'rhombus' && i === 0) {
        ctx.save();
        ctx.fillStyle = 'white';
        ctx.font = `bold ${r * 1.2}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('-', cx, cy);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1.0;
  }
}

// ★生き物（丸）同士の衝突判定＆押し出し処理
function resolveCollisions() {
  let allNodes = [];
  // 盤面にいる生き物のすべての節（丸）をリストアップ
  creatures.forEach((c, cIdx) => {
    c.segments.forEach((seg, sIdx) => {
      allNodes.push({ c: c, cIdx: cIdx, sIdx: sIdx, seg: seg });
    });
  });

  for (let i = 0; i < allNodes.length; i++) {
    for (let j = i + 1; j < allNodes.length; j++) {
      let nodeA = allNodes[i];
      let nodeB = allNodes[j];

      // 同じ生き物の隣接する丸は、関節で繋がっているので押し出さない
      if (nodeA.cIdx === nodeB.cIdx && Math.abs(nodeA.sIdx - nodeB.sIdx) <= 1) {
        continue;
      }

      let dx = nodeB.seg.x - nodeA.seg.x;
      let dy = nodeB.seg.y - nodeA.seg.y;
      let dist = Math.hypot(dx, dy);
      let minDist = nodeA.c.radius + nodeB.c.radius;

      // 丸が重なっていたら互いに押し出す
      if (dist < minDist && dist > 0) {
        let overlap = minDist - dist;
        let nx = dx / dist;
        let ny = dy / dist;

        nodeA.seg.x -= nx * (overlap / 2);
        nodeA.seg.y -= ny * (overlap / 2);
        nodeB.seg.x += nx * (overlap / 2);
        nodeB.seg.y += ny * (overlap / 2);
      }
    }
  }
}

function initGame(stageNum, tutorialMode = false) {
  currentStage = stageNum || 1;
  const config = stageConfigs[currentStage];
  isTutorial = tutorialMode;

  score = 0; timeLeft = config.timeLeft; currentSum = 0; bonusCombo = 0; isOver = false;
  isDrawing = false; // 描画状態をリセット
  creatures = []; absorbingCreatures = []; drawnPaths = []; currentPath = [];
  fadingPaths = []; particles = [];

  // ボーナス演出のリセット
  const bonusEl = document.getElementById('bonus-message');
  bonusEl.classList.remove('bonus-pop');
  bonusEl.innerHTML = '';

  // チュートリアルUIのリセット
  document.getElementById('tutorial-layer').style.display = isTutorial ? 'flex' : 'none';
  document.getElementById('tutorial-mask').style.display = isTutorial ? 'block' : 'none';
  document.getElementById('tutorial-next-btn').style.display = 'none';
  document.getElementById('tutorial-end-btn').style.display = 'none';
  document.getElementById('tutorial-mask').classList.remove('show');
  document.body.classList.toggle('tutorial-active', isTutorial);

  if (isTutorial) {
    tutorialStep = 1;
    targetNum = 3;
    timeLeft = 999;
    document.getElementById('tutorial-text').innerHTML = "上の数「3」に合うように、輪を描いてボールを囲ってください<br><span class='eng-sub'>Draw a circle to enclose the balls to match the target number '3' above</span>";
    document.getElementById('tutorial-mask').classList.add('show');
  } else {
    setNewTarget();
  }

  updateUI();
  elTime.innerText = isTutorial ? "∞" : timeLeft;
  elTarget.innerText = targetNum;

  const count = isTutorial ? 3 : config.creaturesCount;
  for (let i = 0; i < count; i++) creatures.push(new Creature(null, isTutorial));
  overlay.style.display = 'none'; isPlaying = true;

  // Web Audioの初期化とサウンドの読み込み（初回のみ）
  if (!audioCtx) {
    loadSESounds();
  } else if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  if (isTutorial) {
    bgm.pause();
  } else {
    // BGM切り替えと再生
    const targetBgm = config.bgm;
    const currentBgm = bgm.src.split('/').pop();
    if (currentBgm !== targetBgm) {
      bgm.src = targetBgm;
      bgm.load();
      bgm.play().catch(e => console.log("BGM play failed:", e));
    } else if (bgm.paused) {
      bgm.play().catch(e => console.log("BGM play failed:", e));
    }
  }

  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timeLeft--; elTime.innerText = timeLeft;
    if (timeLeft <= 0) endGame();
  }, 1000);
  
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

function endGame() {
  isPlaying = false; clearInterval(timerInterval);
  document.getElementById('result-score').innerText = `最終スコア: ${score}`;

  // スコアが1以上なら名前入力
  if (score > 0) {
    document.getElementById('final-score-value').innerText = score;
    document.getElementById('name-input-modal').style.display = 'flex';
  } else {
    overlay.style.display = 'flex';
  }
}

function triggerShake() {
  const container = document.getElementById('shake-container');
  container.classList.remove('shake-anim');
  void container.offsetWidth;
  container.classList.add('shake-anim');
}

function showBonus(combo) {
  const el = document.getElementById('bonus-message');
  el.innerHTML = combo > 1 ? `HITOFUDE<br>BONUS! x${combo}` : `HITOFUDE<br>BONUS!`;
  el.classList.remove('bonus-pop');
  void el.offsetWidth;
  el.classList.add('bonus-pop');

  // 一筆書き成功時のみ、特別な強化パーティクル
  // 画面中央から大量かつ広範囲に
  createParticles(width / 2, height / 2, 120, true);

  // 画面全体を一瞬光らせる演出
  const flash = document.getElementById('flash-layer');
  flash.classList.remove('flash-effect');
  void flash.offsetWidth;
  flash.classList.add('flash-effect');
}

function createParticles(x, y, count, isBig = false) {
  for (let i = 0; i < count; i++) {
    const speedMult = isBig ? 2.5 : 1.0;
    particles.push({
      x: x,
      y: y,
      vx: (Math.random() - 0.5) * 12 * speedMult,
      vy: (Math.random() - 0.5) * 15 * speedMult - (isBig ? 10 : 5),
      size: (Math.random() * 6 + 4) * (isBig ? 1.5 : 1.0),
      color: `hsl(${Math.random() * 40 + 190}, 100%, 70%)`, // 青色〜水色系に変更
      alpha: 1.0,
      decay: (Math.random() * 0.01 + 0.005) * (isBig ? 0.5 : 1.0), // ボーナスの時は少し長めに残る
      rotation: Math.random() * Math.PI * 2,
      rv: (Math.random() - 0.5) * 0.3
    });
  }
}

function drawParticles() {
  fgCtx.clearRect(0, 0, width, height);
  particles.forEach(p => {
    fgCtx.save();
    fgCtx.globalAlpha = p.alpha;
    fgCtx.translate(p.x, p.y);
    fgCtx.rotate(p.rotation);
    fgCtx.fillStyle = p.color;

    // 丸（円形）を描画
    fgCtx.beginPath();
    fgCtx.arc(0, 0, p.size, 0, Math.PI * 2);
    fgCtx.fill();

    // 中央を白っぽくして輝きを出す
    fgCtx.fillStyle = "rgba(255, 255, 255, 0.6)";
    fgCtx.beginPath();
    fgCtx.arc(0, 0, p.size * 0.5, 0, Math.PI * 2);
    fgCtx.fill();

    fgCtx.restore();

    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.15; // 重力
    p.vx *= 0.98;
    p.vy *= 0.98;
    p.rotation += p.rv;
    p.alpha -= p.decay;
  });
  particles = particles.filter(p => p.alpha > 0);
}

function setNewTarget() {
  const config = stageConfigs[currentStage];
  targetNum = Math.floor(Math.random() * config.targetRange[1]) + config.targetRange[0];
  elTarget.innerText = targetNum;
}

function resetCurrent() {
  currentSum = 0; bonusCombo = 0; isOver = false; drawnPaths = [];
  creatures.forEach(c => c.isCaptured = false);
  elOverMsg.style.display = 'none'; elCurrent.style.color = 'black';
  document.getElementById('current-sum-box').style.borderColor = '#ccc';
  updateUI();
}

function updateUI() { elScore.innerText = score; elCurrent.innerText = currentSum; }

function startDraw(e) { if (!isPlaying) return; isDrawing = true; currentPath = []; addPoint(e); }
function moveDraw(e) { if (!isDrawing) return; addPoint(e); }
function endDraw() {
  if (!isDrawing) return; isDrawing = false;
  if (currentPath.length > 5) { drawnPaths.push(currentPath); checkEnclosure(currentPath); }
  currentPath = [];
}
function addPoint(e) {
  e.preventDefault();
  let x = e.touches ? e.touches[0].clientX : e.clientX;
  let y = e.touches ? e.touches[0].clientY : e.clientY;
  currentPath.push({ x, y });
}

canvas.addEventListener('mousedown', startDraw); canvas.addEventListener('mousemove', moveDraw); window.addEventListener('mouseup', endDraw);
canvas.addEventListener('touchstart', startDraw, { passive: false }); canvas.addEventListener('touchmove', moveDraw, { passive: false }); window.addEventListener('touchend', endDraw);
btnReset.addEventListener('click', () => resetCurrent());

stageBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const stage = parseInt(btn.getAttribute('data-stage'));
    initGame(stage);
  });
});

// 「ぐるり算とは」モーダルの制御
const aboutModal = document.getElementById('about-modal');
const aboutBtn = document.getElementById('about-btn');
const closeAboutBtn = document.getElementById('close-about-btn');

aboutBtn.addEventListener('click', () => {
  aboutModal.style.display = 'flex';
  // オーディオコンテキストの有効化
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  } else if (!audioCtx) {
    loadSESounds();
  }
});

closeAboutBtn.addEventListener('click', () => {
  aboutModal.style.display = 'none';
});

// --- 追加: ランキング & 設定ロジック ---
const rankingModal = document.getElementById('ranking-modal');
const rankingListEl = document.getElementById('ranking-list');
const nameInputModal = document.getElementById('name-input-modal');
const settingsMenuModal = document.getElementById('settings-menu-modal');

// ランキング保存
function saveScore(name, stage, score) {
  let ranking = JSON.parse(localStorage.getItem(`gururizan_ranking_${stage}`)) || [];
  ranking.push({ name: name || "ななし", score: score, date: new Date().getTime() });
  ranking.sort((a, b) => b.score - a.score);
  ranking = ranking.slice(0, 20); // 20位まで
  localStorage.setItem(`gururizan_ranking_${stage}`, JSON.stringify(ranking));
}

// ランキング表示
function showRanking(stage) {
  const ranking = JSON.parse(localStorage.getItem(`gururizan_ranking_${stage}`)) || [];
  rankingListEl.innerHTML = '';

  if (ranking.length === 0) {
    rankingListEl.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">データがありません</div>';
  } else {
    ranking.forEach((item, idx) => {
      // XSS対策: 名前をエスケープして表示
      const safeName = item.name.replace(/[&<>"']/g, function (match) {
        return {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        }[match];
      });
      const row = document.createElement('div');
      row.className = 'ranking-item';
      row.innerHTML = `
        <span class="ranking-rank">${idx + 1}</span>
        <span class="ranking-name">${safeName}</span>
        <span class="ranking-score">${item.score}</span>
      `;
      rankingListEl.appendChild(row);
    });
  }

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.stage) === stage);
  });
  rankingModal.style.display = 'flex';
}

// イベントリスナー登録
document.getElementById('submit-score-btn').addEventListener('click', () => {
  const name = document.getElementById('player-name').value;
  saveScore(name, currentStage, score);
  nameInputModal.style.display = 'none';
  overlay.style.display = 'flex';
  showRanking(currentStage);
});

document.getElementById('cancel-score-btn').addEventListener('click', () => {
  nameInputModal.style.display = 'none';
  overlay.style.display = 'flex';
});

document.getElementById('settings-btn').addEventListener('click', () => {
  settingsMenuModal.style.display = 'flex';
});

document.getElementById('close-settings-btn').addEventListener('click', () => {
  settingsMenuModal.style.display = 'none';
});

document.getElementById('toggle-sound-btn').addEventListener('click', function () {
  isSoundOn = !isSoundOn;
  this.innerText = `${isSoundOn ? '🔊' : '🔈'} 音量: ${isSoundOn ? 'ON' : 'OFF'}`;
  if (!isSoundOn) {
    bgm.pause();
  } else {
    if (isPlaying) bgm.play();
  }
});

document.getElementById('view-ranking-btn').addEventListener('click', () => {
  settingsMenuModal.style.display = 'none';
  showRanking(currentStage);
});

document.getElementById('close-ranking-btn').addEventListener('click', () => {
  rankingModal.style.display = 'none';
});

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    showRanking(parseInt(btn.dataset.stage));
  });
});

document.getElementById('back-to-title-btn').addEventListener('click', () => {
  settingsMenuModal.style.display = 'none';
  isPlaying = false;
  clearInterval(timerInterval);
  bgm.pause();
  overlay.style.display = 'flex';
});

document.getElementById('tutorial-btn').addEventListener('click', () => {
  initGame(1, true); // ステージ1設定ベースでチュートリアル開始
});

document.getElementById('tutorial-end-btn').addEventListener('click', () => {
  document.getElementById('tutorial-layer').style.display = 'none';
  document.getElementById('tutorial-mask').style.display = 'none';
  document.body.classList.remove('tutorial-active');
  overlay.style.display = 'flex';
  isPlaying = false;
  bgm.pause();
});

function isPointInPath(x, y, pathCoords) {
  let inside = false;
  for (let i = 0, j = pathCoords.length - 1; i < pathCoords.length; j = i++) {
    let xi = pathCoords[i].x, yi = pathCoords[i].y;
    let xj = pathCoords[j].x, yj = pathCoords[j].y;
    if (((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function checkEnclosure(path) {
  // isOver であっても、菱形を囲んで数値を減らすために判定を継続します
  let newlyCaptured = [];

  creatures.forEach(c => {
    if (!c.isCaptured && isPointInPath(c.segments[0].x, c.segments[0].y, path)) {
      c.isCaptured = true;
      newlyCaptured.push(c);
    }
  });

  if (newlyCaptured.length > 0) {
    let sumChange = newlyCaptured.reduce((sum, c) => {
      return sum + (c.type === 'rhombus' ? -c.value : c.value);
    }, 0);
    currentSum += sumChange;
    if (currentSum < 0) currentSum = 0;

    // 数値が減って目標値以下になったなら OVER 状態を解除
    if (currentSum <= targetNum) {
      isOver = false;
      elOverMsg.style.display = 'none';
      elCurrent.style.color = 'black';
      document.getElementById('current-sum-box').style.borderColor = '#ccc';
    }

    if (currentSum === targetNum) {
      // 1つの囲みで目標達成し、かつ2匹以上を同時に捕まえていた場合はボーナス
      if (drawnPaths.length === 1 && currentSum === sumChange && newlyCaptured.length >= 2) {
        bonusCombo++;
        score += targetNum * 2 * bonusCombo;
        showBonus(bonusCombo); // HITOFUDEボーナス表示
      } else {
        bonusCombo = 0;
        score += targetNum;
      }

      let rect = elTargetBox.getBoundingClientRect();
      let targetX = rect.left + rect.width / 2;
      let targetY = rect.top + rect.height / 2;

      // 揃った時に数字の場所からキラキラを出す
      createParticles(targetX, targetY, 30);

      // 吸い寄せ開始のSE
      playSE('energy');

      let toAbsorb = creatures.filter(c => c.isCaptured);
      toAbsorb.forEach(c => {
        c.startAbsorb(targetX, targetY);
        absorbingCreatures.push(c);
      });

      creatures = creatures.filter(c => !c.isCaptured);

      elTargetBox.classList.remove('glow-pop');
      void elTargetBox.offsetWidth;
      elTargetBox.classList.add('glow-pop');

      let needed = 15 - creatures.length;
      for (let i = 0; i < needed; i++) creatures.push(new Creature());

      // 囲みをフェードアウトさせるために fadingPaths へ移動
      drawnPaths.forEach(path => {
        fadingPaths.push({ points: path, alpha: 1.0 });
      });

      currentSum = 0; drawnPaths = [];

      if (isTutorial) {
        if (tutorialStep === 1) {
          tutorialStep = 2;
          targetNum = 8;
          elTarget.innerText = targetNum;
          document.getElementById('tutorial-text').innerHTML = "間違えて囲ってしまった時は「やり直す」ボタン<br><span class='eng-sub'>If you enclose the wrong balls, use the 'Retry' button</span>";
          // ステップ2用にクリーチャー補充（少なくとも2つは4を出す）
          creatures = [];
          for (let i = 0; i < 8; i++) {
            // 第1引数に数値を指定することで、その数値と節の数を一致させる
            let c = new Creature(i < 2 ? 4 : null, true);
            creatures.push(c);
          }
        } else if (tutorialStep === 2) {
          tutorialStep = 3;
          setTimeout(() => {
            document.getElementById('tutorial-text').innerHTML = "チュートリアルは以上です<br><span class='eng-sub'>Tutorial Completed</span>";
            document.getElementById('tutorial-end-btn').style.display = 'inline-block';
          }, 1000);
        }
      } else {
        setNewTarget();
      }

    } else if (currentSum > targetNum) {
      isOver = true;
      elOverMsg.style.display = 'inline';
      elCurrent.style.color = 'red';
      document.getElementById('current-sum-box').style.borderColor = 'red';
    }

    updateUI();
  }
}

function loop(timestamp) {
  if (!isPlaying) return;
  requestAnimationFrame(loop);

  if (!timestamp) timestamp = performance.now();
  const deltaTime = timestamp - lastTime;

  if (deltaTime < frameInterval) return;

  lastTime = timestamp - (deltaTime % frameInterval);

  ctx.clearRect(0, 0, width, height);

  ctx.lineWidth = 8;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  drawnPaths.forEach(path => {
    ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.strokeStyle = 'rgba(0, 100, 255, 0.7)';
    ctx.stroke();
  });

  if (isDrawing && currentPath.length > 0) {
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(currentPath[0].x, currentPath[0].y);
    for (let i = 1; i < currentPath.length; i++) ctx.lineTo(currentPath[i].x, currentPath[i].y);
    ctx.strokeStyle = 'rgba(0, 150, 255, 0.4)';
    ctx.stroke();
  }

  // フェードアウトする囲みの描画
  fadingPaths.forEach((fp, index) => {
    ctx.globalAlpha = fp.alpha;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(fp.points[0].x, fp.points[0].y);
    for (let i = 1; i < fp.points.length; i++) ctx.lineTo(fp.points[i].x, fp.points[i].y);
    ctx.strokeStyle = 'rgba(0, 100, 255, 0.7)';
    ctx.stroke();
    fp.alpha -= 0.05;
  });
  fadingPaths = fadingPaths.filter(fp => fp.alpha > 0);
  ctx.globalAlpha = 1.0;

  // ====== アニメーションの更新順序 ======
  // 1. 頭の移動（速度＆吸い込み軌道計算）
  creatures.forEach(c => c.updateMotion());
  absorbingCreatures.forEach(c => c.updateMotion());

  // 2. 丸同士の重なりを押し出す（吸い込まれ中はすり抜けるので盤面のcreaturesのみ）
  resolveCollisions();

  // 3. 後ろの節（体）を頭に追従させる
  creatures.forEach(c => c.updateSegments());
  absorbingCreatures.forEach(c => c.updateSegments());

  // 描画
  creatures.forEach(c => c.draw());
  absorbingCreatures.forEach(c => c.draw());

  drawParticles(); // 最後に描画して数字（UI）より手前に出す

  absorbingCreatures = absorbingCreatures.filter(c => !c.dead);
}
