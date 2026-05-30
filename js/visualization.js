/**
 * Renderizador de Alta Performance para Simulação Top-Down
 * Versão Customizada: Definição Ultra-Sharp (Pixel Perfeito 100% Nítido)
 */
(function (global) {
  class Visualizer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      
      // Ajusta o Canvas para o Device Pixel Ratio real do monitor (Retina/4K/DPI)
      this.setupHighDPI();

      // Monitora o redimensionamento da janela para não perder a nitidez
      window.addEventListener('resize', () => this.setupHighDPI());
    }

    /**
     * Configura o tamanho real de renderização interna casado com os pixels da tela,
     * eliminando borrões em qualquer resolução ou monitor.
     */
    setupHighDPI() {
      const dpr = window.devicePixelRatio || 1;
      const rect = this.canvas.getBoundingClientRect();
      
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      
      this.width = this.canvas.width;
      this.height = this.canvas.height;
      
      this.ctx.scale(dpr, dpr);
      
      this.ctx.imageSmoothingEnabled = false;
      this.ctx.mozImageSmoothingEnabled = false;
      this.ctx.webkitImageSmoothingEnabled = false;
      this.ctx.msImageSmoothingEnabled = false;
    }

    render(track, cars, championCard, options = {}) {
      const ctx = this.ctx;
      const rect = this.canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);

      // --- CAMADA 1: Fundo Fixo (Grama com textura suave de linhas de corte) ---
      ctx.fillStyle = '#1e3f13'; 
      ctx.fillRect(0, 0, rect.width, rect.height);
      
      ctx.fillStyle = '#244b17';
      for (let y = 0; y < rect.height; y += 40) {
        if ((y / 40) % 2 === 0) ctx.fillRect(0, y, rect.width, 40);
      }

      // Salva o estado para aplicar as transformações do mundo da simulação
      ctx.save();

      // --- AJUSTE GLOBAL DE ZOOM E CÂMERA ---
      const zoom = 0.70; 
      ctx.scale(zoom, zoom);
      ctx.translate(rect.width * 0.15, 70);

      // --- CAMADA 2: Desenho Detalhado da Pista ---
      if (track && track.points) {
        ctx.lineWidth = track.width + 20;
        ctx.strokeStyle = '#ffffff';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        track.points.forEach((p, idx) => {
          if (idx === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
        ctx.stroke();

        ctx.lineWidth = track.width + 20;
        ctx.strokeStyle = '#d32f2f';
        ctx.setLineDash([30, 30]); 
        ctx.stroke();
        ctx.setLineDash([]); 

        ctx.lineWidth = track.width + 4;
        ctx.strokeStyle = '#555555';
        ctx.stroke();

        ctx.lineWidth = track.width;
        ctx.strokeStyle = '#1a1a1f'; 
        ctx.stroke();

        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.setLineDash([15, 20]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // --- CAMADA 3: Grid de Largada e Chegada (START / FINISH) ---
      if (track && track.checkpoints && track.checkpoints.length > 0) {
        const startCP = track.checkpoints[0];
        ctx.save();
        ctx.translate(startCP.x, startCP.y);
        ctx.rotate(startCP.angle + Math.PI / 2);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(-track.width / 2, -15, track.width, 4);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'center';
        ctx.fillText("▲ START ▲", 0, -26);
        ctx.restore();

        const endCP = track.checkpoints[track.checkpoints.length - 1];
        ctx.save();
        ctx.translate(endCP.x, endCP.y);
        ctx.rotate(endCP.angle + Math.PI / 2);
        const squareSize = 12;
        for (let w = -track.width / 2; w < track.width / 2; w += squareSize) {
          ctx.fillStyle = (Math.floor(w / squareSize) % 2 === 0) ? '#ffffff' : '#111111';
          ctx.fillRect(w, -6, squareSize, 6);
          ctx.fillStyle = (Math.floor(w / squareSize) % 2 === 0) ? '#111111' : '#ffffff';
          ctx.fillRect(w, 0, squareSize, 6);
        }
        ctx.fillStyle = '#00ff66';
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'center';
        ctx.fillText("🏁 FINISH 🏁", 0, -20);
        ctx.restore();
      }

      // --- CAMADA 4: Obstáculos Físicos Customizados ---
      if (track && track.obstacles) {
        track.obstacles.forEach(obs => {
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,0.6)';
          ctx.shadowBlur = 6;
          ctx.shadowOffsetY = 4;

          const isCone = obs.type === "cone" || (obs.radius && obs.radius < 14);

          if (isCone) {
            ctx.beginPath();
            ctx.arc(obs.x, obs.y, obs.radius || 12, 0, Math.PI * 2);
            ctx.fillStyle = '#ff6d00'; 
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(obs.x, obs.y, (obs.radius || 12) * 0.4, 0, Math.PI * 2);
            ctx.fillStyle = '#222222';
            ctx.fill();
          } else {
            const size = (obs.radius || 18) * 1.6;
            ctx.fillStyle = '#b0bec5'; 
            ctx.fillRect(obs.x - size / 2, obs.y - size / 2, size, size);
            ctx.strokeStyle = '#37474f';
            ctx.lineWidth = 2;
            ctx.strokeRect(obs.x - size / 2, obs.y - size / 2, size, size);
            ctx.fillStyle = '#ffd600'; 
            ctx.fillRect(obs.x - size / 2 + 4, obs.y - 3, size - 8, 6);
          }

          ctx.shadowColor = 'transparent'; 
          ctx.fillStyle = 'rgba(10, 15, 20, 0.85)';
          ctx.font = 'bold 13px Courier New';
          const labelText = obs.label || "OBSTÁCULO";
          const textWidth = ctx.measureText(labelText).width;
          
          ctx.fillRect(obs.x - textWidth / 2 - 6, obs.y - 32, textWidth + 12, 20);
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.fillText(labelText, obs.x, obs.y - 17);
          ctx.restore();
        });
      }

      // --- CAMADA 5: Renderização dos Veículos ---
      if (cars && cars.length > 0) {
        cars.forEach(car => {
          if (!car.alive && options.hideDead) return;
          
          const isChamp = (car === championCard);
          if (options.turboMode && !isChamp && car.fitness < (options.top5Threshold || 0)) return;

          ctx.save();
          ctx.translate(car.x, car.y);
          ctx.rotate(car.angle);

          if (car.alive) {
            const lightGradient = ctx.createRadialGradient(car.height / 2, 0, 2, car.height / 2 + 50, 0, 40);
            lightGradient.addColorStop(0, isChamp ? 'rgba(255, 235, 59, 0.4)' : 'rgba(255, 255, 255, 0.25)');
            lightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = lightGradient;
            ctx.beginPath();
            ctx.moveTo(car.height / 2, -car.width / 2);
            ctx.lineTo(car.height / 2 + 60, -car.width * 1.5);
            ctx.lineTo(car.height / 2 + 60, car.width * 1.5);
            ctx.lineTo(car.height / 2, car.width / 2);
            ctx.closePath();
            ctx.fill();
          }

          ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
          ctx.fillRect(-car.height / 2 + 4, -car.width / 2 + 4, car.height, car.width);

          ctx.fillStyle = '#151515';
          const wheelW = 10;
          const wheelH = 4;
          const wheels = [
            { x: -car.height / 3, y: -car.width / 2 - 2 },
            { x: -car.height / 3, y: car.width / 2 - 2 },
            { x: car.height / 3 - wheelW, y: -car.width / 2 - 2 },
            { x: car.height / 3 - wheelW, y: car.width / 2 - 2 }
          ];
          wheels.forEach(w => {
            ctx.fillRect(w.x, w.y, wheelW, wheelH);
            ctx.fillStyle = '#78909c'; 
            ctx.fillRect(w.x + 3, w.y + 1, 4, wheelH - 2);
            ctx.fillStyle = '#151515';
          });

          const bodyGrad = ctx.createLinearGradient(-car.height / 2, 0, car.height / 2, 0);
          if (isChamp) {
            bodyGrad.addColorStop(0, '#ffb300'); 
            bodyGrad.addColorStop(0.5, '#fded73'); 
            bodyGrad.addColorStop(1, '#ff8f00'); 
            ctx.strokeStyle = '#ffffff';
          } else {
            if (car.alive) {
              bodyGrad.addColorStop(0, '#1e3c72'); 
              bodyGrad.addColorStop(0.5, '#2a75ff');
              bodyGrad.addColorStop(1, '#1a2a6c');
            } else {
              bodyGrad.addColorStop(0, '#424242'); 
              bodyGrad.addColorStop(1, '#212121');
            }
            ctx.strokeStyle = '#000000';
          }

          ctx.lineWidth = 1.5;
          ctx.fillStyle = bodyGrad;
          ctx.fillRect(-car.height / 2, -car.width / 2, car.height, car.width);
          ctx.strokeRect(-car.height / 2, -car.width / 2, car.height, car.width);

          ctx.fillStyle = car.alive ? '#b3e5fc' : '#546e7a'; 
          ctx.fillRect(car.height * 0.05, -car.width / 2 + 3, car.height * 0.18, car.width - 6);
          ctx.fillStyle = isChamp ? '#d32f2f' : '#212121';
          ctx.fillRect(-car.height / 2 - 2, -car.width / 2 + 1, 4, car.width - 2);

          ctx.restore();

          if (isChamp && car.alive) {
            ctx.save();
            ctx.shadowColor = '#ffd700';
            ctx.shadowBlur = 25;
            ctx.strokeStyle = 'rgba(255, 215, 0, 0.75)';
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.arc(car.x, car.y, car.height * 0.8, 0, Math.PI * 2);
            ctx.stroke();

            ctx.shadowBlur = 0; 
            ctx.fillStyle = '#ffd700';
            ctx.font = 'bold 13px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText("🏆 LÍDER DA IA", car.x, car.y - car.height * 1.1);
            ctx.restore();
            
            if (options.showSensors !== false) {
              this.drawCarSensors(car);
            }
          }
        });
      }

      // --- CORREÇÃO OBRIGATÓRIA: Atualiza o painel lateral com o melhor carro ativo ---
      if (championCard) {
        this.drawSensorPanel(championCard);
      }

      // Restaura o estado para UI Fixo
      ctx.restore();

      // --- CAMADA 6: Overlays de Interface Fixa ---
      if (options.paused) {
        ctx.fillStyle = "rgba(10, 16, 26, 0.65)";
        ctx.fillRect(0, 0, rect.width, rect.height);
        
        ctx.fillStyle = "#ff8844";
        ctx.font = "bold 36px system-ui, -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("SIMULAÇÃO PAUSADA", rect.width / 2, rect.height / 2);
      }
    }

    drawCarSensors(car) {
    const ctx = this.ctx;
    if (!car.sensors) return;
  
     ctx.save();
      // Use exatamente os mesmos ângulos do seu car.js para sincronizar
      const angles = [0, Math.PI/6, -Math.PI/6, Math.PI/3, -Math.PI/3, Math.PI/2, -Math.PI/2, Math.PI];
  
      angles.forEach((ang, idx) => {
         const totalAngle = car.angle + ang;
        const readingsNormalizada = car.sensors[idx] !== undefined ? car.sensors[idx] : 0;
        
        const realDist = 360 * (1 - readingsNormalizada); 
        const targetX = car.x + Math.cos(totalAngle) * realDist;
        const targetY = car.y + Math.sin(totalAngle) * realDist;

        if (readingsNormalizada > 0.7) {
          ctx.strokeStyle = 'rgba(255, 30, 30, 0.85)';
          ctx.lineWidth = 2;
          
          ctx.fillStyle = '#ff1744';
          ctx.beginPath();
          ctx.arc(targetX, targetY, 5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(0, 255, 150, 0.45)'; 
          ctx.lineWidth = 1.2;
        }
        
        ctx.beginPath();
        ctx.moveTo(car.x, car.y);
        ctx.lineTo(targetX, targetY);
        ctx.stroke();
      });
      ctx.restore();
    }

    /**
     * Atualiza os elementos de texto no Dashboard lateral (HTML)
     */
    drawSensorPanel(car) {
      for (let i = 0; i < 8; i++) {
        const sensorLabel = document.getElementById(`sensor-val-${i}`);
        if (sensorLabel && car.sensors) {
          const leitura = car.sensors[i] !== undefined ? car.sensors[i] : 0;
          const proximidade = Math.round(leitura * 100);
          sensorLabel.innerText = `${proximidade}%`;
          
          if (proximidade > 70) {
            sensorLabel.style.color = "#ff3d00";
            sensorLabel.style.fontWeight = "bold";
          } else {
            sensorLabel.style.color = "#00e676";
            sensorLabel.style.fontWeight = "normal";
          }
        }
      }
    }
  }

  global.Visualizer = Visualizer;
})(typeof window !== "undefined" ? window : global);