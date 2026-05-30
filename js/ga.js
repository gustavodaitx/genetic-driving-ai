/**
 * GeneticAlgorithm v4 — Elitismo orientado à conclusão de pista.
 *
 * MUDANÇAS PRINCIPAIS:
 *
 *  1. evolve() separa completadores de não-completadores antes de selecionar.
 *     Completadores sempre vão para o topo da elite, independentemente do fitness
 *     numérico, garantindo que seus genes se propaguem.
 *
 *  2. createInitialPopulation() não aplica mutação nos seedBrains das primeiras
 *     N posições — os completadores importados entram puros. O restante da
 *     população é gerado a partir de mutações suaves desses seeds.
 *     Isso preserva o comportamento de conclusão já aprendido.
 *
 *  3. Taxa de mutação adaptativa continua, mas os completadores da elite
 *     recebem mutação mínima (isElite=true) para não destruir o que funciona.
 */
(function (global) {
  class GeneticAlgorithm {
    constructor(options = {}) {
      this.populationSize   = options.populationSize   ?? 200;
      this.eliteClones      = options.eliteClones      ?? 15;
      this.mutationRate     = options.mutationRate     ?? 0.12;
      this.crossoverRate    = options.crossoverRate    ?? 0.96;
      this.mutationStrength = options.mutationStrength ?? 0.20;
      this.tournamentSize   = options.tournamentSize   ?? 5;

      this.generation = 1;
      this.population = [];
      this.ghostPath  = null;
      this.stats = { bestFitness: 0, avgFitness: 0, bestDistance: 0, completorsThisGen: 0 };
    }

    // ── Taxa de mutação adaptativa ─────────────────────────────────────────
    getAdaptiveMutationRate(trackIndex = 0) {
      // Determina a geração relativa dentro da pista (bloco de 6 gerações)
      // Se a geração passar de 18, fazemos mod 6 para continuar o ciclo caso necessário.
      const trackGen = ((this.generation - 1) % 6) + 1;
      
      // Ajuste de balanceamento fino para transferência de aprendizado:
      // Na primeira geração da nova pista, aumentamos a taxa para explorar o traçado novo.
      // Nas seguintes, reduzimos progressivamente para convergir e maximizar os sobreviventes.
      if (trackGen === 1) return 0.14;
      if (trackGen === 2) return 0.08;
      if (trackGen === 3) return 0.045;
      if (trackGen === 4) return 0.022;
      if (trackGen === 5) return 0.010;
      return 0.004;
    }

    // ── Criação da população inicial ───────────────────────────────────────
    /**
     * seedBrains: array de { genome: [...] } vindos do StorageManager.
     * Os primeiros seedBrains.length indivíduos entram SEM mutação (preservados).
     * O restante é gerado mutando esses seeds levemente.
     */
    createInitialPopulation(track, seedBrains = null, ghostPath = null) {
      this.population = [];
      this.ghostPath  = ghostPath;

      const hasSeed  = seedBrains && seedBrains.length > 0;
      const seedCount = hasSeed ? seedBrains.length : 0;

      for (let i = 0; i < this.populationSize; i++) {
        let brain;

        if (hasSeed) {
          const srcBrain = NeuralNetwork.fromJSON(seedBrains[i % seedCount]);
          if (i < seedCount) {
            // Primeiros N: entram puros, sem mutação — preservam o comportamento de conclusão
            brain = srcBrain;
          } else {
            // Resto: mutação leve sobre os seeds para manter diversidade
            brain = srcBrain;
            brain.mutate(this.getAdaptiveMutationRate(track.index) * 0.5, 0.10, true);
          }
        } else {
          // Sem semente: rede aleatória com instintos básicos
          brain = new NeuralNetwork();
          brain.mutate(0.25, 0.15, false);
        }

        this.population.push(new Car(brain, track, {
          generation: this.generation,
          ghostPath:  this.ghostPath,
        }));
      }
    }

    // ── Seleção por torneio ────────────────────────────────────────────────
    tournamentSelect(pool) {
      let best = null;
      for (let i = 0; i < this.tournamentSize; i++) {
        const c = pool[Math.floor(Math.random() * pool.length)];
        if (!best || c.fitness > best.fitness) best = c;
      }
      return best;
    }

    // ── Evolução ──────────────────────────────────────────────────────────
    evolve(track, nextTrack = track) {
      // 1. Calcula fitness de todos no track atual (onde eles correram)
      this.population.forEach(car => car.computeFitness(track));

      // 2. Separa completadores de não-completadores
      const completers    = this.population.filter(c => c.completed);
      const nonCompleters = this.population.filter(c => !c.completed);

      // 3. Ordena cada grupo internamente por fitness
      completers.sort(   (a, b) => b.fitness - a.fitness);
      nonCompleters.sort((a, b) => b.fitness - a.fitness);

      // 4. Elite: completadores primeiro, depois melhores não-completadores
      //    Isso garante que genes de conclusão sempre entram na próxima geração
      const elitePool = [...completers, ...nonCompleters];

      // Stats
      this.stats.bestFitness       = elitePool[0]?.fitness       || 0;
      this.stats.bestDistance      = elitePool[0]?.checkpointIndex || 0;
      this.stats.completorsThisGen = completers.length;
      this.stats.avgFitness = this.population.reduce((s, c) => s + c.fitness, 0) / this.populationSize;

      const children = [];
      const mutRate  = this.getAdaptiveMutationRate(nextTrack.index);

      // 5. Clone puro do melhor absoluto (sem mutação), nascido na próxima pista
      if (elitePool[0]) {
        children.push(new Car(elitePool[0].brain.clone(), nextTrack, {
          generation: this.generation + 1,
          ghostPath:  this.ghostPath,
        }));
      }

      // 6. Clones de elite (mutação mínima, isElite=true), nascidos na próxima pista
      for (let i = 1; i < this.eliteClones && i < elitePool.length; i++) {
        const b = elitePool[i].brain.clone();
        b.mutate(mutRate, this.mutationStrength, true);
        children.push(new Car(b, nextTrack, {
          generation: this.generation + 1,
          ghostPath:  this.ghostPath,
        }));
      }

      // 7. Filhos via crossover a partir do pool completo, nascidos na próxima pista
      while (children.length < this.populationSize) {
        const pa = this.tournamentSelect(elitePool);
        const pb = this.tournamentSelect(elitePool);
        const childBrain = NeuralNetwork.crossover(pa.brain, pb.brain, this.crossoverRate);
        childBrain.mutate(mutRate, this.mutationStrength, false);
        children.push(new Car(childBrain, nextTrack, {
          generation: this.generation + 1,
          ghostPath:  this.ghostPath,
        }));
      }

      this.generation++;
      this.population = children;
      nextTrack.resetCheckpoints();
      return this.stats;
    }

    // ── Melhor carro vivo (para câmera/HUD) ───────────────────────────────
    getBestCar() {
      if (!this.population.length) return null;
      const score = c => c.checkpointIndex * 1000 + c.totalSpeed * 0.1;
      const alive  = this.population.filter(c => c.alive);
      const pool   = alive.length ? alive : this.population;
      return [...pool].sort((a, b) => score(b) - score(a))[0];
    }

    setRates(mutation, crossover) {
      if (mutation  != null) this.mutationRate  = Math.max(0.001, Math.min(0.2,  mutation));
      if (crossover != null) this.crossoverRate = Math.max(0.1,   Math.min(0.99, crossover));
    }

    setPopulationSize(size) { this.populationSize = size; }
  }

  global.GeneticAlgorithm = GeneticAlgorithm;
})(this || window);
