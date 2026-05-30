/**
 * Física, Sensores e Algoritmo de Avaliação do Carro Autônomo
 */
(function (global) {
  class Car {
    constructor(brain, track, options = {}) {
      this.brain = brain;
      this.x = track.checkpoints[0].x;
      this.y = track.checkpoints[0].y;
      this.angle = track.checkpoints[0].angle;
      
      this.speed = 0;
      this.maxSpeed = 6.5; // Mantido rápido para as retas
      this.acc = 0.25;     // Arrancada forte para retomar velocidade pós-curva
      this.friction = 0.05;
      this.width = 15;
      this.height = 26;
      
      this.alive = true;
      this.completed = false;
      this.fitness = 0;
      
      this.checkpointIndex = 0;
      this.timeAlive = 0;
      this.totalSpeed = 0;
      this.framesNormais = 0;
      this.idleTimer = 0;

      this.sensorRange = 360;
      this.sensors = [0, 0, 0, 0, 0, 0, 0, 0]; 
      this.skidMarks = [];

      this.maxOciosidade = 300; // Tempo seguro para manobras complexas
      this.tempoOcioso = 0;
      this.ultimoCheckpointDefinido = 0;
      this.idleTimerThreshold = 250; // Aumente o limite de freagem
    }

    update(track) {
      if (!this.alive || this.completed) return;

      // =================================================================
      // 1. SISTEMA ANTITRAVAMENTO CORRIGIDO
      // =================================================================
      if (this.checkpointIndex > this.ultimoCheckpointDefinido) {
        this.ultimoCheckpointDefinido = this.checkpointIndex;
        this.tempoOcioso = 0; 
      } else {
        this.tempoOcioso++;
      }

      if (this.tempoOcioso > 150) {
        this.alive = false;
        this.fitness *= 0.1; // Punição ainda mais severa para o carro que desiste/tranca
        return;
      }

      this.timeAlive++;
      this.totalSpeed += this.speed;

      this.castSensors(track);

      // =================================================================
      // ANTECIPAÇÃO DE CURVAS: Próximo CP e CP do Futuro (Melhora Aprendizado)
      // =================================================================
      const totalCPs = track.checkpoints.length;
      const currentCP = track.checkpoints[this.checkpointIndex];
      const nextCP = track.checkpoints[(this.checkpointIndex + 1) % totalCPs];
      const futureCP = track.checkpoints[(this.checkpointIndex + 3) % totalCPs]; // Olha 3 checkpoints à frente
      
      // Erro de ângulo imediato
      const idealAngle = Math.atan2(nextCP.y - this.y, nextCP.x - this.x);
      let angleError = idealAngle - this.angle;
      while (angleError > Math.PI) angleError -= Math.PI * 2;
      while (angleError < -Math.PI) angleError += Math.PI * 2;

      // Erro de ângulo futuro (Antecipação para pistas 2 e 3)
      const futureIdealAngle = Math.atan2(futureCP.y - this.y, futureCP.x - this.x);
      let futureAngleError = futureIdealAngle - this.angle;
      while (futureAngleError > Math.PI) futureAngleError -= Math.PI * 2;
      while (futureAngleError < -Math.PI) futureAngleError += Math.PI * 2;

      const dx = this.x - currentCP.x;
      const dy = this.y - currentCP.y;
      const lateralDeviation = (dx * currentCP.nx + dy * currentCP.ny) / (track.width / 2);

      // Nova lista de inputs expandida para dar consciência de mapa à IA
      const inputs = [
        ...this.sensors,                                 
        Math.sin(angleError),                            
        Math.cos(angleError),                            
        Math.sin(futureAngleError), // INPUT NOVO: Seno do ângulo da próxima curva
        Math.cos(futureAngleError), // INPUT NOVO: Cosseno do ângulo da próxima curva
        lateralDeviation,                                
        this.speed / this.maxSpeed,                      
        this.checkpointIndex / totalCPs, 
        Math.hypot(nextCP.x - this.x, nextCP.y - this.y) / 200 
      ];

      // Nota: Certifique-se de que a sua classe NeuralNetwork aceite o novo tamanho 
      // de inputs (passou de 14 para 16 inputs com as variáveis do futureCP).
      const outputs = this.brain.forward(inputs);

      // =================================================================
      // CORREÇÃO DA FÍSICA DE CURVA: Força de esterço aprimorada
      // =================================================================
      if (outputs[0] > 0.5) this.speed += this.acc; 
      if (outputs[1] > 0.5) this.speed -= this.acc; 
      
      // Ajuste: Substituído multiplicador dinâmico de velocidade para garantir que 
      // o carro consiga manobrar e girar o volante mesmo se estiver quase parado freando na curva de 90°
      const turnFactor = 0.085; 
      if (outputs[2] > 0.5) this.angle -= turnFactor; // Curva Esquerda consistente
      if (outputs[3] > 0.5) this.angle += turnFactor; // Curva Direita consistente

      // Física Básica e Atrito
      this.speed *= (1 - this.friction);
      if (Math.abs(this.speed) < 0.01) this.speed = 0;
      if (this.speed > this.maxSpeed) this.speed = this.maxSpeed;

      this.x += Math.cos(this.angle) * this.speed;
      this.y += Math.sin(this.angle) * this.speed;

      if (outputs[2] > 0.6 || outputs[3] > 0.6) {
        this.skidMarks.push({x: this.x, y: this.y});
        if(this.skidMarks.length > 30) this.skidMarks.shift();
      }

      // IDLE KILL Suavizado para as curvas travadas da largada
      if (Math.abs(this.speed) < 0.15) {
        this.idleTimer++;
        if (this.idleTimer > 100) { 
          this.alive = false; 
          this.fitness *= 0.5; 
          return; 
        }
      } else {
        this.idleTimer = 0;
      }

      if (!track.isInsideTrack(this.x, this.y)) {
        this.alive = false;
        return;
      }

      for (let obs of track.obstacles) {
        if (Math.hypot(this.x - obs.x, this.y - obs.y) < (obs.radius + 6)) {
          this.alive = false;
          return;
        }
      }

      const distToCheckpoint = Math.hypot(nextCP.x - this.x, nextCP.y - this.y);
      if (distToCheckpoint < (track.width * 0.6)) {
        this.checkpointIndex = (this.checkpointIndex + 1) % track.checkpoints.length;
        if (this.checkpointIndex === 0) {
          this.completed = true;
        }
      }
    }

    castSensors(track) {
      const angles = [0, Math.PI/6, -Math.PI/6, Math.PI/3, -Math.PI/3, Math.PI/2, -Math.PI/2, Math.PI];
      for (let i = 0; i < angles.length; i++) {
        const rayAngle = this.angle + angles[i];
        let step = 0;
        const maxStep = this.sensorRange;

        while (step < maxStep) {
          step += 6;
          const checkX = this.x + Math.cos(rayAngle) * step;
          const checkY = this.y + Math.sin(rayAngle) * step;

          if (!track.isInsideTrack(checkX, checkY)) {
            break;
          }
        }
        this.sensors[i] = (maxStep - step) / maxStep; 
      }
    }

    // =================================================================
    // IMPLEMENTAÇÃO REFINADA: RECOMPENSAS DIRECIONADAS DE APRENDIZADO
    // =================================================================
    computeFitness(track) {
      const progressPercent = this.checkpointIndex / track.checkpoints.length;
      const checkpointCount = this.checkpointIndex;
      const averageSpeed = this.timeAlive > 0 ? (this.totalSpeed / this.timeAlive) : 0;

      const currentCP = track.checkpoints[this.checkpointIndex];
      const idealAngle = currentCP ? currentCP.angle : this.angle;
      let angleError = Math.abs(idealAngle - this.angle);
      while(angleError > Math.PI) angleError -= Math.PI * 2;
      const trackAlignmentReward = Math.abs(angleError) < 0.25 ? 150 : -50; // Recompensa aumentada para seguir traçado correto

      const dx = this.x - (currentCP ? currentCP.x : this.x);
      const dy = this.y - (currentCP ? currentCP.y : this.y);
      const distCentro = Math.hypot(dx, dy);
      
      // Recompensa agressiva para se manter no meio da pista (evita raspar em paredes nas curvas fechadas das pistas 2 e 3)
      const centerReward = distCentro < (track.width * 0.25) ? 100 : -75;

      // Penalidade dinâmica: pune severamente colisões se o carro estava correndo sem precisão
      const collisionPenalty = !this.alive && !this.completed ? 150000 : 0;

      // 1. Base estrutural de pontuação limpa do seu projeto
      let baseFitness = 
        (progressPercent * 300000) +  // Aumentado peso do progresso total
        (checkpointCount * 15000) +   // Mais recompensa por quebrar barreiras de checkpoint
        (this.timeAlive * 0.1) +      
        (averageSpeed * 400) +        
        trackAlignmentReward + 
        centerReward;

      // 2. Condicional para a Pista 3 e Pista 2: Bonificação por direção tática
      if (track.index === 1 || track.index === 2) {
        // Premiar carros estáveis que não ficam apenas dando trancos rápidos nas paredes
        if (averageSpeed > 1.8 && averageSpeed < 4.2) {
          baseFitness += 90000; 
        }
      } else {
        // Pista 1: Velocidade pura
        baseFitness += this.totalSpeed * 0.15;
      }

      // 3. Punição severa caso morra logo nos primeiros 3 checkpoints (filtra heranças ruins)
      if (!this.alive && this.checkpointIndex <= 3) {
        baseFitness *= 0.2;
      }

      this.fitness = baseFitness - collisionPenalty;

      if (this.completed) {
        this.fitness += 800000; 
      }

      if (this.fitness < 0) this.fitness = 0;
    }

    render(ctx, isChampion = false) {
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.skidMarks.forEach((m, idx) => {
        if(idx === 0) ctx.moveTo(m.x, m.y);
        else ctx.lineTo(m.x, m.y);
      });
      ctx.stroke();

      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.angle);

      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-this.height/2 + 2, -this.width/2 + 2, this.height, this.width);

      ctx.fillStyle = '#111111';
      ctx.fillRect(-10, -this.width/2 - 2, 5, 2);
      ctx.fillRect(-10, this.width/2, 5, 2);
      ctx.fillRect(6, -this.width/2 - 2, 5, 2);
      ctx.fillRect(6, this.width/2, 5, 2);

      if (isChampion) {
        ctx.fillStyle = '#ffcc00'; 
        ctx.strokeStyle = '#fff';
      } else {
        ctx.fillStyle = this.alive ? '#3a7bd5' : '#555555';
        ctx.strokeStyle = '#222';
      }
      ctx.lineWidth = 1.5;
      ctx.fillRect(-this.height/2, -this.width/2, this.height, this.width);
      ctx.strokeRect(-this.height/2, -this.width/2, this.height, this.width);

      ctx.fillStyle = 'rgba(150, 220, 255, 0.7)';
      ctx.fillRect(2, -this.width/2 + 2, 4, this.width - 4);

      ctx.restore();

      if (isChampion && this.alive) {
        ctx.save();
        ctx.shadowColor = '#ffcc00';
        ctx.shadowBlur = 15;
        ctx.strokeStyle = 'rgba(255, 204, 0, 0.6)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 20, 0, Math.PI*2);
        ctx.stroke();

        ctx.fillStyle = '#ffcc00';
        ctx.font = 'bold 10px sans-serif';
        ctx.shadowBlur = 0; 
        ctx.textAlign = 'center';
        ctx.fillText("CAMPEÃO", this.x, this.y - 25);
        ctx.restore();
      }
    }
  }

  global.Car = Car;
})(typeof window !== "undefined" ? window : global);