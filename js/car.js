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
      this.laps = 0;
      this.brain = brain;
      this.x = track.checkpoints[0].x;
      this.y = track.checkpoints[0].y;
      this.angle = track.checkpoints[0].angle;

      this.speed = 0;
      this.maxSpeed = 6.0;
      this.acc = 0.04;          // aceleração gradual (0→100 em ~4s a 60fps)
      this.friction = 0.03;     // frenagem mais lenta
      this.brakePower = 0.12;   // frenagem com S
      this.width = 15;
      this.height = 26;

      // Sistema de marchas
      this.gear = 1;
      this.gearRatios = [0, 1.0, 1.8, 2.8, 3.8, 5.0, 6.0]; // índice = marcha
      this.gearUpTimer = 0;

      this.alive = true;
      this.completed = false;
      this.fitness = 0;

      this.checkpointIndex = 0;
      this.timeAlive = 0;
      this.totalSpeed = 0;
      this.totalRotation = 0;
      this.idleTimer = 0;
      this.tempoOcioso = 0;
      this.ultimoCheckpointDefinido = 0;
      this.longRange = 800;

      this.sensorRange = 500;
      this.sensorCount = 20;
      this.sensors = new Array(this.sensorCount).fill(0);
      this.skidMarks = [];
      this.vx = 0;
      this.vy = 0;
    }

    update(track) {

      if (!this.alive || this.completed) return;

      // Anti-travamento
      if (this.checkpointIndex > this.ultimoCheckpointDefinido) {
        this.ultimoCheckpointDefinido = this.checkpointIndex;
        this.tempoOcioso = 0;
      } else {
        this.tempoOcioso++;
      }

      if (this.tempoOcioso > 400) {
        this.alive = false;
        return;
      }

      this.timeAlive++;
      this.totalSpeed += Math.max(0, this.speed);

      // Atualiza sensores
      this.castSensors(track);
      const longSensors = this.castLongSensors(track);

      const totalCPs = track.finishCPIndex != null ? track.finishCPIndex : track.checkpoints.length;

      const currentCP =
        track.checkpoints[this.checkpointIndex];

      const nextCP =
        track.checkpoints[
        Math.min(
          this.checkpointIndex + 1,
          totalCPs - 1
        )
        ];

      // LOOKAHEAD DINÂMICO
      const lookAhead =
        Math.floor(4 + this.speed * 2);

      const futureCP =
        track.checkpoints[
        Math.min(
          this.checkpointIndex + lookAhead,
          totalCPs - 1
        )
        ];

      // Ângulo ideal
      const idealAngle =
        Math.atan2(
          nextCP.y - this.y,
          nextCP.x - this.x
        );

      let angleError =
        idealAngle - this.angle;

      while (angleError > Math.PI)
        angleError -= Math.PI * 2;

      while (angleError < -Math.PI)
        angleError += Math.PI * 2;

      // Ângulo futuro
      const futureIdealAngle =
        Math.atan2(
          futureCP.y - this.y,
          futureCP.x - this.x
        );

      let futureAngleError =
        futureIdealAngle - this.angle;

      while (futureAngleError > Math.PI)
        futureAngleError -= Math.PI * 2;

      while (futureAngleError < -Math.PI)
        futureAngleError += Math.PI * 2;

      // Desvio lateral
      const dx = this.x - currentCP.x;
      const dy = this.y - currentCP.y;

      const lateralDev =
        (dx * currentCP.nx +
          dy * currentCP.ny) /
        (track.width / 2);

      // Espaço livre esquerda/direita (compatível com 20 sensores)
      const half = this.sensorCount / 2;

      const leftSpace =
        this.sensors
          .slice(0, Math.floor(half))
          .reduce((a, b) => a + b, 0) /
        Math.floor(half);

      const rightSpace =
        this.sensors
          .slice(Math.ceil(half))
          .reduce((a, b) => a + b, 0) /
        Math.floor(half);

      // Entradas IA
      const inputs = [

        ...this.sensors,
        ...longSensors,

        Math.sin(angleError),
        Math.cos(angleError),

        Math.sin(futureAngleError),
        Math.cos(futureAngleError),

        lateralDev,

        this.speed / this.maxSpeed,

        leftSpace,
        rightSpace,

        this.checkpointIndex / totalCPs,

        Math.hypot(
          nextCP.x - this.x,
          nextCP.y - this.y
        ) / 300
      ];

      const outputs =
        this.brain.forward(inputs);

      // 0 = acelerar
      // 1 = frear
      // 2 = direção contínua

      // Física Vetorial (Componentes frontal/lateral para derrapagem)
      let vForward = this.vx * Math.cos(this.angle) + this.vy * Math.sin(this.angle);
      let vLateral = -this.vx * Math.sin(this.angle) + this.vy * Math.cos(this.angle);

      if (outputs[0] > 0.5) {
        const gearMax = this.gearRatios[this.gear];
        if (vForward < gearMax) {
          vForward += this.acc;
        }
        if (vForward >= gearMax * 0.95 && this.gear < 6) {
          this.gear++;
        }
      } else {
        if (vForward < this.gearRatios[Math.max(1, this.gear - 1)] * 0.5 && this.gear > 1) {
          this.gear--;
        }
      }

      // Freio
      if (outputs[1] > 0.5) {
        vForward -= this.brakePower;
        if (vForward < 0) vForward = 0;
      }

      // DIREÇÃO ANALÓGICA
      const steering = outputs[2] * 2 - 1;
      let actualSteer = 0;

      if (vForward > 0.3) {
        const speedRatio = Math.min(1, vForward / this.maxSpeed);
        const maxSteer = 0.12 - speedRatio * 0.05;
        actualSteer = steering * maxSteer;
        this.angle += actualSteer;
      }

      this.totalRotation += Math.abs(actualSteer);

      // Fricções e Derrapagem
      vForward *= (1 - this.friction);
      if (Math.abs(vForward) < 0.01) vForward = 0;

      // Se estiver virando bruscamente, diminui a aderência lateral para derrapar
      const isTurningSharply = Math.abs(actualSteer) > 0.02;
      const grip = isTurningSharply ? 0.06 : 0.18;
      vLateral *= (1 - grip);
      if (Math.abs(vLateral) < 0.01) vLateral = 0;

      // Reconstrução do vetor global de velocidade
      this.vx = vForward * Math.cos(this.angle) - vLateral * Math.sin(this.angle);
      this.vy = vForward * Math.sin(this.angle) + vLateral * Math.cos(this.angle);

      // Limite de velocidade global
      const globalSpeed = Math.hypot(this.vx, this.vy);
      if (globalSpeed > this.maxSpeed) {
        this.vx *= this.maxSpeed / globalSpeed;
        this.vy *= this.maxSpeed / globalSpeed;
      }

      this.speed = Math.hypot(this.vx, this.vy);

      this.x += this.vx;
      this.y += this.vy;

      // Skid Marks por derrapagem lateral ou esterçamento acentuado
      if (Math.abs(vLateral) > 0.4 || Math.abs(actualSteer) > 0.03) {
        this.skidMarks.push({
          x: this.x,
          y: this.y
        });

        if (this.skidMarks.length > 30)
          this.skidMarks.shift();
      }

      // Anti-giro
      if (
        this.totalRotation >
        Math.PI * 4 &&
        this.checkpointIndex < 2
      ) {
        this.alive = false;
        return;
      }

      // Idle Kill
      if (Math.abs(this.speed) < 0.15) {

        this.idleTimer++;

        if (this.idleTimer > 120) {
          this.alive = false;
          return;
        }

      } else {
        this.idleTimer = 0;
      }

      // Parede
      if (!track.isInsideTrack(this.x, this.y)) {
        this.alive = false;
        return;
      }

      // Obstáculos — campeões salvos (isChampion) são imunes para garantir
      // que completem a pista do início ao fim sem penalidades aleatórias.
      if (!this.isChampion) {
        for (const obs of track.obstacles) {

          if (
            Math.hypot(
              this.x - obs.x,
              this.y - obs.y
            ) < obs.radius + 6
          ) {
            this.alive = false;
            return;
          }
        }
      }

      // Checkpoint / Finish
      //
      // Detecção por cruzamento de linha: o carro avança o checkpoint quando
      // sua projeção ao longo do eixo DA PISTA ultrapassa o ponto do checkpoint.
      // Isso garante que o carro realmente atravesse a linha (não apenas passe perto).
      //
      // fwdCP = projeção do vetor (carro→CP) no eixo tangente da pista
      // Se fwdCP < 0, o carro JÁ passou o checkpoint
      // Também exige estar suficientemente próximo lateralmente (dentro da pista)

      const cpFwdX = Math.cos(nextCP.angle); // tangente ao longo da pista no CP
      const cpFwdY = Math.sin(nextCP.angle);
      const toCPx = nextCP.x - this.x;
      const toCPy = nextCP.y - this.y;
      const fwdDist = toCPx * cpFwdX + toCPy * cpFwdY;  // distância ao longo da pista
      const latDist = Math.abs(-toCPx * cpFwdY + toCPy * cpFwdX); // distância lateral

      // Avança checkpoint quando:
      //  - lateralmente dentro da pista (latDist < meia-largura * 1.1)
      //  - passou a linha ou está muito próximo radialmente
      const withinLat = latDist < track.width * 0.55;
      const crossedLine = fwdDist <= 0;                 // já cruzou a linha
      const veryClose = Math.hypot(toCPx, toCPy) < track.width * 0.35; // tolerância perto
      if (withinLat && crossedLine) {

        this.checkpointIndex++;

        const finishIdx =
          track.finishCPIndex != null
            ? track.finishCPIndex
            : totalCPs - 1;

        if (this.checkpointIndex === finishIdx) {

          this.laps++;

          this.completed = true;
          this.alive = false;

          return;
        }
      }
    }

    castSensors(track) {
      const fov = Math.PI; // 180°
      const start = -fov / 2;
      const stepAngle = fov / (this.sensorCount - 1);

      for (let i = 0; i < this.sensorCount; i++) {
        const rayAngle = this.angle + start + i * stepAngle;

        let dist = 0;

        while (dist < this.sensorRange) {
          dist += 4;

          const px = this.x + Math.cos(rayAngle) * dist;
          const py = this.y + Math.sin(rayAngle) * dist;

          if (!track.isInsideTrack(px, py)) {
            break;
          }
        }

        this.sensors[i] = 1 - dist / this.sensorRange;
      }
    }

    castLongSensors(track) {
      const angles = [
        -Math.PI / 4,
        0,
        Math.PI / 4
      ];

      const result = [];

      for (const a of angles) {
        const rayAngle = this.angle + a;

        let dist = 0;

        while (dist < this.longRange) {
          dist += 8;

          const px = this.x + Math.cos(rayAngle) * dist;
          const py = this.y + Math.sin(rayAngle) * dist;

          if (!track.isInsideTrack(px, py)) break;
        }

        result.push(1 - dist / this.longRange);
      }

      return result;
    }

    /**
     * computeFitness — chamado pelo GA no fim de cada geração.
     *
     * REGRA FUNDAMENTAL:
     *   fitness(qualquer completador) > fitness(qualquer não-completador)
     *
     * Anti-giro: totalRotation agora acumula RADIANOS reais de rotação.
     * Uma curva de 90° = ~1.57 rad. Girar no eixo 3 vezes = ~19 rad.
     * Penalizamos agressivamente acima de 3π rad (~9.4 rad = ~1.5 volta).
     */
    computeFitness(track) {
      const totalCPs = track.finishCPIndex != null ? track.finishCPIndex : track.checkpoints.length;
      const progress = this.checkpointIndex / totalCPs;
      const avgSpeed = this.timeAlive > 0 ? this.totalSpeed / this.timeAlive : 0;

      // ── Componentes base ─────────────────────────────────────────────────
      let score =
        progress * 500000 +
        this.checkpointIndex * 8000 +
        this.timeAlive * 0.05;

      // ── Bônus de conclusão dominante ─────────────────────────────────────
      if (this.completed) {
        score += 1_000_000;
        score += avgSpeed * 500;
        score += this.timeAlive > 0 ? (1 / this.timeAlive) * 200_000 : 0;
      }

      // ── Penalidade por morte precoce ─────────────────────────────────────
      if (!this.completed && this.checkpointIndex < 5) {
        score *= 0.15;
      }

      // ── Bônus de alinhamento com próximo checkpoint ──────────────────────
      const nextCP = track.checkpoints[Math.min(this.checkpointIndex + 1, totalCPs - 1)];
      const desiredAngle = Math.atan2(nextCP.y - this.y, nextCP.x - this.x);
      let diff = Math.abs(desiredAngle - this.angle);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      score += (Math.PI - diff) * 4000;

      // ── Penalidade de rotação (anti-giro no eixo) ────────────────────────
      // totalRotation = radianos reais acumulados
      // Limite tolerado: 3π rad (~540° = curvas normais de uma pista)
      // Acima disso: penalidade cresce ao quadrado para esmagar giradores
      const ROT_TOLERANCE = Math.PI * 3;   // ~9.4 rad
      if (this.totalRotation > ROT_TOLERANCE) {
        const excess = this.totalRotation - ROT_TOLERANCE;
        // Penalidade quadrática: dobrar o giro além do limite = 4× a penalidade
        score -= excess * excess * 8000;
      }

      // Penalidade extra para giro extremo (zerinho / loop)
      // 2π rad = 1 volta completa parado → fitness despencado
      const ROT_HARD = Math.PI * 6;        // ~18.8 rad
      if (this.totalRotation > ROT_HARD) {
        score *= 0.05; // 95% de desconto: esse carro é inútil
      }

      this.fitness = Math.max(0, score);
    }

    render(ctx, isChampion = false) {
      // Skid marks
      ctx.strokeStyle = "rgba(0,0,0,0.15)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.skidMarks.forEach((m, idx) => {
        if (idx === 0) ctx.moveTo(m.x, m.y);
        else ctx.lineTo(m.x, m.y);
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
      ctx.fillRect(-10, this.width / 2, 5, 2);
      ctx.fillRect(6, -this.width / 2 - 2, 5, 2);
      ctx.fillRect(6, this.width / 2, 5, 2);

      // Carroceria
      if (isChampion) {
        ctx.fillStyle = "#ffcc00";
        ctx.strokeStyle = "#fff";
      } else {
        ctx.fillStyle = this.alive ? "#3a7bd5" : "#555555";
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
        ctx.shadowColor = "#ffcc00";
        ctx.shadowBlur = 15;
        ctx.strokeStyle = "rgba(255,204,0,0.6)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 20, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = "#ffcc00";
        ctx.font = "bold 10px sans-serif";
        ctx.shadowBlur = 0;
        ctx.textAlign = "center";
        ctx.fillText("CAMPEÃO", this.x, this.y - 25);
        ctx.restore();
      }
    }
  }

  global.Car = Car;
})(typeof window !== "undefined" ? window : global);
