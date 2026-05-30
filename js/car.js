/**
 * Car v4 — Física, Sensores e Fitness para direção autônoma.
 *
 * MUDANÇAS PRINCIPAIS:
 *  - computeFitness() reescrito: penalidade de colisão removida do cálculo base.
 *    Morrer já é a pior punição possível (fitness baixo). Penalizar duas vezes
 *    criava distorções que faziam o algoritmo preferir carros imóveis a carros
 *    que tentavam avançar e colidiram perto do fim.
 *  - Bônus de conclusão aumentado e dominante: um completador sempre supera
 *    qualquer não-completador, independentemente de tempo ou velocidade.
 *  - Bônus de velocidade média só conta se o carro completou — evita que
 *    carros rápidos que batem cedo contaminem a seleção.
 *  - idleTimer mais generoso para pistas com curvas fechadas.
 */
(function (global) {
  class Car {
    constructor(brain, track, options = {}) {
      this.brain = brain;
      this.x     = track.checkpoints[0].x;
      this.y     = track.checkpoints[0].y;
      this.angle = track.checkpoints[0].angle;

      this.speed    = 0;
      this.maxSpeed = 6.5;
      this.acc      = 0.25;
      this.friction = 0.05;
      this.width    = 15;
      this.height   = 26;

      this.alive     = true;
      this.completed = false;
      this.fitness   = 0;

      this.checkpointIndex         = 0;
      this.timeAlive               = 0;
      this.totalSpeed              = 0;
      this.idleTimer               = 0;
      this.tempoOcioso             = 0;
      this.ultimoCheckpointDefinido = 0;

      this.sensorRange = 360;
      this.sensors     = [0, 0, 0, 0, 0, 0, 0, 0];
      this.skidMarks   = [];
    }

    update(track) {
      if (!this.alive || this.completed) return;

      // ── Anti-travamento: mata carro que para de avançar ─────────────────
      if (this.checkpointIndex > this.ultimoCheckpointDefinido) {
        this.ultimoCheckpointDefinido = this.checkpointIndex;
        this.tempoOcioso = 0;
      } else {
        this.tempoOcioso++;
      }
      if (this.tempoOcioso > 200) {  // 200 frames (~3 s) sem avançar → elimina
        this.alive = false;
        return;
      }

      this.timeAlive++;
      this.totalSpeed += Math.max(0, this.speed);

      this.castSensors(track);

      // ── Inputs para a rede neural ────────────────────────────────────────
      const totalCPs = track.checkpoints.length;
      const currentCP = track.checkpoints[this.checkpointIndex];
      const nextCP    = track.checkpoints[(this.checkpointIndex + 1) % totalCPs];
      const futureCP  = track.checkpoints[(this.checkpointIndex + 3) % totalCPs];

      const idealAngle = Math.atan2(nextCP.y - this.y, nextCP.x - this.x);
      let angleError   = idealAngle - this.angle;
      while (angleError >  Math.PI) angleError -= Math.PI * 2;
      while (angleError < -Math.PI) angleError += Math.PI * 2;

      const futureIdealAngle = Math.atan2(futureCP.y - this.y, futureCP.x - this.x);
      let futureAngleError   = futureIdealAngle - this.angle;
      while (futureAngleError >  Math.PI) futureAngleError -= Math.PI * 2;
      while (futureAngleError < -Math.PI) futureAngleError += Math.PI * 2;

      const dx             = this.x - currentCP.x;
      const dy             = this.y - currentCP.y;
      const lateralDev     = (dx * currentCP.nx + dy * currentCP.ny) / (track.width / 2);

      const inputs = [
        ...this.sensors,
        Math.sin(angleError),
        Math.cos(angleError),
        Math.sin(futureAngleError),
        Math.cos(futureAngleError),
        lateralDev,
        this.speed / this.maxSpeed,
        this.checkpointIndex / totalCPs,
        Math.hypot(nextCP.x - this.x, nextCP.y - this.y) / 200,
      ];

      const outputs = this.brain.forward(inputs);

      // ── Física ───────────────────────────────────────────────────────────
      if (outputs[0] > 0.5) this.speed += this.acc;
      if (outputs[1] > 0.5) this.speed -= this.acc;

      const turnFactor = 0.085;
      if (outputs[2] > 0.5) this.angle -= turnFactor;
      if (outputs[3] > 0.5) this.angle += turnFactor;

      this.speed *= (1 - this.friction);
      if (Math.abs(this.speed) < 0.01) this.speed = 0;
      if (this.speed > this.maxSpeed)  this.speed = this.maxSpeed;

      this.x += Math.cos(this.angle) * this.speed;
      this.y += Math.sin(this.angle) * this.speed;

      // Skid marks visuais
      if (outputs[2] > 0.6 || outputs[3] > 0.6) {
        this.skidMarks.push({ x: this.x, y: this.y });
        if (this.skidMarks.length > 30) this.skidMarks.shift();
      }

      // Idle kill: elimina carro completamente parado
      if (Math.abs(this.speed) < 0.15) {
        this.idleTimer++;
        if (this.idleTimer > 120) { this.alive = false; return; }
      } else {
        this.idleTimer = 0;
      }

      // ── Colisão com paredes ──────────────────────────────────────────────
      if (!track.isInsideTrack(this.x, this.y)) {
        this.alive = false;
        return;
      }

      // ── Colisão com obstáculos ───────────────────────────────────────────
      for (const obs of track.obstacles) {
        if (Math.hypot(this.x - obs.x, this.y - obs.y) < (obs.radius + 6)) {
          this.alive = false;
          return;
        }
      }

      // ── Checkpoint ───────────────────────────────────────────────────────
      const distToNext = Math.hypot(nextCP.x - this.x, nextCP.y - this.y);
      if (distToNext < track.width * 0.6) {
        this.checkpointIndex++;
        if (this.checkpointIndex >= totalCPs) {
          this.checkpointIndex = totalCPs - 1; // Não deixa passar do fim
          this.completed = true;
          this.alive     = false; // Para a simulação deste carro
        }
      }
    }

    castSensors(track) {
      const angles = [0, Math.PI/6, -Math.PI/6, Math.PI/3, -Math.PI/3, Math.PI/2, -Math.PI/2, Math.PI];
      for (let i = 0; i < angles.length; i++) {
        const rayAngle = this.angle + angles[i];
        let step       = 0;
        const maxStep  = this.sensorRange;
        while (step < maxStep) {
          step += 6;
          if (!track.isInsideTrack(
            this.x + Math.cos(rayAngle) * step,
            this.y + Math.sin(rayAngle) * step
          )) break;
        }
        this.sensors[i] = (maxStep - step) / maxStep;
      }
    }

    /**
     * computeFitness — chamado pelo GA no fim de cada geração.
     *
     * REGRA FUNDAMENTAL:
     *   fitness(qualquer completador) > fitness(qualquer não-completador)
     *
     * Isso garante que, na seleção, completadores sempre prevalecem e seus
     * genes propagam para as gerações seguintes.
     */
    computeFitness(track) {
      const totalCPs       = track.checkpoints.length;
      const progress       = this.checkpointIndex / totalCPs;          // 0..1
      const avgSpeed       = this.timeAlive > 0 ? this.totalSpeed / this.timeAlive : 0;

      // ── Componentes base (não-completador) ───────────────────────────────
      // Peso máximo: chegar longe. Velocidade e tempo são bônus menores.
      let score =
        progress * 500000 +          // Progresso é o que importa
        this.checkpointIndex * 8000 + // Cada checkpoint vale
        this.timeAlive * 0.05;        // Sobrevivência leve (não dominante)

      // ── Bônus de conclusão — sempre maior que qualquer não-completador ───
      // Com progress=1 e checkpointIndex=totalCPs, o base máximo possível é
      // 500000 + totalCPs*8000 + T*0.05. Para garantir que um completador lento
      // supera qualquer não-completador, adicionamos 1.000.000 fixos.
      if (this.completed) {
        score += 1_000_000;
        score += avgSpeed * 500;    // Velocidade só conta se completou
        score += this.timeAlive > 0 ? (1 / this.timeAlive) * 200_000 : 0; // Mais rápido = melhor
      }

      // ── Penalidade por morrer muito cedo (filtra genes ruins logo) ───────
      // Só aplica em não-completadores que morreram antes do 5° checkpoint
      if (!this.completed && this.checkpointIndex < 5) {
        score *= 0.15;
      }

      this.fitness = Math.max(0, score);
    }

    render(ctx, isChampion = false) {
      // Skid marks
      ctx.strokeStyle = "rgba(0,0,0,0.15)";
      ctx.lineWidth   = 2;
      ctx.beginPath();
      this.skidMarks.forEach((m, idx) => {
        if (idx === 0) ctx.moveTo(m.x, m.y);
        else           ctx.lineTo(m.x, m.y);
      });
      ctx.stroke();

      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.angle);

      // Sombra
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(-this.height / 2 + 2, -this.width / 2 + 2, this.height, this.width);

      // Rodas
      ctx.fillStyle = "#111";
      ctx.fillRect(-10, -this.width / 2 - 2, 5, 2);
      ctx.fillRect(-10,  this.width / 2,      5, 2);
      ctx.fillRect(  6, -this.width / 2 - 2,  5, 2);
      ctx.fillRect(  6,  this.width / 2,       5, 2);

      // Carroceria
      if (isChampion) {
        ctx.fillStyle   = "#ffcc00";
        ctx.strokeStyle = "#fff";
      } else {
        ctx.fillStyle   = this.alive ? "#3a7bd5" : "#555555";
        ctx.strokeStyle = "#222";
      }
      ctx.lineWidth = 1.5;
      ctx.fillRect(-this.height / 2, -this.width / 2, this.height, this.width);
      ctx.strokeRect(-this.height / 2, -this.width / 2, this.height, this.width);

      // Para-brisa
      ctx.fillStyle = "rgba(150,220,255,0.7)";
      ctx.fillRect(2, -this.width / 2 + 2, 4, this.width - 4);

      ctx.restore();

      // Aura do campeão
      if (isChampion && this.alive) {
        ctx.save();
        ctx.shadowColor  = "#ffcc00";
        ctx.shadowBlur   = 15;
        ctx.strokeStyle  = "rgba(255,204,0,0.6)";
        ctx.lineWidth    = 3;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 20, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = "#ffcc00";
        ctx.font      = "bold 10px sans-serif";
        ctx.shadowBlur = 0;
        ctx.textAlign  = "center";
        ctx.fillText("CAMPEÃO", this.x, this.y - 25);
        ctx.restore();
      }
    }
  }

  global.Car = Car;
})(typeof window !== "undefined" ? window : global);
