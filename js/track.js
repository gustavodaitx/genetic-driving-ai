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
      this.index       = index;
      this.width       = 120;
      this.points      = [];
      this.checkpoints = [];
      this.obstacles   = [];

      this.loadTrackGeometry(index);
      this.generateSplineCheckpoints();
      this.generateRegulatedObstacles();
    }

    loadTrackGeometry(index) {
      if (index === 0) {
        this.width  = 80;   // 75 × 1.3
        this.points = [
          {x: 150, y: 350}, {x: 200, y: 180}, {x: 450, y: 120},
          {x: 750, y: 150}, {x: 850, y: 350}, {x: 750, y: 550},
          {x: 450, y: 580}, {x: 200, y: 520},
        ];
      } else if (index === 1) {
        this.width  = 110;  // 100 × 1.3
        this.points = [
          {x: 120, y: 500}, {x: 150, y: 220}, {x: 400, y: 150},
          {x: 500, y: 320}, {x: 650, y: 400}, {x: 850, y: 250},
          {x: 900, y: 520}, {x: 550, y: 580}, {x: 300, y: 480},
        ];
      } else {
        this.width  = 95;  // 85 × 1.3
        this.points = [
          {x: 150, y: 500}, {x: 120, y: 150}, {x: 350, y: 120},
          {x: 380, y: 330}, {x: 600, y: 350}, {x: 620, y: 150},
          {x: 880, y: 180}, {x: 900, y: 550}, {x: 500, y: 580},
          {x: 450, y: 420}, {x: 300, y: 550},
        ];
      }
    }

    generateSplineCheckpoints() {
      this.checkpoints = [];
      const density = 45;

      for (let i = 0; i < this.points.length; i++) {
        const p1 = this.points[i];
        const p2 = this.points[(i + 1) % this.points.length];
        const dist  = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const steps = Math.max(1, Math.floor(dist / density));

        for (let s = 0; s < steps; s++) {
          const t  = s / steps;
          const cx = p1.x + (p2.x - p1.x) * t;
          const cy = p1.y + (p2.y - p1.y) * t;

          const dx  = p2.x - p1.x;
          const dy  = p2.y - p1.y;
          const len = Math.hypot(dx, dy) || 1;

          this.checkpoints.push({
            x:     cx,
            y:     cy,
            nx:    -dy / len,   // Normal perpendicular (aponta para a lateral)
            ny:     dx / len,
            angle: Math.atan2(dy, dx),
            reached: false,
          });
        }
      }
    }

    isInsideTrack(x, y) {
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
      this.obstacles   = [];
      const totalCPs   = this.checkpoints.length;
      const half       = this.width / 2;
      const MIN_F      = 0.52;   // Mínimo 52% da meia-largura → fora do centro
      const MAX_F      = 0.78;   // Máximo 78% → dentro da pista com margem

      // Função auxiliar: tenta colocar obstáculo na lateral indicada
      // side: +1 = direita, -1 = esquerda
      const tryPlace = (cp, side, type, label) => {
        const factor  = MIN_F + Math.random() * (MAX_F - MIN_F);
        const offset  = side * half * factor;
        const ox      = cp.x + cp.nx * offset;
        const oy      = cp.y + cp.ny * offset;

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
          const cp    = this.checkpoints[cpIdx];
          if (!cp) return;

          const side  = i % 2 === 0 ? -1 : 1;   // Alterna: esq, dir, esq, dir
          const type  = i % 2 === 0 ? 'cone' : 'oleo_leve';
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
          if      (r < 0.33) { type = 'lama';   label = '🟤 Lama';   }
          else if (r < 0.66) { type = 'buraco'; label = '⚫ Buraco'; }
          else                { type = 'oleo';   label = '🛢️ Óleo';   }
        } else {
          const r = Math.random();
          if      (r < 0.40) { type = 'fogo';   label = '🔥 Fogo';      }
          else if (r < 0.70) { type = 'movel';  label = '🚧 Bloqueio';  }
          else                { type = 'extremo'; label = '⚡ Sobrecarga'; }
        }

        const placed = tryPlace(cp, sideToggle, type, label);
        if (!placed) tryPlace(cp, -sideToggle, type, label); // fallback lado oposto

        sideToggle *= -1;  // Alterna lado para o próximo obstáculo
      });
    }

    getCheckpointCount() { return this.checkpoints.length; }
    resetCheckpoints()   { this.checkpoints.forEach(cp => cp.reached = false); }

    setTrack(index) {
      this.index = index;
      this.loadTrackGeometry(index);
      this.generateSplineCheckpoints();
      this.generateRegulatedObstacles();
    }
  }

  global.Track = Track;
})(typeof window !== "undefined" ? window : global);
