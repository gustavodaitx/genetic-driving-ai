/**
 * app.js v4 — Loop principal com persistência orientada à conclusão.
 *
 * FLUXO DE SALVAMENTO:
 *  - A cada geração, o GA devolve stats com completorsThisGen.
 *  - Qualquer carro que concluiu a pista é salvo via storage.saveChampion().
 *  - Ao trocar de pista, storage.getSeedBrainsForTrack() devolve APENAS
 *    completadores — garantindo que a nova população começa com cérebros
 *    que já sabem chegar ao fim.
 *  - Botões de exportar/importar JSON permitem persistir entre sessões.
 */
(function () {
  const canvas     = document.getElementById("sim-canvas");
  const visualizer = new Visualizer(canvas);
  const storage    = new StorageManager();
  window.storageInstance = storage; // exposto para o modal

  const trackNames = ["Mônaco", "Monza", "Interlagos"];

  let track     = new Track(0);
  let ga        = new GeneticAlgorithm();
  let running   = true;
  let paused    = false;
  let simSpeed  = 1;
  let turboMode = false;
  let raceMode  = false; // Modo Corrida: 200 carros da melhor população salva

  const charts = { fitness: null, distance: null };
  const historicoGeracoes = { pista0: "N/A", pista1: "N/A", pista2: "N/A" };

  // Rastreia sobreviventes (completadores) acumulados por pista ao longo de todo o campeonato
  // Cada entrada: { gen: N, completors: N } — histórico de TODAS as gerações
  const sobreviventesPorPista = { 0: [], 1: [], 2: [] };
  // Acumulado de completadores por pista (soma total do ciclo de 6 gens)
  const completadoresCiclo    = { 0: 0, 1: 0, 2: 0 };

  // ── Charts ───────────────────────────────────────────────────────────────
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
          { label: "Média populacional", data: [], borderColor: "#4a9eff", tension: 0.2, fill: false },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false },
    });

    charts.distance = new Chart(distCtx, {
      type: "line",
      data: {
        labels: [],
        datasets: [{ label: "Completadores/geração", data: [], borderColor: "#00ffaa", tension: 0.2, fill: false }],
      },
      options: { responsive: true, maintainAspectRatio: false },
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

  // ── HUD ──────────────────────────────────────────────────────────────────
  function updateHUD() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
    set("hud-generation",    ga.generation);
    set("hud-alive",         ga.population.filter(c => c.alive).length);
    set("hud-best-fitness",  Math.round(ga.stats?.bestFitness || 0));
    set("hud-best-distance", ga.stats?.bestDistance || 0);
    set("hud-track",         trackNames[track.index] || ("Pista " + (track.index + 1)));
    set("hud-completors",    (ga.stats?.completorsThisGen || 0) + " completaram");
    updateStorageStatus();
  }

  function updateStorageStatus() {
    const s = storage.getStatus();
    [0, 1, 2].forEach(i => {
      const el = document.getElementById(`storage-track${i}`);
      if (!el) return;
      const n    = s.completionsByTrack[i] || 0;
      const done = s.completedTracks.includes(i);
      el.innerText  = n + " completador(es)" + (done ? " ✅" : "");
      el.style.color = done ? "#00ffaa" : "#aaa";
    });
    const uEl = document.getElementById("storage-universal");
    if (uEl) {
      uEl.innerText  = s.universalCount + " universal(is)";
      uEl.style.color = s.universalCount > 0 ? "#ffd700" : "#aaa";
    }
  }

  // ── Loop principal ────────────────────────────────────────────────────────
  function simulationStep() {
    if (!running) return;

    const melhorCarro = ga.getBestCar();

    // ── Velocímetro HUD ──
    const currentSpeed = (melhorCarro && melhorCarro.alive) ? melhorCarro.speed : 0;
    const speedKmH = Math.round(currentSpeed * 35); // escala para km/h (máx speed 6.5 -> ~228 km/h)
    
    const speedValEl = document.getElementById("speed-value");
    if (speedValEl) speedValEl.innerText = speedKmH;

    const needleEl = document.getElementById("dial-needle");
    if (needleEl) {
      // Rotaciona a agulha de -135deg (0 km/h) até +135deg (230 km/h)
      const deg = -135 + (Math.min(230, speedKmH) / 230) * 270;
      needleEl.style.transform = `rotate(${deg}deg)`;
    }

    if (!paused) {
      const steps = turboMode ? 20 : Math.max(1, Math.floor(simSpeed));

      for (let step = 0; step < steps; step++) {
        let anyAlive = false;

        ga.population.forEach(car => {
          if (!car.alive && !car.completed) return;
          if (car.completed) return; // Já terminou, não processa mais
          car.update(track);
          if (car.alive) anyAlive = true;

          // Detecta conclusão
          if (car.completed) {
            car.computeFitness(track);
            storage.saveChampion(car, track.index, ga.generation);
            historicoGeracoes["pista" + track.index] = ga.generation;
            showToast(`🏆 ${trackNames[track.index].toUpperCase()} COMPLETADA! Gen ${ga.generation} — Salvo.`);
            updateStorageStatus();
            if (storage.isProjectComplete()) {
              document.body.classList.add("project-complete");
            }
          }
        });

        // Enquanto houver carros vivos, continua os steps (não quebra — isso é o que o turbo precisa)
        if (anyAlive) continue;

        // Toda a população morreu (ou completou): evolui e sai do loop de steps
        const carrosVivos = ga.population.filter(c => c.alive).length;
        if (carrosVivos === 0) {
          const autoProg = document.getElementById("chk-auto-progression")?.checked;
          
          let nextTrackIndex = track.index;
          let mustSwitchTrack = false;
          let championshipFinished = false;

          // Se for modo Campeonato Automático
          if (autoProg) {
            if (ga.generation === 6) {
              nextTrackIndex = 1;
              mustSwitchTrack = true;
            } else if (ga.generation === 12) {
              nextTrackIndex = 2;
              mustSwitchTrack = true;
            } else if (ga.generation === 18) {
              championshipFinished = true;
            }
          }

          if (championshipFinished) {
            // Campeonato Concluído — registra última geração antes de pausar
            ga.population.forEach(car => car.computeFitness(track));
            const compFinal = ga.population.filter(c => c.completed).length;
            completadoresCiclo[track.index] = (completadoresCiclo[track.index] || 0) + compFinal;
            sobreviventesPorPista[track.index].push({ gen: ga.generation, completors: compFinal });

            paused = true;
            historicoGeracoes["pista" + track.index] = ga.generation;
            updateStorageStatus();
            // Mostra ciclo 3 (fim de Interlagos) antes do resumo final
            setTimeout(() => {
              exibirPopUpCiclo(3, () => {
                setTimeout(exibirPopUpResumo, 300);
              });
            }, 80);
            showToast("🏁 FIM DO CAMPEONATO! 18 gerações concluídas.");
            break;
          }

          let stats;
          if (mustSwitchTrack) {
            const nextTrack = new Track(nextTrackIndex);
            
            // Grava histórico da pista anterior
            historicoGeracoes["pista" + track.index] = ga.generation;
            
            // Evolve transferindo a população para o novo track
            stats = ga.evolve(track, nextTrack);
            // Registra sobreviventes da última geração desta pista (antes da troca)
            const compTroca = stats.completorsThisGen || 0;
            completadoresCiclo[track.index] = (completadoresCiclo[track.index] || 0) + compTroca;
            sobreviventesPorPista[track.index].push({ gen: ga.generation - 1, completors: compTroca });
            track = nextTrack;
            
            // Atualiza botões visuais da pista ativa no menu lateral
            document.querySelectorAll("[data-track]").forEach(b => {
              b.classList.toggle("active", parseInt(b.dataset.track, 10) === nextTrackIndex);
            });
            
            showToast(`🚀 Avançando para ${trackNames[nextTrackIndex]} (Pista ${nextTrackIndex+1})!`);
            // Pop-up de fim de ciclo: mostra evolução de sobreviventes por pista
            setTimeout(() => exibirPopUpCiclo(nextTrackIndex), 80);
          } else {
            stats = ga.evolve(track, track);
            // Registra sobreviventes de cada geração normal (mesma pista)
            const compGen = stats.completorsThisGen || 0;
            completadoresCiclo[track.index] = (completadoresCiclo[track.index] || 0) + compGen;
            sobreviventesPorPista[track.index].push({ gen: ga.generation - 1, completors: compGen });
          }

          updateCharts(
            ga.generation - 1, // mostra estatísticas da geração anterior recém-concluída
            Math.round(stats.bestFitness),
            Math.round(stats.avgFitness),
            stats.completorsThisGen || 0
          );


          // Salva o melhor não-completador apenas para histórico de UI
          const best = ga.getBestCar();
          if (best && !best.completed) {
            storage.saveChampion(best, track.index, ga.generation - 1);
          }
          break;
        }
      }
    }

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    visualizer.render(track, ga.population, melhorCarro, {
      paused, turboMode, showSensors: true,
    });

    updateHUD();
    requestAnimationFrame(simulationStep);
  }


  // ── Modal de fim de ciclo (a cada 6 gerações) ──────────────────────────
  function exibirPopUpCiclo(cicloIdx, onClose) {
    const modal = document.getElementById("modal-ciclo");
    if (!modal) return;

    const cicloNomes  = ["", "Mônaco", "Monza", "Interlagos"];
    const proximaNomes= ["", "Monza", "Interlagos", "Fim do Campeonato"];
    const icones      = ["", "🏎️", "⚡", "🏆"];

    const pistaNome = cicloNomes[cicloIdx]   || ("Pista " + cicloIdx);
    const proxNome  = proximaNomes[cicloIdx] || "";
    const icone     = icones[cicloIdx]       || "🏁";
    const genInicio = (cicloIdx - 1) * 6 + 1;
    const genFim    = cicloIdx * 6;

    const el = id => document.getElementById(id);
    if (el("mciclo-titulo"))   el("mciclo-titulo").textContent   = `Ciclo ${cicloIdx} Concluído!`;
    if (el("mciclo-subtitulo"))el("mciclo-subtitulo").textContent = `Gen. ${genInicio}–${genFim} — ${pistaNome}`;
    if (el("mciclo-icon"))     el("mciclo-icon").textContent     = icone;

    // Barras de sobreviventes
    const container = el("mciclo-pistas");
    if (container) {
      container.innerHTML = "";
      const pistaLabels = ["Mônaco", "Monza", "Interlagos"];
      const maxComp = Math.max(1, ...pistaLabels.map((_, i) => completadoresCiclo[i] || 0));

      pistaLabels.forEach((nome, idx) => {
        const total       = completadoresCiclo[idx] || 0;
        const isAtiva     = idx === cicloIdx - 1;
        const isAnterior  = idx  <  cicloIdx - 1;
        const isFutura    = idx  >  cicloIdx - 1;

        const pct         = isFutura ? 0 : Math.round((total / maxComp) * 100);
        const barClass    = isAtiva ? "mciclo-barra-ativa" : isAnterior ? "mciclo-barra-anterior" : "mciclo-barra-inativa";
        const numClass    = isAtiva ? "ativa"               : isAnterior ? "anterior"              : "inativa";
        const numText     = isFutura ? "—" : total;

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

      // Anima barras com pequeno delay para CSS transition funcionar
      requestAnimationFrame(() => {
        container.querySelectorAll(".mciclo-barra-fill").forEach(bar => {
          setTimeout(() => { bar.style.width = bar.dataset.pct + "%"; }, 80);
        });
      });
    }

    // Insight sobre evolução
    const insightEl = el("mciclo-insight");
    if (insightEl) {
      const hist         = sobreviventesPorPista[cicloIdx - 1] || [];
      const totalAtual   = completadoresCiclo[cicloIdx - 1] || 0;
      const totalGeral   = Object.values(completadoresCiclo).reduce((a, b) => a + b, 0);
      let insight = "";

      if (hist.length >= 2) {
        const primeiro = hist[0].completors;
        const ultimo   = hist[hist.length - 1].completors;
        const ganho    = ultimo - primeiro;
        if (ganho > 0) {
          insight = `<strong>+${ganho}</strong> sobreviventes a mais na última geração frente à primeira — evolução real! 🧬`;
        } else if (totalAtual > 0) {
          insight = `<strong>${totalAtual}</strong> sobreviventes acumulados em ${pistaNome}. Genes transferidos à próxima pista.`;
        } else {
          insight = `Nenhum completador ainda em ${pistaNome} — mas o aprendizado foi transferido. 🔬`;
        }
      } else if (totalAtual > 0) {
        insight = `<strong>${totalAtual}</strong> sobreviventes completaram ${pistaNome}! Herança genética ativada. 🧬`;
      } else {
        insight = cicloIdx < 3
          ? `Partindo para <strong>${proxNome}</strong> com os genes aprendidos em ${pistaNome}.`
          : `Campeonato encerrado! <strong>${totalGeral}</strong> sobreviventes totais acumulados.`;
      }
      insightEl.innerHTML = insight;
    }

    // Botão continuar
    const btnCont = el("btn-ciclo-continuar");
    if (btnCont) {
      btnCont.textContent = cicloIdx < 3 ? `Ir para ${proxNome} ▶` : "Ver Resumo ▶";
      btnCont.onclick = () => {
        modal.style.display = "none";
        if (typeof onClose === "function") {
          onClose();
        } else {
          paused = false;
        }
      };
    }

    paused = true;
    modal.style.display = "flex";
  }

  // ── Modal de resumo ───────────────────────────────────────────────────────
  function exibirPopUpResumo() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
    set("resumo-pista1", historicoGeracoes.pista0);
    set("resumo-pista2", historicoGeracoes.pista1);
    set("resumo-pista3", historicoGeracoes.pista2);
    const modal = document.getElementById("modal-resumo");
    if (modal) modal.style.display = "flex";
  }

  // ── Inicialização da simulação ────────────────────────────────────────────
  function startSimulation() {
    running = true;
    requestAnimationFrame(simulationStep);
  }

  /**
   * Reinicia a população para a pista atual.
   * Usa APENAS completadores como semente (via getSeedBrainsForTrack).
   */
  function resetSimulation() {
    raceMode = false;
    const seeds = storage.getSeedBrainsForTrack(track.index);
    const ghost = storage.getGhostPath(track.index);
    ga.createInitialPopulation(track, seeds.length ? seeds : null, ghost);
    updateHUD();
  }

  /**
   * Modo Corrida: população de 200 baseada na MELHOR população salva.
   * Usa todos os melhores genomas do storage (não só 1 carro).
   */
  function startRaceMode() {
    raceMode = true;
    ga.generation = 1;
    const allBestBrains = storage.getAllBestBrains();
    const ghost = storage.getGhostPath(track.index);

    if (allBestBrains.length === 0) {
      showToast("\u26a0\ufe0f Nenhum gen\u00f4ma salvo! Treine primeiro.");
      raceMode = false;
      return;
    }

    ga.createRacePopulation(track, allBestBrains, ghost);
    paused = false;
    showToast(`\ud83c\udfc1 MODO CORRIDA! ${allBestBrains.length} gen\u00f4ma(s) \u2192 200 carros na pista!`);
    updateHUD();
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(msg) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.innerText           = msg;
    toast.style.transform     = "translateX(-50%) translateY(0px)";
    toast.style.opacity       = "1";
    setTimeout(() => {
      toast.style.transform   = "translateX(-50%) translateY(20px)";
      toast.style.opacity     = "0";
    }, 4000);
  }

  // ── Controles ─────────────────────────────────────────────────────────────
  function bindControls() {
    document.getElementById("btn-start")?.addEventListener("click", () => {
      paused = false; showToast("Simulação rodando…");
    });
    document.getElementById("btn-pause")?.addEventListener("click", () => {
      paused = true; showToast("Pausado.");
    });
    document.getElementById("btn-stop")?.addEventListener("click", () => {
      paused = true;
      ga.generation = 1;
      
      const autoProg = document.getElementById("chk-auto-progression")?.checked;
      if (autoProg) {
        // Se estiver no campeonato automático, resetamos de volta para Mônaco (Track 0)
        track.setTrack(0);
        track.resetCheckpoints();
        document.querySelectorAll("[data-track]").forEach(b => {
          b.classList.toggle("active", parseInt(b.dataset.track, 10) === 0);
        });
      }
      
      resetSimulation();
      showToast("Simulação parada e reiniciada.");
    });
    document.getElementById("btn-reset")?.addEventListener("click", () => {
      ga.generation = 1;
      resetSimulation();
      showToast("População reiniciada com sementes salvas.");
    });
    document.getElementById("btn-race")?.addEventListener("click", () => {
      startRaceMode();
    });
    document.getElementById("btn-fechar-modal")?.addEventListener("click", () => {
      const m = document.getElementById("modal-resumo");
      if (m) m.style.display = "none";
      // Reinicia o campeonato do zero (volta para Mônaco)
      ga.generation = 1;
      track = new Track(0);
      completadoresCiclo[0] = 0;
      completadoresCiclo[1] = 0;
      completadoresCiclo[2] = 0;
      sobreviventesPorPista[0] = [];
      sobreviventesPorPista[1] = [];
      sobreviventesPorPista[2] = [];
      historicoGeracoes.pista0 = "N/A";
      historicoGeracoes.pista1 = "N/A";
      historicoGeracoes.pista2 = "N/A";
      document.querySelectorAll("[data-track]").forEach(b => {
        b.classList.toggle("active", parseInt(b.dataset.track, 10) === 0);
      });
      resetSimulation();
      paused = false;
      showToast("🔄 Novo campeonato iniciado! Começando em Mônaco.");
    });

    // Speed Controls Button Group (1x, 2x, 3x, 5x, 10x, Turbo)
    document.querySelectorAll(".speed-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".speed-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        
        const speedVal = btn.dataset.speed;
        if (speedVal === "turbo") {
          turboMode = true;
          simSpeed = 1;
          showToast("Velocidade Turbo (20x)!");
        } else {
          turboMode = false;
          simSpeed = parseInt(speedVal, 10);
          showToast(`Velocidade Física: ${simSpeed}x`);
        }
      });
    });

    // Export JSON
    document.getElementById("btn-export-json")?.addEventListener("click", () => {
      const s = storage.getStatus();
      const total = Object.values(s.completionsByTrack).reduce((a, b) => a + b, 0);
      if (total === 0) { showToast("Nenhum completador para exportar ainda."); return; }
      storage.exportToFile();
      showToast(`📁 JSON exportado! (${total} completador(es))`);
    });

    // Import JSON
    document.getElementById("btn-import-json")?.addEventListener("click", async () => {
      showToast("Escolha o arquivo JSON…");
      const ok = await storage.importFromFile();
      if (ok) {
        ga.generation = 1;
        resetSimulation();
        updateStorageStatus();
        showToast("✅ JSON importado! Cérebros completadores carregados.");
      } else {
        showToast("❌ Falha ao importar o arquivo JSON.");
      }
    });

    // Retrocompatibilidade clipboard
    document.getElementById("btn-save")?.addEventListener("click", () => {
      const json = storage.exportChampion(track.index);
      if (json) { navigator.clipboard?.writeText(json).catch(() => {}); showToast("Copiado!"); }
      else showToast("Nenhum completador nesta pista ainda.");
    });
    document.getElementById("btn-load")?.addEventListener("click", () => {
      const j = prompt("Cole o JSON do campeão:");
      if (j) {
        const ok = storage.importChampion(j, track.index);
        if (ok) { ga.generation = 1; resetSimulation(); showToast("Campeão carregado!"); }
        else showToast("JSON inválido.");
      }
    });

    // Limpar
    document.getElementById("btn-clear-storage")?.addEventListener("click", () => {
      if (confirm("Apagar TODOS os completadores salvos? Esta ação é irreversível.")) {
        storage.clear();
        ga.generation = 1;
        ga.createInitialPopulation(track, null, null);
        updateStorageStatus();
        showToast("🗑️ Dados limpos. Começando do zero.");
      }
    });

    // Sliders
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
    popSlider?.addEventListener("change", () => {
      ga.setPopulationSize(parseInt(popSlider.value, 10));
      ga.generation = 1;
      resetSimulation();
    });

    // Seleção de pistas
    document.querySelectorAll("[data-track]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-track]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        // Desativa a progressão automática se o usuário selecionar manualmente uma pista
        const autoProgEl = document.getElementById("chk-auto-progression");
        if (autoProgEl) autoProgEl.checked = false;

        const idx = parseInt(btn.dataset.track, 10);
        track.setTrack(idx);
        track.resetCheckpoints();

        const seeds = storage.getSeedBrainsForTrack(idx);
        const ghost = storage.getGhostPath(idx);
        ga.generation = 1;
        ga.createInitialPopulation(track, seeds.length ? seeds : null, ghost);

        showToast(`Pista ${trackNames[idx]} — ${seeds.length} cérebro(s) como semente`);
        updateHUD();
      });
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    initCharts();
    bindControls();
    resetSimulation();
    startSimulation();
    showToast("IA Genética v4 — Persistência orientada à conclusão!");
    updateStorageStatus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
