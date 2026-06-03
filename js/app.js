/**
 * app.js v11
 *
 * CORREÇÕES:
 *  - Pista 3 redesenhada (sem auto-interseção, estilo F1/Interlagos).
 *  - Modo Corrida: a cada 6 gerações avança pista automaticamente.
 *  - Após completar as 3 pistas (18 gen), exibe modal de evolução genética
 *    mostrando sobreviventes por pista e gráfico de evolução.
 *  - Pista centralizada; sensores com origem correta.
 */
(function () {
  const canvas = document.getElementById("sim-canvas");
  const visualizer = new Visualizer(canvas);
  const storage = new StorageManager();
  window.storageInstance = storage;

  const trackNames = ["Mônaco", "Monza", "Interlagos"];

  let track = new Track(0); if (visualizer) visualizer._trackCache = null;
  let ga = new GeneticAlgorithm();
  let running = true;
  let paused = false;
  let simSpeed = 1;
  let turboMode = false;
  let frameTimeAvg = 16;

  let accumulatedSteps = 0;
  let maxStepsPerFrame = 12;
  let speedAccumulator = 0;

  let currentMode = 'train';
  let manualCar = null;
  const keys = {};

  // ── Estado do modo Corrida ────────────────────────────────────────────
  let raceTrackIdx = 0;   // pista atual (0/1/2)
  let raceGeneration = 1;   // geração global da corrida
  // Sobreviventes (completadores) por geração, por pista
  const raceSurvivorsByTrack = { 0: [], 1: [], 2: [] };

  // ── Estado do modo Treinar ────────────────────────────────────────────
  const historicoGeracoes = { pista0: "N/A", pista1: "N/A", pista2: "N/A" };
  const sobreviventesPorPista = { 0: [], 1: [], 2: [] };
  const completadoresCiclo = { 0: 0, 1: 0, 2: 0 };
  const charts = { fitness: null, distance: null };

  // ── Charts ───────────────────────────────────────────────────────────
  function initCharts() {
    const fitCtx = document.getElementById("chart-fitness");
    const distCtx = document.getElementById("chart-distance");
    if (!fitCtx || !distCtx || typeof Chart === "undefined") return;

    charts.fitness = new Chart(fitCtx, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "Melhor fitness", data: [], borderColor: "#ffd700", tension: 0.2, fill: false },
          { label: "Média populacional", data: [], borderColor: "#4a9eff", tension: 0.2, fill: false },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#8899aa", font: { size: 10 } } } },
        scales: { x: { ticks: { color: "#8899aa" } }, y: { ticks: { color: "#8899aa" } } }
      },
    });

    charts.distance = new Chart(distCtx, {
      type: "line",
      data: {
        labels: [],
        datasets: [{ label: "Completadores/geração", data: [], borderColor: "#00ffaa", tension: 0.2, fill: false }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#8899aa", font: { size: 10 } } } },
        scales: { x: { ticks: { color: "#8899aa" } }, y: { ticks: { color: "#8899aa" } } }
      },
    });
  }

  function updateCharts(gen, bestFit, avgFit, completors) {
    if (!charts.fitness || !charts.distance) return;
    charts.fitness.data.labels.push(gen);
    charts.fitness.data.datasets[0].data.push(bestFit);
    charts.fitness.data.datasets[1].data.push(avgFit);
    charts.fitness.update();
    charts.distance.data.labels.push(gen);
    charts.distance.data.datasets[0].data.push(completors);
    charts.distance.update();
  }

  // ── HUD ──────────────────────────────────────────────────────────────
  function updateHUD() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };

    if (currentMode === 'manual') {
      const car = manualCar;
      const cp = car ? car.checkpointIndex : 0;
      const spd = car ? Math.round(car.speed * 35) : 0;
      const alive = car ? car.alive : false;
      set("manual-cp", cp);
      set("manual-speed", spd + " km/h");
      set("manual-gear",  car && car._gear ? `${car._gear}ª` : "1ª");
      set("manual-status", alive ? "🟢 Vivo" : (car && car.completed ? "🏆 Completou!" : "💥 Colisão"));
      const ms = document.getElementById("manual-status");
      if (ms) ms.style.color = alive ? "#00ffaa" : (car && car.completed ? "#ffd700" : "#ff4444");
      set("hud-generation", "—");
      set("hud-alive", "1");
      set("hud-best-fitness", "—");
      set("hud-best-distance", cp);
      set("hud-track", trackNames[track.index] || "—");
      set("hud-completors", "—");
      set("hud-mode", "Manual");
      set("hud-speed", "—");
      updateSpeedometer(spd, car && car._gear ? car._gear : 1);
    } else if (currentMode === 'race') {
      const genNaPista = ((raceGeneration - 1) % 6) + 1;
      set("hud-generation", `${raceGeneration} (${genNaPista}/6)`);
      set("hud-alive", ga.population.filter(c => c.alive).length);
      set("hud-best-fitness", Math.round(ga.stats?.bestFitness || 0));
      set("hud-best-distance", ga.stats?.bestDistance || 0);
      set("hud-track", `${trackNames[track.index]} (pista ${raceTrackIdx + 1}/3)`);
      set("hud-completors", ga.stats?.completorsThisGen || 0);
      set("hud-mode", "Corrida 🏁");
      set("hud-speed", turboMode ? "Turbo⚡" : simSpeed + "×");
      const best = ga.getBestCar();
      updateSpeedometer(best && best.alive ? Math.round(best.speed * 35) : 0);
    } else {
      set("hud-generation", ga.generation);
      set("hud-alive", ga.population.filter(c => c.alive).length);
      set("hud-best-fitness", Math.round(ga.stats?.bestFitness || 0));
      set("hud-best-distance", ga.stats?.bestDistance || 0);
      set("hud-track", trackNames[track.index] || "—");
      set("hud-completors", ga.stats?.completorsThisGen || 0);
      set("hud-mode", "Treinar 🧬");
      set("hud-speed", turboMode ? "Turbo⚡" : simSpeed + "×");
      const best = ga.getBestCar();
      updateSpeedometer(best && best.alive ? Math.round(best.speed * 35) : 0);
    }

    updateStorageStatus();
  }

  function updateSpeedometer(speedKmH, gear) {
    const el = document.getElementById("speed-value");
    if (el) el.innerText = speedKmH;
    const needle = document.getElementById("dial-needle");
    if (needle) {
      const deg = -135 + (Math.min(230, speedKmH) / 230) * 270;
      needle.style.transform = `rotate(${deg}deg)`;
    }
    // Gear HUD
    const gearHud = document.getElementById("gear-hud");
    const gearVal = document.getElementById("gear-value");
    if (gearHud && gearVal) {
      if (gear !== undefined && gear !== null) {
        gearHud.style.display = "flex";
        gearVal.innerText = gear + "ª";
      } else {
        gearHud.style.display = "none";
      }
    }
  }

  function updateStorageStatus() {
    const s = storage.getStatus();
    [0, 1, 2].forEach(i => {
      const el = document.getElementById(`storage-track${i}`);
      if (!el) return;
      const n = s.completionsByTrack[i] || 0;
      const done = s.completedTracks.includes(i);
      el.innerText = n + " completador(es)" + (done ? " ✅" : "");
      el.style.color = done ? "#00ffaa" : "#aaa";
    });
    const uEl = document.getElementById("storage-universal");
    if (uEl) {
      uEl.innerText = s.universalCount + " universal(is)";
      uEl.style.color = s.universalCount > 0 ? "#ffd700" : "#aaa";
    }
  }

  // ── UI de modo ────────────────────────────────────────────────────────
  function applyModeUI(mode) {
    currentMode = mode;
    const banner = document.getElementById("mode-banner");
    const bannerText = document.getElementById("mode-banner-text");
    const bannerHint = document.getElementById("mode-banner-hint");

    banner.className = "mode-banner";
    if (mode === 'manual') {
      banner.classList.add("mode-manual");
      bannerText.textContent = "🎮 MODO MANUAL — Controle Direto";
      bannerHint.textContent = "WASD ou ↑←↓→ para dirigir · R para reiniciar";
      document.getElementById("panel-championship")?.style.setProperty("display", "none");
      document.getElementById("panel-ga-settings")?.style.setProperty("display", "none");
      document.getElementById("panel-charts")?.style.setProperty("display", "none");
      document.getElementById("panel-charts2")?.style.setProperty("display", "none");
      document.getElementById("panel-sensors")?.style.setProperty("display", "none");
      document.getElementById("panel-manual-info").style.display = "";
      document.getElementById("manual-controls")?.classList.remove("hidden");
    } else if (mode === 'train') {
      banner.classList.add("mode-train");
      bannerText.textContent = "🧬 MODO TREINAR — Algoritmo Genético Ativo";
      bannerHint.textContent = "200 carros evoluindo · Use ⚡ Turbo para acelerar";
      document.getElementById("panel-championship")?.style.removeProperty("display");
      document.getElementById("panel-ga-settings")?.style.removeProperty("display");
      document.getElementById("panel-charts")?.style.removeProperty("display");
      document.getElementById("panel-charts2")?.style.removeProperty("display");
      document.getElementById("panel-sensors")?.style.removeProperty("display");
      document.getElementById("panel-manual-info").style.display = "none";
      document.getElementById("manual-controls")?.classList.add("hidden");
    } else if (mode === 'race') {
      banner.classList.add("mode-race");
      bannerText.textContent = "🏁 MODO CORRIDA — GA nas 3 Pistas (6 gen cada)";
      bannerHint.textContent = "Avança automaticamente · Mutação entre pistas · Veja a evolução!";
      document.getElementById("panel-championship")?.style.setProperty("display", "none");
      document.getElementById("panel-ga-settings")?.style.setProperty("display", "none");
      document.getElementById("panel-charts")?.style.setProperty("display", "none");
      document.getElementById("panel-charts2")?.style.setProperty("display", "none");
      document.getElementById("panel-sensors")?.style.removeProperty("display");
      document.getElementById("panel-manual-info").style.display = "none";
      document.getElementById("manual-controls")?.classList.add("hidden");
    }
  }

  // ── Modo Manual ───────────────────────────────────────────────────────
  function startManualMode() {
    applyModeUI('manual');
    const dummyBrain = new NeuralNetwork();
    manualCar = new (window.Car)(dummyBrain, track, { generation: 1 });
    manualCar._isManual = true;
    paused = false;
    showToast("🎮 Modo Manual! Use WASD ou setas para dirigir.");
  }

  function updateManualCar() {
    if (!manualCar) return;
    if (!manualCar.alive && !manualCar.completed) return;

    const accel     = keys["ArrowUp"]    || keys["KeyW"] || keys["w"] || keys["W"];
    const brake     = keys["ArrowDown"]  || keys["KeyS"] || keys["s"] || keys["S"];
    const left      = keys["ArrowLeft"]  || keys["KeyA"] || keys["a"] || keys["A"];
    const right     = keys["ArrowRight"] || keys["KeyD"] || keys["d"] || keys["D"];
    const handbrake = keys["Space"];

    setKeyIndicator("key-up",    accel);
    setKeyIndicator("key-down",  brake);
    setKeyIndicator("key-left",  left);
    setKeyIndicator("key-right", right);
    setKeyIndicator("key-space", handbrake);

    // ── Inicializar estado de marchas no carro manual ─────────────────
    if (!manualCar._gear) {
      manualCar._gear = 1;
      manualCar._gearRatios = [0, 1.0, 1.8, 2.8, 3.8, 5.0, 6.0];
      manualCar._driftAngle = 0;
    }

    // Projetamos a velocidade global nos eixos locais do carro
    let vForward = manualCar.vx * Math.cos(manualCar.angle) + manualCar.vy * Math.sin(manualCar.angle);
    let vLateral = -manualCar.vx * Math.sin(manualCar.angle) + manualCar.vy * Math.cos(manualCar.angle);

    const isMoving = Math.abs(vForward) > 0.1;

    // ── Aceleração gradual com marchas (0→100 ~4s a 60fps) ───────────
    if (accel && !handbrake) {
      const gearMax = manualCar._gearRatios[manualCar._gear];
      if (vForward < gearMax) {
        vForward += 0.04;
      }
      if (vForward >= gearMax * 0.95 && manualCar._gear < 6) {
        manualCar._gear++;
      }
    } else if (!accel) {
      if (vForward < manualCar._gearRatios[Math.max(1, manualCar._gear - 1)] * 0.5 && manualCar._gear > 1) {
        manualCar._gear--;
      }
    }

    // ── S freia (sem ré) ──────────────────────────────────────────────
    if (brake && !handbrake) {
      vForward -= 0.12;
      if (vForward < 0) vForward = 0;
    }

    // Esterçamento baseado em velocidade frontal
    let actualSteer = 0;
    if (isMoving && vForward > 0.8) {
      const speedRatio = Math.min(1, vForward / manualCar.maxSpeed);
      const steerAngle = 0.09 - speedRatio * 0.035;
      if (left)  actualSteer = -steerAngle;
      if (right) actualSteer = steerAngle;
      manualCar.angle += actualSteer;
    }

    // Freio de mão com deriva de ângulo de derrapagem (oversteer)
    if (handbrake && isMoving) {
      vForward *= 0.88; // trava as rodas traseiras
      manualCar._driftAngle += (left ? -0.040 : right ? 0.040 : 0); // deriva o ângulo
      if (Math.abs(manualCar._driftAngle) > 0.22) {
        manualCar._driftAngle *= 0.94; // amortece deriva excessiva
      }
    } else {
      manualCar._driftAngle *= 0.82; // recupera grip gradualmente
    }

    // Aplica deriva do freio de mão ao ângulo
    manualCar.angle += manualCar._driftAngle;

    // Fricções e Derrapagem lateral
    vForward *= (1 - 0.03); // fricção frontal padrão
    if (Math.abs(vForward) < 0.01) vForward = 0;

    // Se pressionado freio de mão, aderência cai bruscamente; se virando acentuadamente, também desliza
    const isTurning = Math.abs(actualSteer + manualCar._driftAngle) > 0.02;
    const grip = handbrake ? 0.02 : (isTurning ? 0.07 : 0.18);
    vLateral *= (1 - grip);
    if (Math.abs(vLateral) < 0.01) vLateral = 0;

    // Reconstrução do vetor global de velocidade
    manualCar.vx = vForward * Math.cos(manualCar.angle) - vLateral * Math.sin(manualCar.angle);
    manualCar.vy = vForward * Math.sin(manualCar.angle) + vLateral * Math.cos(manualCar.angle);

    // Limite de velocidade global
    const globalSpeed = Math.hypot(manualCar.vx, manualCar.vy);
    if (globalSpeed > manualCar.maxSpeed) {
      manualCar.vx *= manualCar.maxSpeed / globalSpeed;
      manualCar.vy *= manualCar.maxSpeed / globalSpeed;
    }

    manualCar.speed = Math.hypot(manualCar.vx, manualCar.vy);

    manualCar.x += manualCar.vx;
    manualCar.y += manualCar.vy;

    // Skid marks por derrapagem lateral ou esterçamento acentuado
    if (handbrake || Math.abs(vLateral) > 0.4 || Math.abs(actualSteer + manualCar._driftAngle) > 0.03) {
      manualCar.skidMarks = manualCar.skidMarks || [];
      manualCar.skidMarks.push({ x: manualCar.x, y: manualCar.y });
      if (manualCar.skidMarks.length > 60) manualCar.skidMarks.shift();
    }

    manualCar.timeAlive++;
    manualCar.totalSpeed += Math.max(0, manualCar.speed);

    if (!track.isInsideTrack(manualCar.x, manualCar.y)) {
      manualCar.alive = false;
      showToast("💥 Colisão! Pressione R para reiniciar.");
      return;
    }
    for (const obs of track.obstacles) {
      if (Math.hypot(manualCar.x - obs.x, manualCar.y - obs.y) < (obs.radius + 6)) {
        manualCar.alive = false;
        showToast("💥 Bateu num obstáculo! R para reiniciar.");
        return;
      }
    }

    const finishCPIdx = track.finishCPIndex != null ? track.finishCPIndex : track.checkpoints.length - 1;
    const totalCPs = finishCPIdx + 1;
    const nextCP   = track.checkpoints[Math.min(manualCar.checkpointIndex + 1, finishCPIdx)];

    // Detecção por cruzamento de linha (igual ao car.js)
    const cpFwdX  = Math.cos(nextCP.angle);
    const cpFwdY  = Math.sin(nextCP.angle);
    const toCPx   = nextCP.x - manualCar.x;
    const toCPy   = nextCP.y - manualCar.y;
    const fwdDist = toCPx * cpFwdX + toCPy * cpFwdY;
    const latDist = Math.abs(-toCPx * cpFwdY + toCPy * cpFwdX);

    const withinLat   = latDist < track.width * 0.55;
    const crossedLine = fwdDist <= 0;
    const veryClose   = Math.hypot(toCPx, toCPy) < track.width * 0.35;

    if (withinLat && crossedLine) {

    manualCar.checkpointIndex++;

    if (manualCar.checkpointIndex >= finishCPIdx) {

        manualCar.checkpointIndex = finishCPIdx;

        manualCar.completed = true;
        manualCar.alive = false;

        showToast("🏁 Pista completada! Parabéns  🏆 !!");
    }
}
    manualCar.castSensors(track);
  }

  function setKeyIndicator(id, active) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("pressed", !!active);
  }

  // ── Modal de evolução da Corrida ──────────────────────────────────────
  function exibirModalEvolucaoCorrida(onClose) {
    const modal = document.getElementById("modal-race-evolution");
    if (!modal) {
      // Cria o modal dinamicamente se não existir no HTML
      _criarModalEvolucao();
      return exibirModalEvolucaoCorrida(onClose);
    }

    // Preenche dados de sobreviventes por pista
    [0, 1, 2].forEach(pIdx => {
      const data = raceSurvivorsByTrack[pIdx] || [];
      const total = data.reduce((s, v) => s + v, 0);
      const max = Math.max(...data, 1);
      const first = data[0] || 0;
      const last = data[data.length - 1] || 0;
      const delta = last - first;

      const el = id => document.getElementById(id);

      if (el(`race-evo-track${pIdx}-total`))
        el(`race-evo-track${pIdx}-total`).textContent = total;
      if (el(`race-evo-track${pIdx}-delta`)) {
        const deltaEl = el(`race-evo-track${pIdx}-delta`);
        deltaEl.textContent = (delta >= 0 ? "+" : "") + delta + " na última gen";
        deltaEl.style.color = delta > 0 ? "#00ffaa" : delta < 0 ? "#ff6666" : "#aaa";
      }

      // Mini barras de evolução
      const barsEl = el(`race-evo-track${pIdx}-bars`);
      if (barsEl) {
        barsEl.innerHTML = "";
        data.forEach((v, i) => {
          const pct = Math.round((v / max) * 100);
          const bar = document.createElement("div");
          bar.style.cssText = `
            display:inline-block; width:14px; height:${Math.max(4, pct * 0.6)}px;
            background:${i === data.length - 1 ? "#00ffaa" : "#4a9eff"};
            margin:0 1px; vertical-align:bottom; border-radius:2px 2px 0 0;
            transition:height 0.4s;`;
          bar.title = `Gen ${i + 1}: ${v} sobreviventes`;
          barsEl.appendChild(bar);
        });
      }
    });

    // Conclusão geral
    const totalGeral = [0, 1, 2].reduce((s, i) => s + (raceSurvivorsByTrack[i] || []).reduce((a, b) => a + b, 0), 0);
    const genEvo = [0, 1, 2].map(i => {
      const d = raceSurvivorsByTrack[i] || [];
      return d.length >= 2 ? d[d.length - 1] - d[0] : 0;
    });
    const evoluiu = genEvo.some(v => v > 0);

    const conclusaoEl = document.getElementById("race-evo-conclusao");
    if (conclusaoEl) {
      if (evoluiu) {
        const melhorPista = genEvo.indexOf(Math.max(...genEvo));
        conclusaoEl.innerHTML = `
          🧬 <strong>Evolução detectada!</strong> Em ${trackNames[melhorPista]} o número de
          sobreviventes cresceu <strong>${genEvo[melhorPista] > 0 ? "+" : ""}${genEvo[melhorPista]}</strong>
          da 1ª para a 6ª geração. Total de completadores: <strong>${totalGeral}</strong>.`;
        conclusaoEl.style.color = "#00ffaa";
      } else {
        conclusaoEl.innerHTML = `
          🔬 Total de completadores: <strong>${totalGeral}</strong>. As populações precisam de mais
          gerações para convergir — tente treinar antes de correr!`;
        conclusaoEl.style.color = "#aaa";
      }
    }

    const btnClose = document.getElementById("btn-race-evo-fechar");
    if (btnClose) btnClose.onclick = () => {
      modal.style.display = "none";
      if (typeof onClose === "function") onClose();
    };

    paused = true;
    modal.style.display = "flex";
  }

  function _criarModalEvolucao() {
    const modal = document.createElement("div");
    modal.id = "modal-race-evolution";
    modal.style.cssText = `
      display:none; position:fixed; top:0; left:0; width:100%; height:100%;
      background:rgba(0,0,0,0.88); z-index:10000;
      justify-content:center; align-items:center; font-family:sans-serif;`;

    const pistas = [0, 1, 2].map(i => `
      <div style="background:#111; border-radius:8px; padding:14px 18px; margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-size:15px; font-weight:bold; color:#fff;">${["🏎️", "⚡", "🌀"][i]} ${trackNames[i]}</span>
          <span id="race-evo-track${i}-delta" style="font-size:12px; color:#aaa;"></span>
        </div>
        <div style="display:flex; align-items:flex-end; height:50px; gap:0; margin-bottom:6px;"
             id="race-evo-track${i}-bars"></div>
        <div style="font-size:11px; color:#8899aa;">
          Total de sobreviventes: <strong style="color:#ffd700;" id="race-evo-track${i}-total">0</strong>
        </div>
      </div>`).join("");

    modal.innerHTML = `
      <div style="background:#1a1f2e; color:#fff; padding:32px; border-radius:14px;
                  border:2px solid #ffd700; max-width:500px; width:92%;
                  box-shadow:0 0 40px rgba(255,215,0,0.25); text-align:center;">
        <div style="font-size:40px; margin-bottom:6px;">🧬</div>
        <h2 style="color:#ffd700; margin:0 0 4px 0; font-size:22px;">Corrida Completa!</h2>
        <p style="color:#8899aa; margin:0 0 22px 0; font-size:13px;">
          3 pistas × 6 gerações — Evolução Genética em Evidência
        </p>

        <div style="text-align:left;">${pistas}</div>

        <div id="race-evo-conclusao" style="
          background:#0d1117; border:1px solid #333; border-radius:8px;
          padding:14px 16px; margin:16px 0; font-size:13px; line-height:1.6; text-align:left;">
        </div>

        <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-top:8px;">
          <button onclick="window.storageInstance && window.storageInstance.exportToFile(); this.innerText='✅ Exportado!'"
                  style="background:#00ffaa; color:#000; border:none; padding:11px 18px;
                         border-radius:6px; font-weight:bold; cursor:pointer; font-size:13px;">
            ⬇ Exportar Campeões
          </button>
          <button id="btn-race-evo-fechar"
                  style="background:#333; color:#fff; border:1px solid #555;
                         padding:11px 18px; border-radius:6px; font-weight:bold; cursor:pointer; font-size:13px;">
            🔄 Nova Corrida
          </button>
        </div>
      </div>`;

    document.body.appendChild(modal);
  }

  // ── Loop principal ────────────────────────────────────────────────────
  function simulationStep() {
    const frameStart = performance.now();
    if (!running) return;

    if (!paused) {
      if (currentMode === 'manual') {
        updateManualCar();
      } else {
        // ── Velocidade: steps por frame ─────────────────────────────────
        // 1×=1  2×=2  3×=3  5×=5  10×=10  Turbo=20
        // Em velocidades altas renderizamos menos frames para fluidez
        const stepsThisFrame = turboMode ? 20
          : simSpeed === 10 ? 10
          : simSpeed === 5  ?  5
          : simSpeed === 3  ?  3
          : simSpeed === 2  ?  2
          : 1;

        for (let step = 0; step < stepsThisFrame; step++) {
          let anyAlive = false;

          ga.population.forEach(car => {
            if (!car.alive && !car.completed) return;
            if (car.completed) return;
            car.update(track);
            if (car.alive) anyAlive = true;

            if (car.completed) {
              car.computeFitness(track);
              storage.saveChampion(car, track.index, currentMode === 'race' ? raceGeneration : ga.generation);
              if (currentMode === 'train') {
                historicoGeracoes["pista" + track.index] = ga.generation;
                showToast(`🏆 ${trackNames[track.index].toUpperCase()} COMPLETADA! Gen ${ga.generation}`);
              }
              updateStorageStatus();
            }
          });

          if (anyAlive) continue;
          if (ga.population.filter(c => c.alive).length > 0) continue;

          // ── GERAÇÃO ACABOU ─────────────────────────────────────────────

          if (currentMode === 'race') {
            // Conta sobreviventes desta geração
            ga.population.forEach(car => car.computeFitness(track));
            const completors = ga.population.filter(c => c.completed).length;
            raceSurvivorsByTrack[raceTrackIdx].push(completors);

            // Geração local dentro da pista atual (1..6)
            const genNaPista = ((raceGeneration - 1) % 6) + 1;

            if (genNaPista < 6) {
              // Ainda não chegou nas 6 gen — evolui na mesma pista
              const stats = ga.evolve(track, track);
              ga.stats = stats;
              raceGeneration++;
              showToast(`🏁 Gen ${raceGeneration} na ${trackNames[raceTrackIdx]} — ${completors} sobreviveram`);
            } else {
              // Completou 6 gen nesta pista — avança para próxima
              const nextIdx = raceTrackIdx + 1;

              if (nextIdx >= 3) {
                // Todas as 3 pistas completas → exibe modal de evolução
                showToast("🏆 CORRIDA COMPLETA! 3 pistas × 6 gerações!");
                paused = true;
                setTimeout(() => exibirModalEvolucaoCorrida(() => {
                  // Reset para nova corrida
                  [0, 1, 2].forEach(i => { raceSurvivorsByTrack[i] = []; });
                  raceGeneration = 1;
                  raceTrackIdx = 0;
                  track = new Track(0); if (visualizer) visualizer._trackCache = null;
                  document.querySelectorAll("[data-track]").forEach(b => {
                    b.classList.toggle("active", parseInt(b.dataset.track, 10) === 0);
                  });
                  const allBrains = storage.getAllBestBrains();
                  ga = new GeneticAlgorithm({ populationSize: 200 });
                  ga.createRacePopulation(track, allBrains.length ? allBrains : null, storage.getGhostPath(0));
                  track.resetCheckpoints();
                  paused = false;
                  showToast("🔄 Nova corrida iniciada! Mônaco → Monza → Interlagos");
                }), 200);
                break;
              }

              // Avança para a próxima pista com evolução genética
              const nextTrack = new Track(nextIdx);
              const stats = ga.evolve(track, nextTrack);
              ga.stats = stats;
              raceGeneration++;
              raceTrackIdx = nextIdx;
              track = nextTrack;
              track.resetCheckpoints();

              document.querySelectorAll("[data-track]").forEach(b => {
                b.classList.toggle("active", parseInt(b.dataset.track, 10) === raceTrackIdx);
              });

              showToast(`🚀 Avançando → ${trackNames[raceTrackIdx]}! ${completors} sobreviveram em ${trackNames[nextIdx - 1]}`);
              updateStorageStatus();
            }
            break;
          }

          // ── MODO TREINAR ──────────────────────────────────────────────
          const autoProg = document.getElementById("chk-auto-progression")?.checked;
          let nextTrackIndex = track.index;
          let mustSwitchTrack = false;
          let championshipFinished = false;

          if (autoProg) {
            if (ga.generation === 6) { nextTrackIndex = 1; mustSwitchTrack = true; }
            else if (ga.generation === 12) { nextTrackIndex = 2; mustSwitchTrack = true; }
            else if (ga.generation === 18) { championshipFinished = true; }
          }

          if (championshipFinished) {
            ga.population.forEach(car => car.computeFitness(track));
            const compFinal = ga.population.filter(c => c.completed).length;
            completadoresCiclo[track.index] = (completadoresCiclo[track.index] || 0) + compFinal;
            sobreviventesPorPista[track.index].push({ gen: ga.generation, completors: compFinal });
            paused = true;
            historicoGeracoes["pista" + track.index] = ga.generation;
            updateStorageStatus();
            setTimeout(() => exibirPopUpCiclo(3, () => { setTimeout(exibirPopUpResumo, 300); }), 80);
            showToast("🏁 FIM DO CAMPEONATO! 18 gerações concluídas.");
            break;
          }

          let stats;
          if (mustSwitchTrack) {
            const nextTrack = new Track(nextTrackIndex);
            historicoGeracoes["pista" + track.index] = ga.generation;
            stats = ga.evolve(track, nextTrack);
            const compTroca = stats.completorsThisGen || 0;
            completadoresCiclo[track.index] = (completadoresCiclo[track.index] || 0) + compTroca;
            sobreviventesPorPista[track.index].push({ gen: ga.generation - 1, completors: compTroca });
            track = nextTrack;
            document.querySelectorAll("[data-track]").forEach(b => {
              b.classList.toggle("active", parseInt(b.dataset.track, 10) === nextTrackIndex);
            });
            showToast(`🚀 Avançando para ${trackNames[nextTrackIndex]}!`);
            setTimeout(() => exibirPopUpCiclo(nextTrackIndex), 80);
          } else {
            stats = ga.evolve(track, track);
            const compGen = stats.completorsThisGen || 0;
            completadoresCiclo[track.index] = (completadoresCiclo[track.index] || 0) + compGen;
            sobreviventesPorPista[track.index].push({ gen: ga.generation - 1, completors: compGen });
          }

          if ((ga.generation - 1) % 3 === 0) {
            updateCharts(
              ga.generation - 1,
              Math.round(stats.bestFitness),
              Math.round(stats.avgFitness),
              stats.completorsThisGen || 0
            );
          }
          const best = ga.getBestCar();
          if (best && !best.completed) storage.saveChampion(best, track.index, ga.generation - 1);
          break;
        }
      }
    }

    // Render
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (currentMode === 'manual') {
      visualizer.render(track, manualCar ? [manualCar] : [], manualCar, {
        paused, turboMode: false, showSensors: true, manualMode: true,
      });
    } else {
      const best = ga.getBestCar();
      visualizer.render(
        track,
        (turboMode || simSpeed > 5) ? [best] : ga.population,
        best,
        {
          paused,
          turboMode,
          fastMode: turboMode || simSpeed >= 10,
          showSensors: !turboMode
        }
      );
    }

    const now = performance.now();

    if (!window.__lastHudUpdate)
      window.__lastHudUpdate = 0;

    if (now - window.__lastHudUpdate > 150) {
      updateHUD();
      window.__lastHudUpdate = now;
    }
    requestAnimationFrame(simulationStep);
  }

  // ── Inicialização ─────────────────────────────────────────────────────
  function resetSimulation() {
    if (currentMode === 'manual') {
      startManualMode();
    } else if (currentMode === 'race') {
      const allBrains = storage.getAllBestBrains();
      if (!allBrains.length) {
        showToast("⚠️ Nenhum genoma salvo! Treine primeiro no modo Treinar.");
        return;
      }
      [0, 1, 2].forEach(i => { raceSurvivorsByTrack[i] = []; });
      raceGeneration = 1;
      raceTrackIdx = 0;
      track = new Track(0); if (visualizer) visualizer._trackCache = null;
      ga = new GeneticAlgorithm({ populationSize: 200 });
      ga.createRacePopulation(track, allBrains, storage.getGhostPath(0));
      track.resetCheckpoints();
      showToast(`🏁 MODO CORRIDA! 3 pistas × 6 gen — evolução ao vivo!`);
    } else {
      const seeds = storage.getSeedBrainsForTrack(track.index);
      const ghost = storage.getGhostPath(track.index);
      ga.createInitialPopulation(track, seeds.length ? seeds : null, ghost);
    }
    updateHUD();
  }

  // ── Modais do modo Treinar ────────────────────────────────────────────
  function exibirPopUpCiclo(cicloIdx, onClose) {
    const modal = document.getElementById("modal-ciclo");
    if (!modal) return;

    const cicloNomes = ["", "Mônaco", "Monza", "Interlagos"];
    const proximaNomes = ["", "Monza", "Interlagos", "Fim do Campeonato"];
    const icones = ["", "🏎️", "⚡", "🏆"];

    const pistaNome = cicloNomes[cicloIdx] || ("Pista " + cicloIdx);
    const proxNome = proximaNomes[cicloIdx] || "";
    const icone = icones[cicloIdx] || "🏁";
    const genInicio = (cicloIdx - 1) * 6 + 1;
    const genFim = cicloIdx * 6;

    const el = id => document.getElementById(id);
    if (el("mciclo-titulo")) el("mciclo-titulo").textContent = `Ciclo ${cicloIdx} Concluído!`;
    if (el("mciclo-subtitulo")) el("mciclo-subtitulo").textContent = `Gen. ${genInicio}–${genFim} — ${pistaNome}`;
    if (el("mciclo-icon")) el("mciclo-icon").textContent = icone;

    const container = el("mciclo-pistas");
    if (container) {
      container.innerHTML = "";
      const pistaLabels = ["Mônaco", "Monza", "Interlagos"];
      const maxComp = Math.max(1, ...pistaLabels.map((_, i) => completadoresCiclo[i] || 0));

      pistaLabels.forEach((nome, idx) => {
        const total = completadoresCiclo[idx] || 0;
        const isAtiva = idx === cicloIdx - 1;
        const isAnterior = idx < cicloIdx - 1;
        const isFutura = idx > cicloIdx - 1;

        const pct = isFutura ? 0 : Math.round((total / maxComp) * 100);
        const barClass = isAtiva ? "mciclo-barra-ativa" : isAnterior ? "mciclo-barra-anterior" : "mciclo-barra-inativa";
        const numClass = isAtiva ? "ativa" : isAnterior ? "anterior" : "inativa";
        const numText = isFutura ? "—" : total;

        const row = document.createElement("div");
        row.className = "mciclo-pista-row";
        row.innerHTML = `
          <span class="mciclo-pista-nome">${nome}</span>
          <div class="mciclo-barra-wrap ${barClass}">
            <div class="mciclo-barra-fill" style="width:0%" data-pct="${pct}"></div>
          </div>
          <span class="mciclo-pista-num ${numClass}">${numText}</span>`;
        container.appendChild(row);
      });

      requestAnimationFrame(() => {
        container.querySelectorAll(".mciclo-barra-fill").forEach(bar => {
          setTimeout(() => { bar.style.width = bar.dataset.pct + "%"; }, 80);
        });
      });
    }

    const insightEl = el("mciclo-insight");
    if (insightEl) {
      const hist = sobreviventesPorPista[cicloIdx - 1] || [];
      const totalAtual = completadoresCiclo[cicloIdx - 1] || 0;
      const totalGeral = Object.values(completadoresCiclo).reduce((a, b) => a + b, 0);
      let insight = "";
      if (hist.length >= 2) {
        const ganho = hist[hist.length - 1].completors - hist[0].completors;
        if (ganho > 0) {
          insight = `<strong>+${ganho}</strong> sobreviventes a mais na última geração — evolução real! 🧬`;
        } else if (totalAtual > 0) {
          insight = `<strong>${totalAtual}</strong> sobreviventes acumulados em ${pistaNome}.`;
        } else {
          insight = `Nenhum completador ainda em ${pistaNome} — aprendizado transferido. 🔬`;
        }
      } else if (totalAtual > 0) {
        insight = `<strong>${totalAtual}</strong> sobreviventes completaram ${pistaNome}! 🧬`;
      } else {
        insight = cicloIdx < 3
          ? `Partindo para <strong>${proxNome}</strong> com os genes de ${pistaNome}.`
          : `Campeonato encerrado! <strong>${totalGeral}</strong> sobreviventes totais.`;
      }
      insightEl.innerHTML = insight;
    }

    const btnCont = el("btn-ciclo-continuar");
    if (btnCont) {
      btnCont.textContent = cicloIdx < 3 ? `Ir para ${proxNome} ▶` : "Ver Resumo ▶";
      btnCont.onclick = () => {
        modal.style.display = "none";
        if (typeof onClose === "function") onClose();
        else paused = false;
      };
    }

    paused = true;
    modal.style.display = "flex";
  }

  function exibirPopUpResumo() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
    set("resumo-pista1", historicoGeracoes.pista0);
    set("resumo-pista2", historicoGeracoes.pista1);
    set("resumo-pista3", historicoGeracoes.pista2);
    const modal = document.getElementById("modal-resumo");
    if (modal) modal.style.display = "flex";
  }

  // ── Toast ─────────────────────────────────────────────────────────────
  function showToast(msg) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.innerText = msg;
    toast.style.transform = "translateX(-50%) translateY(0px)";
    toast.style.opacity = "1";
    setTimeout(() => {
      toast.style.transform = "translateX(-50%) translateY(20px)";
      toast.style.opacity = "0";
    }, 4000);
  }

  // ── Teclado ───────────────────────────────────────────────────────────
  window.addEventListener("keydown", e => {
    keys[e.code] = true;
    keys[e.key] = true;
    if ((e.code === "KeyR" || e.key === "r" || e.key === "R") && currentMode === 'manual') {
      startManualMode();
      showToast("🔄 Carro reiniciado.");
    }
    // Previne scroll da página com Espaço no modo manual
    if (e.code === "Space" && currentMode === 'manual') {
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", e => {
    keys[e.code] = false;
    keys[e.key] = false;
  });

  // ── Bindings ──────────────────────────────────────────────────────────
  function bindControls() {
    document.querySelectorAll(".mode-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const mode = btn.dataset.mode;
        applyModeUI(mode);

        if (mode === 'manual') {
          startManualMode();
        } else if (mode === 'race') {
          const allBrains = storage.getAllBestBrains();
          if (!allBrains.length) {
            showToast("⚠️ Nenhum genoma salvo! Treine primeiro.");
            document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
            document.querySelector(".mode-btn[data-mode='train']")?.classList.add("active");
            applyModeUI('train');
            return;
          }
          [0, 1, 2].forEach(i => { raceSurvivorsByTrack[i] = []; });
          raceGeneration = 1;
          raceTrackIdx = 0;
          track = new Track(0); if (visualizer) visualizer._trackCache = null;
          ga = new GeneticAlgorithm({ populationSize: 200 });
          ga.createRacePopulation(track, allBrains, storage.getGhostPath(0));
          track.resetCheckpoints();
          document.querySelectorAll("[data-track]").forEach(b => {
            b.classList.toggle("active", parseInt(b.dataset.track, 10) === 0);
          });
          paused = false;
          showToast(`🏁 MODO CORRIDA iniciado! 3 pistas × 6 gen — evolução ao vivo!`);
        } else {
          ga.generation = 1;
          const seeds = storage.getSeedBrainsForTrack(track.index);
          const ghost = storage.getGhostPath(track.index);
          ga.createInitialPopulation(track, seeds.length ? seeds : null, ghost);
          paused = false;
          showToast("🧬 Modo Treinar! Algoritmo genético iniciado.");
        }
        updateHUD();
      });
    });

    document.getElementById("btn-start")?.addEventListener("click", () => {
      paused = false; showToast("▶ Simulação rodando…");
    });
    document.getElementById("btn-pause")?.addEventListener("click", () => {
      paused = true; showToast("⏸ Pausado.");
    });
    document.getElementById("btn-stop")?.addEventListener("click", () => {
      paused = true;
      ga.generation = 1;
      const autoProg = document.getElementById("chk-auto-progression")?.checked;
      if (autoProg && currentMode === 'train') {
        track.setTrack(0);
        track.resetCheckpoints();
        document.querySelectorAll("[data-track]").forEach(b => {
          b.classList.toggle("active", parseInt(b.dataset.track, 10) === 0);
        });
      }
      if (currentMode === 'race') {
        [0, 1, 2].forEach(i => { raceSurvivorsByTrack[i] = []; });
        raceGeneration = 1; raceTrackIdx = 0;
        track = new Track(0); if (visualizer) visualizer._trackCache = null;
      }
      resetSimulation();
      showToast("⏹ Parado e reiniciado.");
    });
    document.getElementById("btn-reset")?.addEventListener("click", () => {
      if (currentMode === 'manual') {
        startManualMode();
      } else if (currentMode === 'race') {
        [0, 1, 2].forEach(i => { raceSurvivorsByTrack[i] = []; });
        raceGeneration = 1; raceTrackIdx = 0;
        track = new Track(0); if (visualizer) visualizer._trackCache = null;
        resetSimulation();
      } else {
        ga.generation = 1;
        resetSimulation();
      }
      showToast("↺ Reiniciado com sementes salvas.");
    });

    document.getElementById("btn-fechar-modal")?.addEventListener("click", () => {
      const m = document.getElementById("modal-resumo");
      if (m) m.style.display = "none";
      ga.generation = 1;
      track = new Track(0); if (visualizer) visualizer._trackCache = null;
      [0, 1, 2].forEach(i => { completadoresCiclo[i] = 0; sobreviventesPorPista[i] = []; });
      historicoGeracoes.pista0 = historicoGeracoes.pista1 = historicoGeracoes.pista2 = "N/A";
      document.querySelectorAll("[data-track]").forEach(b => {
        b.classList.toggle("active", parseInt(b.dataset.track, 10) === 0);
      });
      resetSimulation();
      paused = false;
      showToast("🔄 Novo campeonato! Começando em Mônaco.");
    });

    document.querySelectorAll(".speed-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".speed-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const sv = btn.dataset.speed;
        if (sv === "turbo") { turboMode = true; simSpeed = 20; showToast("⚡ Turbo (20×)!"); }
        else { turboMode = false; simSpeed = parseInt(sv, 10); showToast(`Velocidade: ${simSpeed}×`); }
      });
    });

    document.getElementById("btn-export-json")?.addEventListener("click", () => {
      storage.exportToFile(); showToast("⬇ JSON exportado!");
    });
    document.getElementById("btn-import-json")?.addEventListener("click", async () => {
      const ok = await storage.importFromFile();
      if (ok) { ga.generation = 1; resetSimulation(); updateStorageStatus(); showToast("✅ JSON importado!"); }
      else showToast("❌ Falha ao importar JSON.");
    });
    document.getElementById("btn-clear-storage")?.addEventListener("click", () => {
      if (confirm("Apagar TODOS os dados salvos?")) {
        storage.clear();
        ga.generation = 1;
        ga.createInitialPopulation(track, null, null);
        updateStorageStatus();
        showToast("🗑 Dados limpos.");
      }
    });

    const mutSlider = document.getElementById("slider-mutation");
    mutSlider?.addEventListener("input", () => {
      ga.setRates(parseFloat(mutSlider.value), null);
      const l = document.getElementById("label-mutation");
      if (l) l.innerText = parseFloat(mutSlider.value).toFixed(3);
    });
    const crossSlider = document.getElementById("slider-crossover");
    crossSlider?.addEventListener("input", () => {
      ga.setRates(null, parseFloat(crossSlider.value));
      const l = document.getElementById("label-crossover");
      if (l) l.innerText = parseFloat(crossSlider.value).toFixed(2);
    });
    const popSlider = document.getElementById("slider-population");
    popSlider?.addEventListener("input", () => {
      const l = document.getElementById("label-population");
      if (l) l.innerText = popSlider.value;
    });
    popSlider?.addEventListener("change", () => {
      ga.setPopulationSize(parseInt(popSlider.value, 10));
      ga.generation = 1;
      resetSimulation();
    });

    document.querySelectorAll("[data-track]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-track]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const autoProgEl = document.getElementById("chk-auto-progression");
        if (autoProgEl) autoProgEl.checked = false;
        const idx = parseInt(btn.dataset.track, 10);
        track.setTrack(idx);
        track.resetCheckpoints();

        if (currentMode === 'manual') {
          startManualMode();
        } else if (currentMode === 'race') {
          raceTrackIdx = idx;
          const allBrains = storage.getAllBestBrains();
          ga.createRacePopulation(track, allBrains, storage.getGhostPath(idx));
          track.resetCheckpoints();
        } else {
          const seeds = storage.getSeedBrainsForTrack(idx);
          ga.generation = 1;
          ga.createInitialPopulation(track, seeds.length ? seeds : null, storage.getGhostPath(idx));
        }
        showToast(`Pista ${trackNames[idx]} selecionada.`);
        updateHUD();
      });
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────
  function init() {
    initCharts();
    bindControls();
    applyModeUI('train');
    resetSimulation();
    requestAnimationFrame(simulationStep);
    showToast("🧬 IA Genética v11 — 3 modos: Manual, Treinar, Corrida!");
    updateStorageStatus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
