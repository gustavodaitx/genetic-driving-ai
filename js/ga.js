/**
 * Algoritmo genético: elitismo forte, mutação adaptativa por geração,
 * clonagem do top 15 com micro-mutação direcionada, e persistência de ghost path.
 */
(function (global) {
  class GeneticAlgorithm {
    constructor(options = {}) {
      this.populationSize = options.populationSize ?? 200;
      this.eliteClones   = options.eliteClones   ?? 15;   
      this.eliteBreeding = options.eliteBreeding  ?? 25;   
      
      this.mutationRate  = options.mutationRate   ?? 0.12; 
      this.crossoverRate = options.crossoverRate  ?? 0.96;
      this.mutationStrength = options.mutationStrength ?? 0.20; // Ruído sutil (+/- 0.2)
      
      this.tournamentSize   = options.tournamentSize   ?? 5;
      this.generation = 1;
      this.population = [];
      this.bestEver   = null;
      this.ghostPath  = null; 
      this.stats = { bestFitness: 0, avgFitness: 0, bestDistance: 0, avgDistance: 0 };
      this.history = [];
    }

    /** Taxa de mutação adaptativa baseada na geração atual e no tipo de pista */
    getAdaptiveMutationRate(trackIndex = 0) {
      const g = this.generation;
      
      // Se for a Pista 3 (index 2), mantemos a mutação alta por mais tempo
      // para evitar que a população inteira copie um campeão burro
      if (trackIndex === 2) {
        if (g <= 50)  return 0.18; // Mutação agressiva para descobrir caminhos
        if (g <= 120) return 0.08; 
        return 0.03;              // Nunca deixa cair para 0.005
      }

      // Mantém a regra original intacta para as Pistas 1 e 2
      if (g <= 40)  return 0.12; 
      if (g <= 100) return 0.05; 
      if (g <= 180) return 0.02; 
      return 0.005;              
    }

    /** Cria a população inicial com base em cérebros guardados ou do zero */
    createInitialPopulation(track, seedBrains = null, ghostPath = null) {
      this.population = [];
      this.ghostPath = ghostPath;
      
      for (let i = 0; i < this.populationSize; i++) {
        let brain;
        if (seedBrains && seedBrains[i % seedBrains.length]) {
          brain = NeuralNetwork.fromJSON(seedBrains[i % seedBrains.length]);
          if (i >= seedBrains.length) {
            // =================================================================
            // ATUALIZADO: Passando track.index para a mutação adaptativa inicial
            // =================================================================
            brain.mutate(this.getAdaptiveMutationRate(track.index), this.mutationStrength, false);
          }
        } else {
          brain = new NeuralNetwork();
          
          // =================================================================
          // INJEÇÃO DE INTELIGÊNCIA: Instinto de Sobrevivência Inicial (Geração 1)
          // =================================================================
          // Forçamos conexões lógicas básicas nos pesos da rede neural:
          // outputs[0] = Acelerar, outputs[1] = Frear, outputs[2] = Esquerda, outputs[3] = Direita
          
          if (brain.weights && brain.weights[0]) {
            // Exemplo hipotético baseado em uma estrutura típica de pesos [input][output]:
            // Vamos assumir que as primeiras 8 posições dos inputs são os sensores.
            
            // 1. Sensores da Esquerda (índices 1, 2, 3) devem forçar curva para a Direita (output 3)
            if (brain.weights[0][1]) brain.weights[0][1][3] = 0.5;
            if (brain.weights[0][2]) brain.weights[0][2][3] = 0.8;
            
            // 2. Sensores da Direita (índices 4, 5, 6) devem forçar curva para a Esquerda (output 2)
            if (brain.weights[0][4]) brain.weights[0][4][2] = 0.8;
            if (brain.weights[0][5]) brain.weights[0][5][2] = 0.5;
            
            // 3. Sensor Frontal (índice 0) deve acionar o Freio (output 1) se estiver muito perto
            if (brain.weights[0][0]) brain.weights[0][0][1] = 0.7;
            
            // 4. Se a pista estiver livre (sensores baixos), a tendência natural deve ser Acelerar (output 0)
            if (brain.biases && brain.biases[0]) {
              brain.biases[0][0] = 0.3; // Viés positivo para aceleração constante
            }
          }

          // Agora aplicamos uma mutação bem mais leve (25% de chance com 15% de força).
          // Isso garante que eles não sejam clones idênticos e tenham variações de desvio,
          // mas sem destruir o "instinto de fábrica" que injetamos acima.
          brain.mutate(0.25, 0.15, false); 
        }
        
        this.population.push(new Car(brain, track, {
          generation: this.generation,
          ghostPath: this.ghostPath
        }));
      }
    }

    /** Seleção por Torneio */
    tournamentSelect(sortedPopulation) {
      let best = null;
      for (let i = 0; i < this.tournamentSize; i++) {
        const ind = Math.floor(Math.random() * Math.min(sortedPopulation.length, this.populationSize));
        const candidate = sortedPopulation[ind];
        if (!best || candidate.fitness > best.fitness) {
          best = candidate;
        }
      }
      return best;
    }

    /** Evolui a população atual para a próxima geração */
    evolve(track) {
      this.population.forEach(car => car.computeFitness(track));
      const sorted = [...this.population].sort((a, b) => b.fitness - a.fitness);
      
      const best = sorted[0];
      this.stats.bestFitness = best.fitness;
      this.stats.bestDistance = best.checkpointIndex;
      
      const sumFit = this.population.reduce((acc, c) => acc + c.fitness, 0);
      this.stats.avgFitness = sumFit / this.populationSize;

      const children = [];

      // =================================================================
      // ELITISMO INTELIGENTE COM A SUA MUTAÇÃO DE ELITE
      // =================================================================
      // O melhor absoluto de todos é clonado totalmente puro (0 mutações) na posição 0
      if (sorted[0]) {
        children.push(new Car(sorted[0].brain.clone(), track, {
          generation: this.generation + 1,
          ghostPath: this.ghostPath
        }));
      }

      // Os outros 14 clones de elite recebem a sua mutação restrita (isElite = true)
      // para criar pequenas variações do campeão focadas em passar das curvas difíceis
      for (let i = 1; i < this.eliteClones; i++) {
        if (sorted[i]) {
          let eliteBrain = sorted[i].brain.clone();
          // =================================================================
          // ATUALIZADO: Passando track.index para a mutação adaptativa da elite
          // =================================================================
          eliteBrain.mutate(this.getAdaptiveMutationRate(track.index), this.mutationStrength, true); 
          children.push(new Car(eliteBrain, track, {
            generation: this.generation + 1,
            ghostPath: this.ghostPath
          }));
        }
      }

      // Crossover e Mutação Padrão para o resto da população (isElite = false)
      while (children.length < this.populationSize) {
        const pa = this.tournamentSelect(sorted);
        const pb = this.tournamentSelect(sorted);
        
        const childBrain = NeuralNetwork.crossover(pa.brain, pb.brain, this.crossoverRate);
        
        // Aplica a sua mutação regular com força total para gerar comportamentos novos e audaciosos
        // =================================================================
        // ATUALIZADO: Passando track.index para a mutação adaptativa padrão
        // =================================================================
        childBrain.mutate(this.getAdaptiveMutationRate(track.index), this.mutationStrength, false); 
        
        children.push(new Car(childBrain, track, {
          isNewborn: true,
          generation: this.generation + 1,
          ghostPath: this.ghostPath,
        }));
      }

      this.generation++;
      this.population = children;
      track.resetCheckpoints();
      return this.stats;
    }

    getBestCar() {
      if (!this.population.length) return null;
      const score = (c) => c.checkpointIndex * 1000 + c.totalSpeed * 0.1;
      const alive = this.population.filter((c) => c.alive);
      const pool  = alive.length ? alive : this.population;
      return [...pool].sort((a, b) => score(b) - score(a))[0];
    }

    setRates(mutation, crossover) {
      if (mutation  != null) this.mutationRate  = Math.max(0.001, Math.min(0.2, mutation));
      if (crossover != null) this.crossoverRate = Math.max(0.1, Math.min(0.99, crossover));
    }
    
    setPopulationSize(size) {
      this.populationSize = size;
    }
  }

  global.GeneticAlgorithm = GeneticAlgorithm;
})(this || window);