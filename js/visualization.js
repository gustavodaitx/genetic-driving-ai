/**
 * Visualizer v12 — Alta Performance
 * - Pista pré-cacheada em offscreen canvas (redesenha só quando muda de pista)
 * - Render de carros simplificado: sem gradientes radiais por carro, sem sombras
 * - Em velocidade alta (≥5×): só renderiza o campeão + contorno dos outros
 */
(function (global) {
  class Visualizer {
    constructor(canvas) {
      this.canvas  = canvas;
      this.ctx     = canvas.getContext('2d');
      this._trackCache      = null;  // offscreen canvas com a pista pintada
      this._trackCacheIndex = -1;    // índice da pista no cache
      this.setupHighDPI();
      window.addEventListener('resize', () => {
        this.setupHighDPI();
        this._trackCache = null; // invalida cache ao redimensionar
      });
    }

    setupHighDPI() {
      const dpr  = window.devicePixelRatio || 1;
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width  = rect.width  * dpr;
      this.canvas.height = rect.height * dpr;
      this.width  = this.canvas.width;
      this.height = this.canvas.height;
      this.ctx.scale(dpr, dpr);
      this.ctx.imageSmoothingEnabled = false;
      this._dpr = dpr;
    }

    _getTrackTransform(track, canvasW, canvasH) {
      const pts = track.points;
      if (!pts || !pts.length) return { tx: 0, ty: 0, scale: 1 };
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const pad    = (track.width || 80) + 40;
      const trackW = (maxX - minX) + pad * 2;
      const trackH = (maxY - minY) + pad * 2;
      const scale  = Math.min(0.95, Math.min(canvasW / trackW, canvasH / trackH));
      const tx     = canvasW  / 2 - ((minX + maxX) / 2) * scale;
      const ty     = canvasH / 2 - ((minY + maxY) / 2) * scale;
      return { tx, ty, scale };
    }

    // ── Constrói (ou retorna do cache) o offscreen canvas da pista ──────────
    _getTrackCanvas(track, W, H) {
      if (this._trackCache && this._trackCacheIndex === track.index &&
          this._trackCache.width === Math.round(W * this._dpr) &&
          this._trackCache.height === Math.round(H * this._dpr)) {
        return this._trackCache;
      }

      const dpr = this._dpr || 1;
      const oc  = document.createElement('canvas');
      oc.width  = Math.round(W * dpr);
      oc.height = Math.round(H * dpr);
      const c   = oc.getContext('2d');
      c.scale(dpr, dpr);
      c.imageSmoothingEnabled = false;

      // Fundo
      c.fillStyle = '#1c3b12';
      c.fillRect(0, 0, W, H);
      // Listras grama
      c.fillStyle = '#214416';
      for (let y = 0; y < H; y += 36) {
        if ((Math.floor(y / 36)) % 2 === 0) c.fillRect(0, y, W, 36);
      }

      if (!track || !track.points) {
        this._trackCache      = oc;
        this._trackCacheIndex = track ? track.index : -1;
        return oc;
      }

      const { tx, ty, scale } = this._getTrackTransform(track, W, H);
      c.save();
      c.translate(tx, ty);
      c.scale(scale, scale);

      // Borda branca
      c.lineWidth   = track.width + 14;
      c.strokeStyle = '#444444';
      c.lineCap     = 'round';
      c.lineJoin    = 'round';
      c.beginPath();
      track.points.forEach((p, i) => i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y));
      c.closePath();
      c.stroke();

      // Asfalto
      c.lineWidth   = track.width;
      c.strokeStyle = '#1a1a1f';
      c.stroke();

      // Linha central tracejada
      c.lineWidth   = 2;
      c.strokeStyle = 'rgba(255,255,255,0.3)';
      c.setLineDash([14, 18]);
      c.stroke();
      c.setLineDash([]);

      // ── LARGADA ─────────────────────────────────────────────────────────
      // Desenhada em checkpoints[0] = ponto de início da pista.
      // A chegada (finishCPIndex) fica a ≥150px daqui, garantindo separação clara.
      const startCP = track.checkpoints && track.checkpoints[0];
      if (startCP) {
        c.save();
        c.translate(startCP.x, startCP.y);
        c.rotate(startCP.angle + Math.PI / 2);

        const hw = track.width / 2 + 6;

        // Faixa verde de largada (de borda a borda)
        c.fillStyle = 'rgba(0, 200, 100, 0.35)';
        c.fillRect(-hw, -8, hw * 2, 8);

        // Linha branca sólida
        c.fillStyle = 'rgba(255,255,255,0.85)';
        c.fillRect(-hw, -3, hw * 2, 3);

        // Label START acima da linha
        c.fillStyle = '#ffffff';
        c.font      = 'bold 13px monospace';
        c.textAlign = 'center';
        c.shadowColor = 'rgba(0,0,0,0.8)';
        c.shadowBlur  = 4;
        c.fillText('▲ START', 0, -14);
        c.shadowBlur  = 0;
        c.restore();
      }

      // ── CHEGADA ─────────────────────────────────────────────────────────
      // finishCPIndex = último checkpoint a ≥150px da largada.
      // O carro completa a pista ao CRUZAR fisicamente esta linha.
      const finishIdx = track.finishCPIndex != null ? track.finishCPIndex : track.checkpoints.length - 1;
      const endCP = track.checkpoints && track.checkpoints[finishIdx];
      if (endCP) {
        c.save();
        c.translate(endCP.x, endCP.y);
        // endCP.angle é o ângulo AO LONGO da pista.
        // Rodar +90° coloca o eixo X local PERPENDICULAR à pista (atravessa de borda a borda).
        c.rotate(endCP.angle + Math.PI / 2);

        const hw  = track.width / 2 + 6; // +folga para cobrir as bordas
        const sq  = 10;
        const numCols = Math.ceil(hw * 2 / sq);
        const rowH    = 10;

        // Duas fileiras de xadrez
        for (let col = 0; col < numCols; col++) {
          for (let row = 0; row < 2; row++) {
            c.fillStyle = (col + row) % 2 === 0 ? '#ffffff' : '#111111';
            c.fillRect(-hw + col * sq, -rowH + row * rowH, sq, rowH);
          }
        }

        // Contorno neon verde
        c.strokeStyle = '#00ff66';
        c.lineWidth   = 2;
        c.strokeRect(-hw, -rowH, hw * 2, rowH * 2);

        // Label
        c.fillStyle = '#00ff66';
        c.font      = 'bold 13px monospace';
        c.textAlign = 'center';
        c.fillText('FINISH', 0, -rowH - 5);
        c.restore();
      }

      // Obstáculos
      if (track.obstacles) {
        track.obstacles.forEach(obs => {
          const isCone = obs.type === 'cone' || (obs.radius && obs.radius < 14);
          if (isCone) {
            c.beginPath();
            c.arc(obs.x, obs.y, obs.radius || 12, 0, Math.PI * 2);
            c.fillStyle   = '#ff6d00';
            c.fill();
            c.lineWidth   = 2;
            c.strokeStyle = '#ffffff';
            c.stroke();
          } else {
            const size = (obs.radius || 18) * 1.6;
            c.fillStyle   = '#b0bec5';
            c.fillRect(obs.x - size / 2, obs.y - size / 2, size, size);
            c.strokeStyle = '#37474f';
            c.lineWidth   = 2;
            c.strokeRect(obs.x - size / 2, obs.y - size / 2, size, size);
            c.fillStyle   = '#ffd600';
            c.fillRect(obs.x - size / 2 + 4, obs.y - 3, size - 8, 6);
          }
        });
      }

      c.restore();

      this._trackCache      = oc;
      this._trackCacheIndex = track.index;
      return oc;
    }

    render(track, cars, championCard, options = {}) {
      const ctx  = this.ctx;
      const rect = this.canvas.getBoundingClientRect();
      const W    = rect.width;
      const H    = rect.height;
      const fast = options.turboMode || options.fastMode; // modo rápido: render mínimo

      // ── Pista (do cache) ───────────────────────────────────────────────
      const tc = this._getTrackCanvas(track, W, H);
      ctx.drawImage(tc, 0, 0, W, H);

      // ── Transform dos carros ───────────────────────────────────────────
      const { tx, ty, scale } = this._getTrackTransform(track, W, H);
      ctx.save();
      ctx.translate(tx, ty);
      ctx.scale(scale, scale);

      // ── Carros ─────────────────────────────────────────────────────────
      if (cars && cars.length > 0) {
        if (fast) {
          // Modo rápido: só o campeão completo, os outros são pontinhos
          cars.forEach(car => {
            if (!car.alive || car === championCard) return;
            ctx.fillStyle = 'rgba(74,158,255,0.55)';
            ctx.fillRect(car.x - 4, car.y - 4, 8, 8);
          });
        } else {
          // Modo normal: todos os carros com visual simplificado
          cars.forEach(car => {
            if (car === championCard) return;
            if (!car.alive) {
              // mortos: retângulo cinza translúcido rápido
              ctx.save();
              ctx.translate(car.x, car.y);
              ctx.rotate(car.angle);
              ctx.fillStyle = 'rgba(80,80,80,0.35)';
              ctx.fillRect(-car.height / 2, -car.width / 2, car.height, car.width);
              ctx.restore();
              return;
            }
            this._drawCarSimple(ctx, car, false);
          });
        }

        // Campeão sempre desenhado completo
        if (championCard) {
          this._drawCarChampion(ctx, championCard);
          if (options.showSensors !== false) {
            this.drawCarSensors(championCard);
          }
        }
      }

      // Sensores no modo manual
      if (options.manualMode && cars && cars[0]) {
        this.drawCarSensors(cars[0]);
      }

      ctx.restore();

      // ── Pausa overlay ──────────────────────────────────────────────────
      if (options.paused) {
        ctx.fillStyle = 'rgba(10,16,26,0.65)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#ff8844';
        ctx.font      = 'bold 34px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('SIMULAÇÃO PAUSADA', W / 2, H / 2);
      }
    }

    // Carro simples (população): formas sólidas sem gradiente
    _drawCarSimple(ctx, car, isChamp) {
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.angle);

      // Rodas — dois retângulos pretos
      ctx.fillStyle = '#111';
      ctx.fillRect(-car.height / 3 - 1, -car.width / 2 - 3, 8, 3);
      ctx.fillRect(-car.height / 3 - 1,  car.width / 2,     8, 3);
      ctx.fillRect( car.height / 3 - 6,  -car.width / 2 - 3, 8, 3);
      ctx.fillRect( car.height / 3 - 6,   car.width / 2,     8, 3);

      // Carroceria sólida
      ctx.fillStyle   = '#2a5fd5';
      ctx.strokeStyle = '#000';
      ctx.lineWidth   = 1;
      ctx.fillRect(-car.height / 2, -car.width / 2, car.height, car.width);
      ctx.strokeRect(-car.height / 2, -car.width / 2, car.height, car.width);

      // Para-brisa
      ctx.fillStyle = '#7ecfff';
      ctx.fillRect(car.height * 0.05, -car.width / 2 + 3, car.height * 0.16, car.width - 6);

      ctx.restore();
    }

    // Campeão: visual mais rico mas ainda sem sombras por frame
    _drawCarChampion(ctx, car) {
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.angle);

      // Rodas
      ctx.fillStyle = '#111';
      ctx.fillRect(-car.height / 3 - 1, -car.width / 2 - 3, 8, 3);
      ctx.fillRect(-car.height / 3 - 1,  car.width / 2,     8, 3);
      ctx.fillRect( car.height / 3 - 6, -car.width / 2 - 3, 8, 3);
      ctx.fillRect( car.height / 3 - 6,  car.width / 2,     8, 3);

      // Farol
      if (car.alive) {
        ctx.fillStyle = 'rgba(255,240,180,0.18)';
        ctx.beginPath();
        ctx.moveTo(car.height / 2, -car.width / 2);
        ctx.lineTo(car.height / 2 + 55, -car.width * 1.4);
        ctx.lineTo(car.height / 2 + 55,  car.width * 1.4);
        ctx.lineTo(car.height / 2,  car.width / 2);
        ctx.closePath();
        ctx.fill();
      }

      // Carroceria dourada
      ctx.fillStyle   = car.alive ? '#ffc107' : '#888';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 2;
      ctx.fillRect(-car.height / 2, -car.width / 2, car.height, car.width);
      ctx.strokeRect(-car.height / 2, -car.width / 2, car.height, car.width);

      // Para-brisa
      ctx.fillStyle = '#b3e5fc';
      ctx.fillRect(car.height * 0.05, -car.width / 2 + 3, car.height * 0.18, car.width - 6);

      ctx.restore();

      // Aura (feita fora do translate para não somar scale duplo)
      if (car.alive) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,215,0,0.65)';
        ctx.lineWidth   = 2.5;
        ctx.beginPath();
        ctx.arc(car.x, car.y, car.height * 0.85, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#ffd700';
        ctx.font      = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🏆 LÍDER', car.x, car.y - car.height * 1.05);
        ctx.restore();
      }

      // Skid marks
      if (car.skidMarks && car.skidMarks.length > 1) {
        ctx.save();
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        car.skidMarks.forEach((m, i) => i === 0 ? ctx.moveTo(m.x, m.y) : ctx.lineTo(m.x, m.y));
        ctx.stroke();
        ctx.restore();
      }
    }

    drawCarSensors(car) {
      if (!car || !car.sensors) return;
      const ctx    = this.ctx;
      const count  = car.sensors.length;
      const fov    = Math.PI; // 180°
      const start  = -fov / 2;
      const step   = fov / (count - 1);
      const range  = car.sensorRange || 360;

      ctx.save();
      for (let i = 0; i < count; i++) {
        const ang = start + i * step;
        const worldAngle = car.angle + ang;
        const norm       = car.sensors[i] !== undefined ? car.sensors[i] : 0;
        const dist       = range * (1 - norm);
        const ox = car.x, oy = car.y;
        const tx = ox + Math.cos(worldAngle) * dist;
        const ty = oy + Math.sin(worldAngle) * dist;

        if (norm > 0.7) {
          ctx.strokeStyle = 'rgba(255,30,30,0.85)';
          ctx.lineWidth   = 2;
          ctx.fillStyle   = '#ff1744';
          ctx.beginPath();
          ctx.arc(tx, ty, 4, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(0,255,150,0.4)';
          ctx.lineWidth   = 1;
        }
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawSensorPanel(car) {
      if (!car || !car.sensors) return;
      const count = car.sensors.length;
      for (let i = 0; i < count; i++) {
        const el = document.getElementById(`sensor-val-${i}`);
        if (!el) continue;
        const leitura = car.sensors[i] !== undefined ? car.sensors[i] : 0;
        const prox    = Math.round(leitura * 100);
        el.innerText        = `${prox}%`;
        el.style.color      = prox > 70 ? '#ff3d00' : '#00e676';
        el.style.fontWeight = prox > 70 ? 'bold'    : 'normal';
      }
    }
  }

  global.Visualizer = Visualizer;
})(typeof window !== 'undefined' ? window : global);
