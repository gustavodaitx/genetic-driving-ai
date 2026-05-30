/**
 * Definição Geométrica e Matemática das Pistas Profissionais
 */
(function (global) {
  class Track {

    // Adicione este método estático
    static count() {
      return 3; // Retorna a quantidade total de pistas do seu projeto
    }

    constructor(index = 0) {
      this.index = index; // 0, 1 ou 2 (Pistas 1, 2 e 3)
      this.width = 120;
      this.points = [];
      this.checkpoints = [];
      this.obstacles = [];
      
      this.loadTrackGeometry(index);
      this.generateSplineCheckpoints();
      this.generateRegulatedObstacles();
    }

    loadTrackGeometry(index) {
      if (index === 0) {
        // =================================================================
        // AJUSTE DE DIFICULDADE: Pista estreitada para criar margem de erro mínima
        // =================================================================
        this.width = 75; // Era 120 (Reduzido drasticamente para sufocar a IA)
        this.points = [
          {x: 150, y: 350}, {x: 200, y: 180}, {x: 450, y: 120},
          {x: 750, y: 150}, {x: 850, y: 350}, {x: 750, y: 550},
          {x: 450, y: 580}, {x: 200, y: 520}
        ];
      } else if (index === 1) {
        this.width = 100;
        this.points = [
          {x: 120, y: 500}, {x: 150, y: 220}, {x: 400, y: 150},
          {x: 500, y: 320}, {x: 650, y: 400}, {x: 850, y: 250},
          {x: 900, y: 520}, {x: 550, y: 580}, {x: 300, y: 480}
        ];
      } else {
        this.width = 85;
        this.points = [
          {x: 150, y: 500}, {x: 120, y: 150}, {x: 350, y: 120},
          {x: 380, y: 330}, {x: 600, y: 350}, {x: 620, y: 150},
          {x: 880, y: 180}, {x: 900, y: 550}, {x: 500, y: 580},
          {x: 450, y: 420}, {x: 300, y: 550}
        ];
      }
    }

    generateSplineCheckpoints() {
      this.checkpoints = [];
      const density = 45; // Checkpoints frequentes invisíveis a cada 45px
      
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
          const len = Math.hypot(dx, dy);
          const nx = -dy / (len || 1);
          const ny = dx / (len || 1);

          this.checkpoints.push({
            x: cx, y: cy,
            nx: nx, ny: ny,
            angle: Math.atan2(dy, dx),
            reached: false
          });
        }
      }
    }

    // CORREÇÃO OBRIGATÓRIA: Filtra e valida se as coordenadas estão de fato sobre o asfalto
    isInsideTrack(x, y) {
      let minDistance = Infinity;
      for (let i = 0; i < this.checkpoints.length; i++) {
        const cp = this.checkpoints[i];
        const d = Math.hypot(x - cp.x, y - cp.y);
        if (d < minDistance) minDistance = d;
      }
      return minDistance < (this.width / 2);
    }

    generateRegulatedObstacles() {
      this.obstacles = [];
      const totalCPs = this.checkpoints.length;

      // =================================================================
      // REGRA EXCLUSIVA: Pista 1 com exatamente 4 obstáculos bem distribuídos
      // =================================================================
      if (this.index === 0) {
        // Define 4 posições percentuais ao longo da pista (ex: 25%, 45%, 65% e 85%)
        const proporcoes = [0.25, 0.45, 0.65, 0.85];
        
        proporcoes.forEach((pct) => {
          const idx = Math.floor(totalCPs * pct);
          const cp = this.checkpoints[idx];
          
          if (cp && this.isInsideTrack(cp.x, cp.y)) {
            // Alterna entre cone e óleo leve para testar os sensores
            const type = Math.random() > 0.5 ? 'cone' : 'oleo_leve';
            const label = type === 'cone' ? '🚧 Cone' : '🛢️ Óleo Leve';
            
            // Coloca um leve desvio lateral aleatório para não ficarem todos no centro idêntico
            const sideOffset = (Math.random() * 2 - 1) * (this.width * 0.15);
            const obsX = cp.x + cp.nx * sideOffset;
            const obsY = cp.y + cp.ny * sideOffset;

            this.obstacles.push({ x: obsX, y: obsY, type, label, radius: 13 });
          }
        });
        return; // Finaliza a execução para a Pista 1 aqui
      }

      // =================================================================
      // Lógica procedural original para as Pistas 2 e 3
      // =================================================================
      this.checkpoints.forEach((cp, idx) => {
        const progressPct = idx / totalCPs;
        if (progressPct < 0.35) return;

        if (idx % 6 === 0) {
          const sideOffset = (Math.random() * 2 - 1) * (this.width * 0.25);
          const obsX = cp.x + cp.nx * sideOffset;
          const obsY = cp.y + cp.ny * sideOffset;

          if (this.isInsideTrack(obsX, obsY)) {
            let type = 'cone';
            let label = '🚧 Cone';

            if (this.index === 1) {
              const r = Math.random();
              if (r < 0.33) { type = 'lama'; label = '🟤 Lama'; }
              else if (r < 0.66) { type = 'buraco'; label = '⚫ Buraco'; }
              else { type = 'oleo'; label = '🛢️ Óleo'; }
            } else {
              const r = Math.random();
              if (r < 0.4) { type = 'fogo'; label = '🔥 Fogo'; }
              else if (r < 0.7) { type = 'movel'; label = '🚧 Bloqueio'; }
              else { type = 'extremo'; label = '⚡ Sobrecarga'; }
            }

            this.obstacles.push({ x: obsX, y: obsY, type, label, radius: 13 });
          }
        }
      });
    }

    getCheckpointCount() { return this.checkpoints.length; }
    resetCheckpoints() { this.checkpoints.forEach(cp => cp.reached = false); }
    setTrack(index) {
      this.index = index;
      this.loadTrackGeometry(index);
      this.generateSplineCheckpoints();
      this.generateRegulatedObstacles();
    }
  }

  global.Track = Track;
})(typeof window !== "undefined" ? window : global);