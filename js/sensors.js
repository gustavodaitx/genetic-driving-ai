/**
 * Sensores raycast — 6 raios + sensor frontal longo e lateral estendido.
 * Range aumentado para 360px conforme especificação de otimização.
 */
(function (global) {
  const SENSOR_ANGLES = [
    { id: "front",      angle: 0 },
    { id: "frontLeft",  angle: -Math.PI / 6 },
    { id: "frontRight", angle:  Math.PI / 6 },
    { id: "left",       angle: -Math.PI / 2 },
    { id: "right",      angle:  Math.PI / 2 },
    { id: "rear",       angle:  Math.PI },
  ];

  const MAX_RANGE = 360; // aumentado de 220 para 360

  function raySegmentIntersect(ox, oy, dx, dy, x1, y1, x2, y2) {
    const denom = dx * (y2 - y1) - dy * (x2 - x1);
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((x1 - ox) * (y2 - y1) - (y1 - oy) * (x2 - x1)) / denom;
    const u = ((x1 - ox) * dy - (y1 - oy) * dx) / denom;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      return { dist: t * MAX_RANGE, x: ox + dx * t, y: oy + dy * t };
    }
    return null;
  }

  function rayCircleIntersect(ox, oy, dx, dy, cx, cy, r) {
    const fx = ox - cx, fy = oy - cy;
    const a  = dx * dx + dy * dy;
    const b  = 2 * (fx * dx + fy * dy);
    const c  = fx * fx + fy * fy - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sqrt = Math.sqrt(disc);
    let t = (-b - sqrt) / (2 * a);
    if (t < 0) t = (-b + sqrt) / (2 * a);
    if (t >= 0 && t <= 1) {
      return { dist: t * MAX_RANGE, x: ox + dx * t, y: oy + dy * t };
    }
    return null;
  }

  class CarSensors {
    constructor(car) {
      this.car  = car;
      this.readings = [];
      this.collisionNear  = 0;
      this.frontVisibility = 1;
    }

    update(track) {
      const car      = this.car;
      const readings = [];
      let minFront   = MAX_RANGE;
      let nearHit    = 0;

      for (const spec of SENSOR_ANGLES) {
        const worldAngle = car.angle + spec.angle;
        const dx = Math.cos(worldAngle);
        const dy = Math.sin(worldAngle);
        const ox = car.x + dx * car.width  * 0.35;
        const oy = car.y + dy * car.height * 0.35;

        let closest = MAX_RANGE;
        let hitX    = ox + dx * MAX_RANGE;
        let hitY    = oy + dy * MAX_RANGE;

        for (const seg of track.getWallSegments()) {
          const hit = raySegmentIntersect(ox, oy, dx * MAX_RANGE, dy * MAX_RANGE, seg.x1, seg.y1, seg.x2, seg.y2);
          if (hit && hit.dist < closest) {
            closest = hit.dist;
            hitX    = hit.x;
            hitY    = hit.y;
          }
        }

        for (const obs of track.getObstacles()) {
          const hit = rayCircleIntersect(ox, oy, dx, dy, obs.x, obs.y, obs.radius);
          if (hit) {
            const dist = hit.dist;
            if (dist < closest) {
              closest = dist;
              hitX = ox + dx * dist;
              hitY = oy + dy * dist;
            }
          }
        }

        const normalized = 1 - closest / MAX_RANGE;
        readings.push({ id: spec.id, angle: spec.angle, dist: closest, normalized, hitX, hitY, originX: ox, originY: oy });

        if (spec.id === "front" || spec.id === "frontLeft" || spec.id === "frontRight") {
          minFront = Math.min(minFront, closest);
        }
        if (closest < 45) nearHit = Math.max(nearHit, 1 - closest / 45);
      }

      this.readings        = readings;
      this.collisionNear   = nearHit;
      this.frontVisibility = minFront / MAX_RANGE;
    }

    getNormalizedDistances() { return this.readings.map((r) => r.normalized); }

    draw(ctx) {
      for (const r of this.readings) {
        const alpha = 0.35 + r.normalized * 0.5;
        ctx.strokeStyle = r.normalized > 0.7
          ? `rgba(255,80,80,${alpha})`
          : `rgba(0,255,180,${alpha})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(r.originX, r.originY);
        ctx.lineTo(r.hitX, r.hitY);
        ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.arc(r.hitX, r.hitY, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  global.CarSensors    = CarSensors;
  global.SENSOR_ANGLES = SENSOR_ANGLES;
  global.SENSOR_MAX_RANGE = MAX_RANGE;
})(typeof window !== "undefined" ? window : global);
