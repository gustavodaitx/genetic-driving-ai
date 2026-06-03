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
/**
 * GeneticAlgorithm v4 — Otimizado para Aprendizado Acelerado e Alta Retenção
 */
(function (global) {
  class GeneticAlgorithm {
    constructor(options = {}) {
      this.populationSize = options.populationSize ?? 200;
      this.eliteClones = options.eliteClones ?? 15;
      this.mutationRate = options.mutationRate ?? 0.12;
      this.crossoverRate = options.crossoverRate ?? 0.96;
      this.mutationStrength = options.mutationStrength ?? 0.20;
      this.tournamentSize = options.tournamentSize ?? 5;

      this.generation = 1;
      this.population = [];
      this.ghostPath = null;
      this.stats = { bestFitness: 0, avgFitness: 0, bestDistance: 0, completorsThisGen: 0 };
    }

    // ── Taxa de mutação adaptativa ─────────────────────────────────────────
    getAdaptiveMutationRate(trackIndex = 0) {
      const trackGen = ((this.generation - 1) % 6) + 1;

      // Se for a Pista 3 (índice 2), usamos uma abordagem muito mais conservadora
      if (trackIndex === 2) {
        if (trackGen === 1) return 0.050; // Metade do original: exploração sutil do novo ambiente
        if (trackGen === 2) return 0.030; // Refinamento
        if (trackGen === 3) return 0.015; // Foco total em estabilizar sobreviventes
        if (trackGen === 4) return 0.008;
        if (trackGen === 5) return 0.004;
        return 0.001;
      }

      // Pistas 1 e 2 continuam com o padrão equilibrado
      if (trackGen === 1) return 0.10;
      if (trackGen === 2) return 0.06;
      if (trackGen === 3) return 0.035;
      if (trackGen === 4) return 0.018;
      if (trackGen === 5) return 0.008;
      return 0.002;
    }

    // ── Criação da população inicial ───────────────────────────────────────
    createInitialPopulation(track, seedBrains = null, ghostPath = null) {
      this.population = [];
      this.ghostPath = ghostPath;

      const hasSeed = seedBrains && seedBrains.length > 0;
      const seedCount = hasSeed ? seedBrains.length : 0;

      for (let i = 0; i < this.populationSize; i++) {
        let brain;

        if (hasSeed) {
          // CORREÇÃO CRÍTICA: Sempre clonar a semente para evitar poluição de memória por referência
          const srcBrain = NeuralNetwork.fromJSON(seedBrains[i % seedCount]);

          if (i < seedCount) {
            // Primeiros N: entram 100% puros para garantir a preservação do conhecimento
            brain = srcBrain.clone();
          } else {
            // Resto: Variações controladas ao redor do conhecimento existente
            brain = srcBrain.clone();
            // Mutação suave inicial para não quebrar a lógica de direção do piloto
            brain.mutate(this.getAdaptiveMutationRate(track.index) * 0.25, 0.05, true);
          }
        } else {
          // Sem semente: rede aleatória limpa
          brain = new NeuralNetwork();
          brain.mutate(0.25, 0.15, false);
        }

        const car = new Car(brain, track, {
          generation: this.generation,
          ghostPath: this.ghostPath,
        });
        // Campeões salvos (seeds puros) são imunes a obstáculos aleatórios
        if (hasSeed && i < seedCount) car.isChampion = true;
        this.population.push(car);
      }
    }

    // ── Modo Corrida ───────────────────────────────────────────────────────
    createRacePopulation(track, raceSeeds = null, ghostPath = null) {
      this.population = [];
      this.ghostPath = ghostPath;

      const hasSeeds = raceSeeds && raceSeeds.length > 0;

      if (!hasSeeds) {
        for (let i = 0; i < this.populationSize; i++) {
          const brain = new NeuralNetwork();
          brain.mutate(0.25, 0.15, false);
          this.population.push(new Car(brain, track, {
            generation: this.generation,
            ghostPath: this.ghostPath,
          }));
        }
        return;
      }

      const seedCount = raceSeeds.length;

      for (let i = 0; i < this.populationSize; i++) {
        const srcJSON = raceSeeds[i % seedCount];
        const srcBrain = NeuralNetwork.fromJSON(srcJSON);

        if (i < seedCount) {
          // Representantes puristas — imunes a obstáculos (campeões confirmados)
          const car = new Car(srcBrain.clone(), track, {
            generation: this.generation,
            ghostPath: this.ghostPath,
          });
          car.isChampion = true;
          this.population.push(car);
        } else {
          // CORREÇÃO CRÍTICA: .clone() antes de aplicar mutações competitivas discretas
          const brainClone = srcBrain.clone();
          const mutStrength = i < seedCount * 3 ? 0.01 : 0.04;
          brainClone.mutate(0.02, mutStrength, true);

          this.population.push(new Car(brainClone, track, {
            generation: this.generation,
            ghostPath: this.ghostPath,
          }));
        }
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
      // Ajuste dinâmico de elitismo para pistas complexas
      // Mantém mais cópias dos melhores carros vivas na pista 3
      const activeEliteClones = track.index === 2 ? Math.floor(this.eliteClones * 1.5) : this.eliteClones;
      // 1. Calcula fitness de todos no track atual
      this.population.forEach(car => car.computeFitness(track));

      // 2. Separa completadores de não-completadores
      const completers = this.population.filter(c => c.completed);
      const nonCompleters = this.population.filter(c => !c.completed);

      // 3. Ordena cada grupo internamente por fitness
      completers.sort((a, b) => b.fitness - a.fitness);
      nonCompleters.sort((a, b) => b.fitness - a.fitness);

      // 4. Elite: completadores primeiro
      const elitePool = [...completers, ...nonCompleters];

      // Mapeamento de estatísticas
      this.stats.bestFitness = elitePool[0]?.fitness || 0;
      this.stats.bestDistance = elitePool[0]?.checkpointIndex || 0;
      this.stats.completorsThisGen = completers.length;
      this.stats.avgFitness = this.population.reduce((s, c) => s + c.fitness, 0) / this.populationSize;

      const children = [];
      const mutRate = this.getAdaptiveMutationRate(nextTrack.index);

      // 5. Clone puro do campeão absoluto (Garante estabilidade e elitismo estrito)
      if (elitePool[0]) {
        const eliteCar = new Car(elitePool[0].brain.clone(), nextTrack, {
          generation: this.generation + 1,
          ghostPath: this.ghostPath,
        });
        // Campeão absoluto é imune a obstáculos — já provou que completa a pista
        if (elitePool[0].completed) eliteCar.isChampion = true;
        children.push(eliteCar);
      }

      // 6. Clones de elite (Ajuste para micro-exploração na pista 3)
      for (let i = 1; i < this.activeEliteClones && i < elitePool.length; i++) {
        const b = elitePool[i].brain.clone();
        // Se for pista 3, reduz a força do desvio para apenas 5% (0.05), preservando o cérebro
        const strength = track.index === 2 ? 0.05 : this.mutationStrength * 0.5;
        b.mutate(mutRate * 0.3, strength, true);
        children.push(new Car(b, nextTrack, {
          generation: this.generation + 1,
          ghostPath: this.ghostPath,
        }));
      }

      // 7. Filhos via crossover dinâmico
      while (children.length < this.populationSize) {
        const pa = this.tournamentSelect(elitePool);
        const pb = this.tournamentSelect(elitePool);

        let childBrain;
        if (Math.random() < this.crossoverRate) {
          childBrain = NeuralNetwork.crossover(pa.brain, pb.brain, this.crossoverRate);
        } else {
          childBrain = pa.fitness > pb.fitness ? pa.brain.clone() : pb.brain.clone();
        }

        // Reduz a força de mutação dos filhos na pista 3 para evitar mortes em massa
        const currentStrength = track.index === 2 ? 0.08 : this.mutationStrength;
        childBrain.mutate(mutRate, currentStrength, false);

        children.push(new Car(childBrain, nextTrack, {
          generation: this.generation + 1,
          ghostPath: this.ghostPath,
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
      const alive = this.population.filter(c => c.alive);
      const pool = alive.length ? alive : this.population;
      return [...pool].sort((a, b) => score(b) - score(a))[0];
    }

    setRates(mutation, crossover) {
      if (mutation != null) this.mutationRate = Math.max(0.001, Math.min(0.2, mutation));
      if (crossover != null) this.crossoverRate = Math.max(0.1, Math.min(0.99, crossover));
    }

    setPopulationSize(size) { this.populationSize = size; }
  }

  global.GeneticAlgorithm = GeneticAlgorithm;
})(this || window);