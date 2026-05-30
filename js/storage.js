/**
 * Persistência via localStorage — cérebros, fitness, pistas concluídas e ghost paths.
 * Ghost path: trajetória do campeão para ghost learning entre gerações.
 */
(function (global) {
  const STORAGE_KEY = "geneticDrivingAI_v2";

  class StorageManager {
    constructor() {
      this.data = this.load();
    }

    defaultData() {
      return {
        version: 2,
        champions: [],
        bestByTrack: {},
        completedTracks: [],
        ghostPaths: {},   // novo: trajetórias salvas por pista
        settings: {},
        history: [],
        projectComplete: false,
      };
    }

    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return this.defaultData();
        const parsed = JSON.parse(raw);
        return { ...this.defaultData(), ...parsed };
      } catch (e) {
        console.warn("Storage load failed", e);
        return this.defaultData();
      }
    }

    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        return true;
      } catch (e) {
        console.warn("Storage save failed", e);
        return false;
      }
    }

    saveChampion(car, trackIndex, generation) {
      const entry = {
        brain: car.brain.toJSON(),
        fitness: car.fitness,
        distance: car.distance,
        generation,
        trackIndex,
        trackId: trackIndex + 1,
        timestamp: Date.now(),
        completed: car.completed,
      };
      this.data.champions.unshift(entry);
      if (this.data.champions.length > 20) this.data.champions.pop();
      const key  = String(trackIndex);
      const prev = this.data.bestByTrack[key];
      if (!prev || entry.fitness > prev.fitness) {
        this.data.bestByTrack[key] = entry;
      }
      if (car.completed && !this.data.completedTracks.includes(trackIndex)) {
        this.data.completedTracks.push(trackIndex);
      }
      if (this.data.completedTracks.length >= Track.count()) {
        this.data.projectComplete = true;
      }
      this.save();
      return entry;
    }

    /** Salva ghost path (trajetória) do campeão para a pista */
    saveGhostPath(trackIndex, positions) {
      if (!positions || !positions.length) return;
      // Amostrar a cada 3 posições para economizar espaço
      const sampled = positions.filter((_, i) => i % 3 === 0).slice(0, 500);
      this.data.ghostPaths[String(trackIndex)] = sampled;
      this.save();
    }

    /** Recupera ghost path da pista */
    getGhostPath(trackIndex) {
      return this.data.ghostPaths[String(trackIndex)] || null;
    }

    getBestBrainsForTrack(trackIndex) {
      const brains = [];
      const best   = this.data.bestByTrack[String(trackIndex)];
      if (best) brains.push(best.brain);
      this.data.champions
        .filter((c) => c.trackIndex === trackIndex)
        .slice(0, 5)
        .forEach((c) => brains.push(c.brain));
      return brains;
    }

    getAllSeedBrains() {
      const brains = [];
      Object.values(this.data.bestByTrack).forEach((b) => brains.push(b.brain));
      this.data.champions.slice(0, 10).forEach((c) => brains.push(c.brain));
      return brains;
    }

    isTrackCompleted(trackIndex)  { return this.data.completedTracks.includes(trackIndex); }
    isProjectComplete()           { return this.data.projectComplete || this.data.completedTracks.length >= Track.count(); }

    exportChampion(trackIndex) {
      const best = this.data.bestByTrack[String(trackIndex)];
      if (!best) return null;
      return JSON.stringify(best, null, 2);
    }

    importChampion(jsonString, trackIndex = 0) {
      try {
        const entry = JSON.parse(jsonString);
        if (!entry.brain) return false;
        this.data.bestByTrack[String(trackIndex)] = {
          ...entry, trackIndex, timestamp: Date.now(),
        };
        this.save();
        return true;
      } catch (e) {
        return false;
      }
    }

    clear() {
      this.data = this.defaultData();
      localStorage.removeItem(STORAGE_KEY);
    }

    getRanking() {
      return [...this.data.champions].sort((a, b) => b.fitness - a.fitness);
    }
  }

  global.StorageManager = StorageManager;
})(typeof window !== "undefined" ? window : global);
