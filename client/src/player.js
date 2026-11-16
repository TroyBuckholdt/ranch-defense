// Local first-person movement with collision against the shared map.
import * as THREE from 'three';
import { resolveCircle, groundHeight, playerPassable } from '../../shared/world.js';

const RADIUS = 0.38;
const GRAVITY = 20;
const JUMP = 6.6;

export class LocalPlayer {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;
    this.pitch = 0;
    this.grounded = true;
    this.speed = 0;
    this.sprinting = false;
    this.eye = 1.62;
    this.landDip = 0;
    this.recoil = 0;      // temporary upward kick that recovers
    this.crouching = false;
    this.sliding = 0;     // seconds of slide left
    this.slideDir = new THREE.Vector3();
  }

  // crouch; if sprinting, slide instead (CoD style)
  startCrouch() {
    this.crouching = true;
    if (this.sprinting && this.grounded && this.sliding <= 0) {
      this.sliding = 0.75;
      this.slideDir.set(this.vel.x, 0, this.vel.z).normalize();
    }
  }

  teleport(x, y, z) { this.pos.set(x, y, z); this.vel.set(0, 0, 0); }

  update(dt, keys, { aiming, downed, canMove }) {
    const fwd = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    const side = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    this.sprinting = !!keys.ShiftLeft && fwd > 0 && !aiming && !downed && canMove && !this.crouching;
    let speed = downed ? 0 : this.sprinting ? 6.6 : this.crouching ? 2.2 : aiming ? 2.7 : 4.4;
    if (!canMove) speed = 0;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // camera looks down -Z at yaw 0
    let wx = -sin * fwd + cos * side, wz = -cos * fwd - sin * side;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx = (wx / wl) * speed; wz = (wz / wl) * speed; }
    const accel = this.grounded ? 14 : 2.5;
    if (this.sliding > 0) { // momentum slide that bleeds off
      this.sliding -= dt;
      const sp = 9.5 * Math.max(0.3, this.sliding / 0.75);
      this.vel.x = this.slideDir.x * sp; this.vel.z = this.slideDir.z * sp;
    } else {
      this.vel.x += (wx - this.vel.x) * Math.min(1, accel * dt);
      this.vel.z += (wz - this.vel.z) * Math.min(1, accel * dt);
    }

    if (keys.Space && this.grounded && canMove && !downed) {
      this.vel.y = JUMP;
      this.grounded = false;
    }
    this.vel.y -= GRAVITY * dt;

    const prevVy = this.vel.y;
    let x = this.pos.x + this.vel.x * dt, z = this.pos.z + this.vel.z * dt, y = this.pos.y + this.vel.y * dt;
    [x, z] = resolveCircle(x, z, RADIUS, y, 0.45, playerPassable);
    const g = groundHeight(x, z, RADIUS, this.pos.y, 0.6);
    if (y <= g) {
      if (!this.grounded && prevVy < -6) this.landDip = Math.min(0.12, -prevVy * 0.012);
      y = g; this.vel.y = 0; this.grounded = true;
    } else {
      this.grounded = y - g < 0.02;
    }
    this.pos.set(x, y, z);
    this.speed = Math.hypot(this.vel.x, this.vel.z);

    const targetEye = downed ? 0.45 : this.sliding > 0 ? 0.85 : this.crouching ? 1.05 : 1.62;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 10);
    this.landDip = Math.max(0, this.landDip - dt * 0.5);
    this.recoil -= this.recoil * Math.min(1, dt * 7);
  }

  look(dx, dy, sens) {
    this.yaw -= dx * sens;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy * sens));
  }
}
