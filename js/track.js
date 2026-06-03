/**
 * Track v5 — Pistas 30% mais largas, obstáculos fixos nas laterais.
 *
 * LARGURAS (originais × 1.3):
 *   Pista 1: 75  → 98  px
 *   Pista 2: 100 → 130 px
 *   Pista 3: 85  → 110 px
 *
 * POSICIONAMENTO DOS OBSTÁCULOS:
 *   Cada obstáculo é colocado em uma das duas laterais da pista com
 *   um offset fixo entre 55% e 80% da meia-largura (half = width/2).
 *   Isso garante que o obstáculo fique:
 *     - Dentro da pista  (offset < half)
 *     - Fora do centro   (offset > half * 0.5)
 *   O lado (esquerda/direita) alterna a cada obstáculo para distribuir
 *   os dois lados e forçar a IA a desviar ora para um lado ora para outro.
 */
(function (global) {
  class Track {

    static count() { return 3; }

    constructor(index = 0) {
      this.index = index;
      this.width = 120;
      this.points = [];
      this.checkpoints = [];
      this.obstacles = [];

      this.loadTrackGeometry(index);
      this.generateSplineCheckpoints();
      this.generateRegulatedObstacles();
      this.generateMask();
    }

    loadTrackGeometry(index) {
      if (index === 0) {
        this.width = 90;   // 75 × 1.3
        this.points = [
          { x: 150, y: 350 }, { x: 200, y: 180 }, { x: 450, y: 120 },
          { x: 750, y: 150 }, { x: 850, y: 350 }, { x: 750, y: 550 },
          { x: 450, y: 580 }, { x: 200, y: 520 },
        ];
      } else if (index === 1) {
        this.width = 115;  // 100 × 1.3
        this.points = [
          { x: 220, y: 500 },
          { x: 120, y: 380 },
          { x: 150, y: 220 },
          { x: 400, y: 150 },
          { x: 500, y: 320 },
          { x: 650, y: 400 },
          { x: 850, y: 250 },
          { x: 900, y: 520 },
          { x: 550, y: 580 },
          { x: 300, y: 480 },
        ];
      } else {
        // Pista 3 — Interlagos style, F1-inspired, no self-intersection
        // Loop externo amplo + chicane interna + curva senoidal final
        this.width = 120;  // Aumentado ligeiramente para dar mais vazão nas curvas
        this.points = [
          { x: 150, y: 500 }, // Largada
          { x: 130, y: 220 }, // Curva 1: Subida suave pela esquerda
          { x: 350, y: 140 }, // Curva 2: Transição superior aberta
          { x: 480, y: 300 }, // Curva 3: Entrada do "S" central (suave para o meio)
          { x: 620, y: 420 }, // Curva 4: Saída do "S" central (tangenciando por baixo)
          { x: 700, y: 200 }, // Curva 5: Grande parábola superior direita
          { x: 880, y: 250 }, // Extremo direito superior
          { x: 900, y: 520 }, // Curva de retorno para a base
          { x: 600, y: 560 }, // Reta texturizada inferior rápida
          { x: 350, y: 540 }, // Última curva antes da reta final
        ];
      }
    }

    generateSplineCheckpoints() {
      this.checkpoints = [];
      const density = 45;

      for (let i = 0; i < this.points.length; i++) {
        const p1 = this.points[i];
        const p2 = this.points[(i + 1) % this.points.length];
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const steps = Math.max(1, Math.floor(dist / density));

        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          const cx = p1.x + (p2.x - p1.x) * t;
          const cy = p1.y + (p2.y - p1.y) * t;

          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const len = Math.hypot(dx, dy) || 1;

          this.checkpoints.push({
            x: cx,
            y: cy,
            nx: -dy / len,   // Normal perpendicular (aponta para a lateral)
            ny: dx / len,
            angle: Math.atan2(dy, dx),
            reached: false,
          });
        }
      }

      // ── Linha de CHEGADA ────────────────────────────────────────────────
      // Em um circuito fechado os checkpoints[0] (largada) e checkpoints[last]
      // ficam colados, pois o loop fecha sobre si mesmo.
      //
      // Estratégia: finishCPIndex é o ÚLTIMO checkpoint que ainda está a pelo
      // menos MIN_FINISH_SEP pixels de distância do checkpoint de largada [0].
      // Isso garante:
      //   • O carro percorre a volta COMPLETA antes de completar
      //   • Chegada e Largada ficam visivelmente separadas na pista
      //   • O carro CRUZA a linha de chegada antes de parar (detecção real)
      const MIN_FINISH_SEP = 80; // separação mínima (px) entre chegada e largada
      const startX = this.checkpoints[0].x;
      const startY = this.checkpoints[0].y;
      let finishIdx = this.checkpoints.length - 1; // fallback: último CP
      for (let i = this.checkpoints.length - 1; i >= 0; i--) {
        const d = Math.hypot(this.checkpoints[i].x - startX, this.checkpoints[i].y - startY);
        if (d >= MIN_FINISH_SEP) { finishIdx = i; break; }
      }
      
      if (this.index === 1) {
        // Monza: usa o último checkpoint da pista como chegada
        this.finishCPIndex = this.checkpoints.length - 1;
      } else {
        this.finishCPIndex = finishIdx;
      }

      if (this.index === 1) {
        this.finishCPIndex = Math.min(
          this.checkpoints.length - 1,
          finishIdx + 5
        );
      }
    }

    generateMask() {
      if (typeof document === 'undefined') {
        this.maskData = null;
        return;
      }
      const pts = this.points;
      if (!pts || !pts.length) {
        this.maskData = null;
        return;
      }
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const pad = this.width + 50;
      this.maskMinX = minX - pad;
      this.maskMinY = minY - pad;
      this.maskWidth = Math.ceil((maxX + pad) - this.maskMinX);
      this.maskHeight = Math.ceil((maxY + pad) - this.maskMinY);

      const canvas = document.createElement('canvas');
      canvas.width = this.maskWidth;
      canvas.height = this.maskHeight;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, this.maskWidth, this.maskHeight);

      ctx.save();
      ctx.translate(-this.maskMinX, -this.maskMinY);
      ctx.lineWidth = this.width;
      ctx.strokeStyle = '#ffffff';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      this.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.restore();

      const imgData = ctx.getImageData(0, 0, this.maskWidth, this.maskHeight);
      this.maskData = imgData.data;
    }

    isInsideTrack(x, y) {
      if (this.maskData) {
        const mx = Math.round(x - this.maskMinX);
        const my = Math.round(y - this.maskMinY);
        if (mx < 0 || mx >= this.maskWidth || my < 0 || my >= this.maskHeight) return false;
        const idx = (my * this.maskWidth + mx) * 4;
        return this.maskData[idx] > 128;
      }
      let minDist = Infinity;
      for (const cp of this.checkpoints) {
        const d = Math.hypot(x - cp.x, y - cp.y);
        if (d < minDist) minDist = d;
      }
      return minDist < this.width / 2;
    }

    /**
     * Gera obstáculos nas LATERAIS da pista.
     *
     * Offset lateral = half * fator, onde fator ∈ [MIN_F, MAX_F].
     *   MIN_F = 0.52  → obstáculo começa logo após o centro
     *   MAX_F = 0.78  → obstáculo fica próximo da borda mas com folga (raio 13px)
     *
     * O sinal (+/-) alterna a cada obstáculo: lado esquerdo / lado direito.
     * Para pistas com obstáculos em proporções fixas (Pista 1), lado é
     * determinístico pelo índice (pares = esquerda, ímpares = direita).
     */
    generateRegulatedObstacles() {
      this.obstacles = [];
      const totalCPs = this.checkpoints.length;
      const half = this.width / 2;
      const MIN_F = 0.52;   // Mínimo 52% da meia-largura → fora do centro
      const MAX_F = 0.78;   // Máximo 78% → dentro da pista com margem

      // Função auxiliar: tenta colocar obstáculo na lateral indicada
      // side: +1 = direita, -1 = esquerda
      const tryPlace = (cp, side, type, label) => {
        const factor = MIN_F + Math.random() * (MAX_F - MIN_F);
        const offset = side * half * factor;
        const ox = cp.x + cp.nx * offset;
        const oy = cp.y + cp.ny * offset;

        // Valida que está dentro da pista e longe o suficiente da borda (raio + 4px)
        if (!this.isInsideTrack(ox, oy)) return false;
        if (!this.isInsideTrack(ox + cp.nx * 17, oy + cp.ny * 17)) return false; // Testa um passo além

        this.obstacles.push({ x: ox, y: oy, type, label, radius: 13 });
        return true;
      };

      // ── Pista 1: 4 obstáculos em posições fixas ────────────────────────
      if (this.index === 0) {
        const proporcoes = [0.25, 0.45, 0.65, 0.85];
        proporcoes.forEach((pct, i) => {
          const cpIdx = Math.floor(totalCPs * pct);
          const cp = this.checkpoints[cpIdx];
          if (!cp) return;

          const side = i % 2 === 0 ? -1 : 1;   // Alterna: esq, dir, esq, dir
          const type = i % 2 === 0 ? 'cone' : 'oleo_leve';
          const label = type === 'cone' ? '🚧 Cone' : '🛢️ Óleo';

          // Se o lado principal falhar, tenta o oposto
          if (!tryPlace(cp, side, type, label)) {
            tryPlace(cp, -side, type, label);
          }
        });
        return;
      }

      // ── Pistas 2 e 3: obstáculos distribuídos a partir de 35% ─────────
      let sideToggle = 1;   // Começa pela direita, alterna a cada obstáculo

      this.checkpoints.forEach((cp, idx) => {
        const pct = idx / totalCPs;
        if (pct < 0.35) return;          // Deixa a largada livre
        if (idx % 7 !== 0) return;       // Espaçamento entre obstáculos

        let type, label;
        if (this.index === 1) {
          const r = Math.random();
          if (r < 0.33) { type = 'lama'; label = '🟤 Lama'; }
          else if (r < 0.66) { type = 'buraco'; label = '⚫ Buraco'; }
          else { type = 'oleo'; label = '🛢️ Óleo'; }
        } else {
          const r = Math.random();
          if (r < 0.40) { type = 'fogo'; label = '🔥 Fogo'; }
          else if (r < 0.70) { type = 'movel'; label = '🚧 Bloqueio'; }
          else { type = 'extremo'; label = '⚡ Sobrecarga'; }
        }

        const placed = tryPlace(cp, sideToggle, type, label);
        if (!placed) tryPlace(cp, -sideToggle, type, label); // fallback lado oposto

        sideToggle *= -1;  // Alterna lado para o próximo obstáculo
      });
    }

    getCheckpointCount() { return this.checkpoints.length; }
    resetCheckpoints() { this.checkpoints.forEach(cp => cp.reached = false); }

    setTrack(index) {
      this.index = index;
      this.loadTrackGeometry(index);
      this.generateSplineCheckpoints();
      this.generateRegulatedObstacles();
      this.generateMask();
    }
  }

  global.Track = Track;
})(typeof window !== "undefined" ? window : global);
