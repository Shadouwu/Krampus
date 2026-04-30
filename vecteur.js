class t {
  constructor(t = 0, s = 0) {
    this.x = t, this.y = s;
  }
  static fromAngle(t, s) {
    return new this(s * Math.cos(t), s * Math.sin(t));
  }
  static fromArray([t, s]) {
    return new this(t, s);
  }
  static fromObject({ x: t, y: s }) {
    return new this(t, s);
  }
  static random(t = 1) {
    return this.fromAngle(2 * Math.random() * Math.PI, t);
  }
  add(t) {
    return this.x += t.x, this.y += t.y, this;
  }
  angle() {
    return Math.atan2(this.y, this.x);
  }
  clone() {
    return new this.constructor(this.x, this.y);
  }
  copy(t) {
    return this.x = t.x, this.y = t.y, this;
  }
  cross(t) {
    return this.x * t.y - this.y * t.x;
  }
  dist(t) {
    return Math.sqrt(this.distSq(t));
  }
  distSq(t) {
    const s = t.x - this.x, h = t.y - this.y;
    return s * s + h * h;
  }
  div(t) {
    return this.x /= t.x, this.y /= t.y, this;
  }
  divScalar(t) {
    return this.x /= t, this.y /= t, this;
  }
  dot(t) {
    return this.x * t.x + this.y * t.y;
  }
  equals(t) {
    return this.x === t.x && this.y === t.y;
  }
  lerp(t, s) {
    return this.x += (t.x - this.x) * s, this.y += (t.y - this.y) * s, this;
  }
  limit(t) {
    return this.magSq() > t * t && this.setMag(t), this;
  }
  mag() {
    return Math.sqrt(this.magSq());
  }
  magSq() {
    return this.x * this.x + this.y * this.y;
  }
  mul(t) {
    return this.x *= t.x, this.y *= t.y, this;
  }
  mulScalar(t) {
    return this.x *= t, this.y *= t, this;
  }
  normalize() {
    return this.setMag(1);
  }
  rotate(t) {
    const s = this.angle() + t;
    return this.setAngle(s), this;
  }
  set(t, s) {
    return this.x = t, this.y = s, this;
  }
  setAngle(t) {
    const s = this.mag();
    return this.x = s * Math.cos(t), this.y = s * Math.sin(t), this;
  }
  setMag(t) {
    return this.mag() > 1e-6 ? this.normalize().mulScalar(t) : this.x = t, this;
  }
  sub(t) {
    return this.x -= t.x, this.y -= t.y, this;
  }
  toArray() {
    return [this.x, this.y];
  }
  toObject() {
    return { x: this.x, y: this.y };
  }
  toString() {
    return `{ x: ${this.x}, y: ${this.y} }`;
  }
}
function s(s, h) {
  return new t(s, h);
}
export { t as default, s as vec2 };