/**
 * Aplicação principal — loop com turbo real,
 * controlo de inputs, renderização e HUD completo.
 */
(function () {
  // Inicialização de instâncias globais carregadas pelos outros ficheiros
  const canvas    = document.getElementById("sim-canvas");
  const visualizer = new Visualizer(canvas);
  const storage   = new StorageManager();
  let track       = new Track(0);
  let ga          = new GeneticAlgorithm();
  
  let running     = true;
  let paused      = false;
  let simSpeed    = 1;
  let turboMode   = false;

  const charts = { fitness: null, distance: null };

  function initCharts() {
    const fitCtx  = document.getElementById("chart-fitness");
    const distCtx = document.getElementById("chart-distance");
    if (!fitCtx || !distCtx || typeof Chart === "undefined") return;

    charts.fitness = new Chart(fitCtx, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "Melhor fitness",     data: [], borderColor: "#ffd700", tension: 0.2, fill: false },
          { label: "Média populacional", data: [], borderColor: "#4a9eff", tension: 0.2, fill: false }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });

    charts.distance = new Chart(distCtx, {
      type: "line",
      data: {
        labels: [],
        datasets: [{ label: "Melhor Distância", data: [], borderColor: "#00ffaa", tension: 0.2, fill: false }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }

  function updateCharts(gen, bestFit, avgFit, bestDist) {
    if (!charts.fitness || !charts.distance) return;
    
    charts.fitness.data.labels.push(gen);
    charts.fitness.data.datasets[0].data.push(bestFit);
    charts.fitness.data.datasets[1].data.push(avgFit);
    charts.fitness.update();

    charts.distance.data.labels.push(gen);
    charts.distance.data.datasets[0].data.push(bestDist);
    charts.distance.update();
  }

  function updateHUD() {
    const elGen      = document.getElementById("hud-generation");
    const elAlive    = document.getElementById("hud-alive");
    const elFitness  = document.getElementById("hud-best-fitness");
    const elDistance = document.getElementById("hud-best-distance");
    const elTrack    = document.getElementById("hud-track");

    if (elGen)      elGen.innerText      = ga.generation;
    if (elAlive)    elAlive.innerText    = ga.population.filter(c => c.alive).length;
    if (elFitness)  elFitness.innerText  = Math.round(ga.stats?.bestFitness || 0);
    if (elDistance) elDistance.innerText = Math.round(ga.stats?.bestDistance || 0);
    if (elTrack)    elTrack.innerText    = "Pista " + (track.index + 1);
  }

  // =================================================================
  // HISTÓRICO DE GERAÇÕES POR PISTA (Corrigido: apenas uma declaração)
  // =================================================================
  const historicoGeracoes = { pista0: "N/A", pista1: "N/A", pista2: "N/A" };

  function simulationStep() {
    if (!running) return;

    if (!paused) {
      const passosFisicos = turboMode ? 20 : Math.max(1, Math.floor(simSpeed));

      for (let i = 0; i < passosFisicos; i++) {
        let anyAlive = false;

        ga.population.forEach(car => {
          if (car.alive) {
            car.update(track);
            anyAlive = true;

            // Verificação Automática de Fim de Pista (Salva se chegar ao último checkpoint)
            if (track.checkpoints && car.checkpointIndex === track.checkpoints.length - 1) {
              car.alive = false; 
              storage.saveChampion(car, track.index, ga.generation);
              showToast("🏆 CAMPEÃO CHEGOU AO FIM! Salvo Automaticamente.");
              paused = true; 

              // Registra o histórico de gerações da pista atual
              historicoGeracoes["pista" + track.index] = ga.generation;

              // Se acabou de vencer a Pista 3 (index 2)
              if (track.index === 2) {
                exibirPopUpResumo();
              }
            }
          }
        });

        if (!anyAlive) {
          const stats = ga.evolve(track);
          
          const bFit = stats?.bestFitness || ga.stats?.bestFitness || 0;
          const aFit = stats?.avgFitness || ga.stats?.avgFitness || 0;
          const bDist = stats?.bestDistance || ga.stats?.bestDistance || 0;
          
          updateCharts(ga.generation, Math.round(bFit), Math.round(aFit), Math.round(bDist));
          
          const bestCar = ga.getBestCar();
          if (bestCar && bFit > 0) {
            storage.saveChampion(bestCar, track.index, ga.generation);
          }
          
          break;
        }
      }
    }

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const melhorCarro = ga.getBestCar();
    visualizer.render(track, ga.population, melhorCarro, { 
      paused: paused, 
      turboMode: turboMode,
      showSensors: true
    });
    
    updateHUD();
    requestAnimationFrame(simulationStep);
  }

  function exibirPopUpResumo() {
    const p1 = document.getElementById("resumo-pista1");
    const p2 = document.getElementById("resumo-pista2");
    const p3 = document.getElementById("resumo-pista3");
    const modal = document.getElementById("modal-resumo");

    if (p1) p1.innerText = historicoGeracoes.pista0;
    if (p2) p2.innerText = historicoGeracoes.pista1;
    if (p3) p3.innerText = historicoGeracoes.pista2;
    
    if (modal) {
      modal.style.display = "flex";
    }
  }

  function startSimulation() {
    running = true;
    requestAnimationFrame(simulationStep);
  }

  function resetSimulation() {
    const brains = storage.getBestBrainsForTrack(track.index);
    const ghost  = storage.getGhostPath(track.index);
    ga.createInitialPopulation(track, brains.length ? brains : null, ghost);
    updateHUD();
  }

  function showToast(msg) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.innerText = msg;
    toast.style.transform = "translateX(-50%) translateY(0px)";
    toast.style.opacity = "1";
    setTimeout(() => {
      toast.style.transform = "translateX(-50%) translateY(20px)";
      toast.style.opacity = "0";
    }, 3000);
  }

  function bindControls() {
    // Botões de controle de fluxo superior
    document.getElementById("btn-start")?.addEventListener("click", () => {
      paused = false;
      showToast("Simulação Rodando");
    });

    document.getElementById("btn-pause")?.addEventListener("click", () => {
      paused = true;
      showToast("Simulação Pausada");
    });

    document.getElementById("btn-reset")?.addEventListener("click", () => {
      ga.generation = 1;
      resetSimulation();
      showToast("População reiniciada do zero!");
    });

    // Ação do botão para fechar o pop-up de resumo
    document.getElementById("btn-fechar-modal")?.addEventListener("click", () => {
      const modal = document.getElementById("modal-resumo");
      if (modal) modal.style.display = "none";
    });

    // Modo Turbo Alternável (Toggle)
    const turboBtn = document.getElementById("btn-turbo");
    turboBtn?.addEventListener("click", () => {
      turboMode = !turboMode;
      if (turboMode) {
        turboBtn.classList.add("active");
        showToast("Modo Turbo Ativado (20x físico/frame)!");
      } else {
        turboBtn.classList.remove("active");
        showToast("Modo Turbo Desativado.");
      }
    });

    // Exportação do Campeão Atual via clipboard
    document.getElementById("btn-save")?.addEventListener("click", () => {
      const bestCar = ga.getBestCar();
      if (bestCar) {
        const json = storage.exportChampion(track.index);
        if (json) {
          navigator.clipboard.writeText(json);
          showToast("Cérebro do Campeão copiado para a Área de Transferência!");
        }
      } else {
        showToast("Nenhum carro qualificado para salvar ainda.");
      }
    });

    // Importação de DNA
    document.getElementById("btn-load")?.addEventListener("click", () => {
      const jsonInput = prompt("Cole o JSON do cérebro do campeão guardado:");
      if (jsonInput) {
        const success = storage.importChampion(jsonInput, track.index);
        if (success) {
          ga.generation = 1;
          resetSimulation();
          showToast("Campeão Carregado com sucesso na pista!");
        } else {
          showToast("Erro: JSON de DNA inválido.");
        }
      }
    });

    // Sliders de Ajuste Dinâmico em Tempo Real
    const speedSlider = document.getElementById("slider-speed");
    speedSlider?.addEventListener("input", () => {
      simSpeed = parseFloat(speedSlider.value);
      const lbl = document.getElementById("label-speed");
      if (lbl) lbl.innerText = simSpeed.toFixed(1) + "x";
    });

    const mutSlider = document.getElementById("slider-mutation");
    mutSlider?.addEventListener("input", () => {
      ga.setRates(parseFloat(mutSlider.value), null);
      const lbl = document.getElementById("label-mutation");
      if (lbl) lbl.innerText = parseFloat(mutSlider.value).toFixed(3);
    });

    const crossSlider = document.getElementById("slider-crossover");
    crossSlider?.addEventListener("input", () => {
      ga.setRates(null, parseFloat(crossSlider.value));
      const lbl = document.getElementById("label-crossover");
      if (lbl) lbl.innerText = parseFloat(crossSlider.value).toFixed(2);
    });

    const popSlider = document.getElementById("slider-population");
    popSlider?.addEventListener("change", () => {
      ga.setPopulationSize(parseInt(popSlider.value, 10));
      ga.generation = 1;
      resetSimulation();
    });

    // Escuta para Seleção de Pistas
    document.querySelectorAll("[data-track]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-track]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        const trackIdx = parseInt(btn.dataset.track, 10);
        track.setTrack(trackIdx);
        track.resetCheckpoints();
        
        const brains = storage.getBestBrainsForTrack(trackIdx);
        const ghost  = storage.getGhostPath(trackIdx);
        ga.generation = 1;
        ga.createInitialPopulation(track, brains.length ? brains : null, ghost);
        
        showToast(`Mudou para a Pista ${trackIdx + 1}`);
        updateHUD();
      });
    });
  }

  function init() {
    initCharts();
    bindControls();
    resetSimulation();
    startSimulation();
    showToast("IA Genética v2 iniciada — Treino em execução!");
  }

  // Monitor de ciclo seguro de carregamento do DOM
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();