/**
 * Rede neural feedforward profissional adaptada para direção autônoma (16 Inputs).
 */
(function (global) {
  const INPUT_SIZE  = 17;  // ATUALIZADO: Cobertura completa com 9 sensores + info de direcao e velocidade
  const HIDDEN_SIZE = 20;  // Camada oculta balanceada
  const OUTPUT_SIZE = 4;   // [Acelerar, Frear, Esquerda, Direita]

  function randomWeight() { return (Math.random() * 2 - 1) * 0.5; }
  function sigmoid(x)     { return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, x)))); }

  class NeuralNetwork {
    constructor(genome) {
      this.inputSize  = INPUT_SIZE;
      this.hiddenSize = HIDDEN_SIZE;
      this.outputSize = OUTPUT_SIZE;
      // Recalcula o comprimento do genoma automaticamente com base nos tamanhos definidos
      this.genomeLength = (INPUT_SIZE * HIDDEN_SIZE) + HIDDEN_SIZE + (HIDDEN_SIZE * OUTPUT_SIZE) + OUTPUT_SIZE;

      if (genome && genome.length === this.genomeLength) {
        this.genome = genome.slice();
      } else {
        this.genome = Array.from({ length: this.genomeLength }, randomWeight);
      }
      this.unpack();
    }

    unpack() {
      let i = 0;
      this.w1 = [];
      for (let r = 0; r < HIDDEN_SIZE; r++) {
        this.w1[r] = [];
        for (let c = 0; c < INPUT_SIZE; c++) this.w1[r][c] = this.genome[i++];
      }
      this.b1 = [];
      for (let r = 0; r < HIDDEN_SIZE; r++) this.b1[r] = this.genome[i++];
      
      this.w2 = [];
      for (let r = 0; r < OUTPUT_SIZE; r++) {
        this.w2[r] = [];
        for (let c = 0; c < HIDDEN_SIZE; c++) this.w2[r][c] = this.genome[i++];
      }
      this.b2 = [];
      for (let r = 0; r < OUTPUT_SIZE; r++) this.b2[r] = this.genome[i++];
    }

    forward(inputs) {
      const hidden = [];
      for (let h = 0; h < HIDDEN_SIZE; h++) {
        let sum = this.b1[h];
        // O loop agora percorre até 16 inputs
        for (let j = 0; j < INPUT_SIZE; j++) sum += (inputs[j] || 0) * this.w1[h][j];
        hidden[h] = Math.tanh(sum);
      }
      const outputs = [];
      for (let o = 0; o < OUTPUT_SIZE; o++) {
        let sum = this.b2[o];
        for (let h = 0; h < HIDDEN_SIZE; h++) sum += hidden[h] * this.w2[o][h];
        outputs[o] = sigmoid(sum);
      }
      return outputs;
    }

    static crossover(parentA, parentB, rate) {
      const childGenome = [];
      // O blockSize permanece dinâmico para garantir que o crossover funcione independente do tamanho da rede
      const blockSize = Math.floor(parentA.genomeLength / HIDDEN_SIZE);
      for (let i = 0; i < parentA.genomeLength; i++) {
        const block = Math.floor(i / blockSize);
        if (block % 2 === 0 && Math.random() < rate) {
          childGenome.push(parentB.genome[i]);
        } else {
          childGenome.push(parentA.genome[i]);
        }
      }
      return new NeuralNetwork(childGenome);
    }

    mutate(rate, strength, isElite = false) {
      const actualRate = isElite ? rate * 0.2 : rate;
      const actualStrength = isElite ? strength * 0.3 : strength;

      for (let i = 0; i < this.genome.length; i++) {
        const weightImportance = Math.abs(this.genome[i]);
        const adaptiveThreshold = weightImportance > 0.6 ? actualRate * 0.5 : actualRate;

        if (Math.random() < adaptiveThreshold) {
          const delta = (Math.random() + Math.random() + Math.random() - 1.5) * actualStrength;
          this.genome[i] += delta;
          this.genome[i] = Math.max(-2, Math.min(2, this.genome[i]));
        }
      }
      this.unpack();
    }

    clone()  { return new NeuralNetwork(this.genome.slice()); }
    toJSON() { return { genome: this.genome.slice() }; }

    static fromJSON(data) {
      if (!data || !data.genome) return new NeuralNetwork();
      // O construtor chamará o unpack e ajustará automaticamente
      return new NeuralNetwork(data.genome);
    }
  }

  global.NeuralNetwork = NeuralNetwork;
})(typeof window !== "undefined" ? window : global);