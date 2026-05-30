/**
 * StorageManager v4 — Persistência multi-pista com JSON file export/import.
 *
 * FILOSOFIA DE PERSISTÊNCIA:
 *
 *  Só são salvos indivíduos que COMPLETARAM a pista (chegaram ao último checkpoint).
 *  Indivíduos que apenas tiveram bom fitness mas não concluíram NÃO são usados
 *  como semente — eles carregam hábitos de colisão ou desvio que contaminam o
 *  aprendizado das pistas seguintes.
 *
 *  Ao trocar para uma nova pista, a semente inicial é composta por:
 *    1. Completadores universais (concluíram as 3 pistas) — máxima prioridade
 *    2. Completadores desta pista específica
 *    3. Completadores de outras pistas (transferência de comportamento de direção)
 *
 *  Isso garante que, após as 3 pistas, os indivíduos salvos consigam percorrer
 *  qualquer circuito sem penalizações: eles só chegaram aqui por completar, não
 *  por marcar pontos sem concluir.
 */
(function (global) {
  const STORAGE_KEY            = "geneticDrivingAI_v4";
  const MAX_COMPLETERS_PER_TRACK = 8;   // Completadores guardados por pista
  const MAX_UNIVERSAL           = 5;    // Completadores de todas as pistas

  class StorageManager {
    constructor() {
      this.data = this._load();
    }

    _defaultData() {
      return {
        version: 4,
        // Apenas completadores, por pista: { "0": [...], "1": [...], "2": [...] }
        completersByTrack: {},
        // Indivíduos que completaram as 3 pistas (treinados após todas concluídas)
        universalCompleters: [],
        // Quais pistas já foram concluídas ao menos uma vez
        completedTracks: [],
        // Ghost paths para aprendizado visual
        ghostPaths: {},
        projectComplete: false,
        // Histórico leve para o ranking (inclui não-completadores para UI)
        history: [],
      };
    }

    _load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return this._defaultData();
        const parsed = JSON.parse(raw);
        return { ...this._defaultData(), ...parsed };
      } catch (e) {
        console.warn("[Storage] Falha ao carregar:", e);
        return this._defaultData();
      }
    }

    _persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        return true;
      } catch (e) {
        console.warn("[Storage] Falha ao salvar localStorage:", e);
        return false;
      }
    }

    // ─── Registrar um carro ao fim de cada geração ─────────────────────────
    /**
     * Chamado pelo app.js a cada geração E ao detectar conclusão de pista.
     * Só persiste como semente se car.completed === true.
     */
    saveChampion(car, trackIndex, generation) {
      const entry = {
        brain:      car.brain.toJSON(),
        fitness:    car.fitness,
        generation,
        trackIndex,
        timestamp:  Date.now(),
        completed:  car.completed || false,
      };

      // Histórico de UI (qualquer carro relevante)
      this.data.history.unshift(entry);
      if (this.data.history.length > 30) this.data.history.length = 30;

      // Semente: só completadores
      if (car.completed) {
        this._registerCompleter(entry, trackIndex);
      }

      this._persist();
      return entry;
    }

    _registerCompleter(entry, trackIndex) {
      const key = String(trackIndex);
      if (!this.data.completersByTrack[key]) this.data.completersByTrack[key] = [];

      this.data.completersByTrack[key].push(entry);
      // Mantém só os melhores (por fitness) até o limite
      this.data.completersByTrack[key].sort((a, b) => b.fitness - a.fitness);
      if (this.data.completersByTrack[key].length > MAX_COMPLETERS_PER_TRACK) {
        this.data.completersByTrack[key].length = MAX_COMPLETERS_PER_TRACK;
      }

      // Marca pista como concluída
      if (!this.data.completedTracks.includes(trackIndex)) {
        this.data.completedTracks.push(trackIndex);
      }

      // Se todas as 3 pistas já foram concluídas, este completador vira "universal"
      if (this.data.completedTracks.length >= 3) {
        this.data.universalCompleters.push(entry);
        this.data.universalCompleters.sort((a, b) => b.fitness - a.fitness);
        if (this.data.universalCompleters.length > MAX_UNIVERSAL) {
          this.data.universalCompleters.length = MAX_UNIVERSAL;
        }
        this.data.projectComplete = true;
      }
    }

    // ─── Ghost paths ────────────────────────────────────────────────────────
    saveGhostPath(trackIndex, positions) {
      if (!positions || !positions.length) return;
      const sampled = positions.filter((_, i) => i % 3 === 0).slice(0, 500);
      this.data.ghostPaths[String(trackIndex)] = sampled;
      this._persist();
    }

    getGhostPath(trackIndex) {
      return this.data.ghostPaths[String(trackIndex)] || null;
    }

    // ─── Obter cérebros semente para uma pista ─────────────────────────────
    /**
     * Retorna APENAS cérebros de completadores, em ordem de prioridade.
     * Nenhum indivíduo que não concluiu a pista entra aqui.
     */
    getSeedBrainsForTrack(trackIndex) {
      const brains = [];
      const seen   = new Set();

      const add = (entry) => {
        if (!entry || !entry.brain) return;
        const sig = JSON.stringify(entry.brain.genome || entry.brain).slice(0, 80);
        if (seen.has(sig)) return;
        seen.add(sig);
        brains.push(entry.brain);
      };

      // 1. Universais: completaram as 3 pistas — máxima prioridade
      this.data.universalCompleters.forEach(add);

      // 2. Completadores desta pista específica
      const key = String(trackIndex);
      (this.data.completersByTrack[key] || []).forEach(add);

      // 3. Transferência: completadores das outras pistas
      [0, 1, 2].filter(i => i !== trackIndex).forEach(otherIdx => {
        (this.data.completersByTrack[String(otherIdx)] || [])
          .slice(0, 4)
          .forEach(add);
      });

      return brains;
    }

    // Alias mantido por retrocompatibilidade
    getBestBrainsForTrack(trackIndex) {
      return this.getSeedBrainsForTrack(trackIndex);
    }

    /**
     * Retorna os melhores genomas disponíveis de TODAS as pistas,
     * ordenados por fitness. Usado pelo Modo Corrida para semear
     * uma população de 200 com os melhores cérebros já salvos.
     *
     * Inclui completadores e (como fallback) os melhores do histórico geral.
     */
    getAllBestBrains() {
      const brains = [];
      const seen   = new Set();

      const add = (entry) => {
        if (!entry || !entry.brain) return;
        const sig = JSON.stringify(entry.brain.genome || entry.brain).slice(0, 80);
        if (seen.has(sig)) return;
        seen.add(sig);
        brains.push({ brain: entry.brain, fitness: entry.fitness || 0 });
      };

      // 1. Universais (melhor prioridade)
      this.data.universalCompleters.forEach(add);

      // 2. Completadores de cada pista
      [0, 1, 2].forEach(idx => {
        (this.data.completersByTrack[String(idx)] || []).forEach(add);
      });

      // 3. Histórico geral como fallback (inclui não-completadores com bom fitness)
      this.data.history.forEach(add);

      // Ordena por fitness descendente e retorna apenas os brains JSON
      brains.sort((a, b) => b.fitness - a.fitness);
      return brains.map(b => b.brain);
    }

    // ─── Queries ────────────────────────────────────────────────────────────
    isTrackCompleted(trackIndex)  { return this.data.completedTracks.includes(trackIndex); }
    isProjectComplete()           { return this.data.projectComplete; }

    getCompletedCount(trackIndex) {
      return (this.data.completersByTrack[String(trackIndex)] || []).length;
    }

    getStatus() {
      const counts = {};
      [0, 1, 2].forEach(i => { counts[i] = this.getCompletedCount(i); });
      return {
        completedTracks:    this.data.completedTracks,
        completionsByTrack: counts,
        universalCount:     this.data.universalCompleters.length,
        projectComplete:    this.data.projectComplete,
        historyCount:       this.data.history.length,
      };
    }

    getRanking() {
      return [...this.data.history].sort((a, b) => b.fitness - a.fitness);
    }

    // ─── Export / Import JSON ───────────────────────────────────────────────
    exportJSON() {
      return JSON.stringify({
        exportedAt:          new Date().toISOString(),
        version:             4,
        completersByTrack:   this.data.completersByTrack,
        universalCompleters: this.data.universalCompleters,
        completedTracks:     this.data.completedTracks,
        ghostPaths:          this.data.ghostPaths,
        projectComplete:     this.data.projectComplete,
      }, null, 2);
    }

    exportToFile() {
      const json = this.exportJSON();
      const blob = new Blob([json], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `genetic-ai-completers-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }

    importJSON(jsonString) {
      try {
        const imp = JSON.parse(jsonString);
        if (!imp.completersByTrack && !imp.bestByTrack) throw new Error("Formato inválido");

        // Suporte ao formato v3 (bestByTrack) e v4 (completersByTrack)
        const srcByTrack = imp.completersByTrack || imp.bestByTrack || {};

        [0, 1, 2].forEach(idx => {
          const key      = String(idx);
          const incoming = srcByTrack[key] || [];
          // Filtra apenas completadores do arquivo importado
          const incomingCompleters = incoming.filter(c => c.completed !== false);
          const existing = this.data.completersByTrack[key] || [];
          const merged   = [...existing, ...incomingCompleters];
          const deduped  = Array.from(
            new Map(merged.map(c => [c.timestamp + "_" + Math.round(c.fitness), c])).values()
          );
          deduped.sort((a, b) => b.fitness - a.fitness);
          this.data.completersByTrack[key] = deduped.slice(0, MAX_COMPLETERS_PER_TRACK);
        });

        // Universais
        const incomingU = imp.universalCompleters || [];
        const mergedU   = [...this.data.universalCompleters, ...incomingU];
        mergedU.sort((a, b) => b.fitness - a.fitness);
        this.data.universalCompleters = mergedU.slice(0, MAX_UNIVERSAL);

        // Pistas concluídas
        (imp.completedTracks || []).forEach(t => {
          if (!this.data.completedTracks.includes(t)) this.data.completedTracks.push(t);
        });

        // Ghost paths
        Object.entries(imp.ghostPaths || {}).forEach(([k, v]) => {
          if (!this.data.ghostPaths[k]) this.data.ghostPaths[k] = v;
        });

        if (imp.projectComplete) this.data.projectComplete = true;

        this._persist();
        return true;
      } catch (e) {
        console.error("[Storage] Erro ao importar:", e);
        return false;
      }
    }

    importFromFile() {
      return new Promise((resolve) => {
        const input    = document.createElement("input");
        input.type     = "file";
        input.accept   = ".json,application/json";
        input.onchange = (e) => {
          const file = e.target.files[0];
          if (!file) { resolve(false); return; }
          const reader = new FileReader();
          reader.onload = (ev) => resolve(this.importJSON(ev.target.result));
          reader.readAsText(file);
        };
        input.click();
      });
    }

    // Retrocompatibilidade
    exportChampion(trackIndex) {
      const list = this.data.completersByTrack[String(trackIndex)];
      if (!list || !list.length) return null;
      return JSON.stringify(list[0], null, 2);
    }

    importChampion(jsonString, trackIndex = 0) {
      try {
        const entry = JSON.parse(jsonString);
        if (!entry.brain) return false;
        entry.completed  = true; // forçado ao importar manualmente
        entry.trackIndex = trackIndex;
        entry.timestamp  = entry.timestamp || Date.now();
        this._registerCompleter(entry, trackIndex);
        this._persist();
        return true;
      } catch (e) { return false; }
    }

    clear() {
      this.data = this._defaultData();
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  global.StorageManager = StorageManager;
})(typeof window !== "undefined" ? window : global);
