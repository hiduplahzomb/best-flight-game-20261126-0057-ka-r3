// renderer.js — the WebGL renderer for Aurelia Wings: one small shader
// program for solid low-poly meshes, one for the sky dome, one for the
// sea, and a mesh builder that turns boxes, cones, cylinders, spheres and
// tori into coloured triangle lists. No library: everything is raw WebGL1.

import {
  mat4Identity, mat4Multiply, mat4Perspective, mat4LookAt,
} from './math3.js';

const SOLID_VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec3 aColor;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vWorld;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = mat3(uModel) * aNormal;
  vColor = aColor;
  gl_Position = uProj * uView * w;
}`;

const SOLID_FRAG = `
precision mediump float;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uGlow;
uniform float uAlpha;
uniform vec3 uCamPos;
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vWorld;
void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, uSunDir), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  vec3 light = uSunColor * (0.35 + 0.85 * diff) + uSkyColor * hemi * 0.55;
  vec3 col = vColor * light + vColor * uGlow;
  float dist = distance(uCamPos, vWorld);
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(col, uAlpha);
}`;

const SKY_VERT = `
attribute vec3 aPos;
uniform mat4 uView;
uniform mat4 uProj;
varying vec3 vDir;
void main() {
  vDir = aPos;
  vec4 p = uProj * uView * vec4(aPos, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = `
precision mediump float;
uniform vec3 uSunDir;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.08, 1.0);
  vec3 zenith = vec3(0.20, 0.42, 0.72);
  vec3 mid = vec3(0.55, 0.70, 0.88);
  vec3 horizon = vec3(1.00, 0.72, 0.38);
  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
  col = mix(col, zenith, smoothstep(0.15, 0.65, h));
  float sunAmt = max(dot(d, uSunDir), 0.0);
  // A small sun: the old wide halos (pow 10 / pow 3) blew out a
  // quarter of the sky into a white blob. Tighter falloff, less gain.
  col += vec3(1.0, 0.75, 0.42) * pow(sunAmt, 300.0) * 0.6;
  col += vec3(1.0, 0.62, 0.28) * pow(sunAmt, 24.0) * 0.06;
  col += vec3(0.95, 0.55, 0.25) * pow(sunAmt, 6.0) * 0.03;
  if (d.y < 0.0) col = mix(col, vec3(0.98, 0.68, 0.42), clamp(-d.y * 6.0, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`;

const SEA_VERT = `
attribute vec3 aPos;
uniform mat4 uView;
uniform mat4 uProj;
varying vec3 vWorld;
void main() {
  vec4 w = vec4(aPos, 1.0);
  vWorld = w.xyz;
  gl_Position = uProj * uView * w;
}`;

const SEA_FRAG = `
precision mediump float;
uniform vec3 uSunDir;
uniform vec3 uCamPos;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uTime;
uniform sampler2D uHeight;
varying vec3 vWorld;
void main() {
  vec2 uv = (vWorld.xz + 3200.0) / 6400.0;
  float land = texture2D(uHeight, uv).r;
  vec3 deep = vec3(0.05, 0.30, 0.45);
  vec3 shallow = vec3(0.15, 0.62, 0.66);
  vec3 col = mix(deep, shallow, clamp(land * 1.4, 0.0, 1.0));
  float w1 = sin(vWorld.x * 0.11 + uTime * 0.7) * sin(vWorld.z * 0.13 - uTime * 0.5);
  float w2 = sin((vWorld.x + vWorld.z) * 0.05 + uTime * 0.35);
  vec3 n = normalize(vec3(w1 * 0.10, 1.0, w2 * 0.10));
  vec3 viewDir = normalize(uCamPos - vWorld);
  vec3 refl = reflect(-uSunDir, n);
  float spec = pow(max(dot(refl, viewDir), 0.0), 90.0);
  col += vec3(1.0, 0.75, 0.45) * spec * 1.6;
  // Soft large-scale shimmer, not sparkle: the old 0.9 rad/m glitter
  // aliased into white moiré speckle at any distance. Longer waves,
  // gentler power, a third of the strength.
  float glitter = pow(max(0.0, sin(vWorld.x * 0.22 + uTime * 0.8) * sin(vWorld.z * 0.19 - uTime * 0.6)), 6.0);
  col += vec3(1.0, 0.9, 0.7) * glitter * 0.10;
  float foam = smoothstep(0.02, 0.10, land) * (0.75 + 0.25 * sin(vWorld.x * 0.6 + vWorld.z * 0.5 + uTime * 1.2));
  foam *= smoothstep(0.55, 0.12, land);
  col = mix(col, vec3(0.95, 0.98, 0.95), clamp(foam, 0.0, 1.0) * 0.8);
  float dist = distance(uCamPos, vWorld);
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function makeProgram(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.bindAttribLocation(p, 1, 'aNormal');
  gl.bindAttribLocation(p, 2, 'aColor');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('program: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

// A mesh is just flat arrays plus a GL buffer pair, uploaded once.
export class Mesh {
  constructor(gl, positions, normals, colors, indices) {
    this.gl = gl;
    this.count = indices.length;
    this.posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    this.norBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.norBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
    this.colBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
    this.idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);
  }
}

// A mesh whose vertices change every frame (wingtip trails).
export class DynamicMesh {
  constructor(gl, maxVerts) {
    this.gl = gl;
    this.maxVerts = maxVerts;
    this.count = 0;
    this.posBuf = gl.createBuffer();
    this.norBuf = gl.createBuffer();
    this.colBuf = gl.createBuffer();
    this.idxBuf = gl.createBuffer();
  }
  update(positions, normals, colors, indices) {
    const gl = this.gl;
    this.count = indices.length;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.norBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.DYNAMIC_DRAW);
  }
}

// Collect triangles with per-vertex colours; helpers below append
// transformed primitives into it. Normals are flat (per face).
export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.idx = [];
  }
  addTriangle(a, b, c, color) {
    this.addTriangleColors(a, b, c, color, color, color);
  }
  // Same triangle, but each vertex carries its own colour, so a mesh
  // can shade smoothly instead of one flat colour per triangle.
  addTriangleColors(a, b, c, ca, cb, cc) {
    const base = this.pos.length / 3;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / l, n[1] / l, n[2] / l];
    for (const [p, col] of [[a, ca], [b, cb], [c, cc]]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(col[0], col[1], col[2]);
    }
    this.idx.push(base, base + 1, base + 2);
  }
  addQuad(a, b, c, d, color) {
    this.addTriangle(a, b, c, color);
    this.addTriangle(a, c, d, color);
  }
  // Box centred at `at`, size `s`, rotated by `m` (a mat4, identity if
  // omitted). Each face gets its own colour shade for a built look.
  addBox(at, s, m, color, shadeTop = 1.12, shadeSide = 0.92) {
    const hx = s[0] / 2, hy = s[1] / 2, hz = s[2] / 2;
    const corners = [
      [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
      [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
    ];
    const xf = (p) => {
      const q = [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
      ];
      return [q[0] + at[0], q[1] + at[1], q[2] + at[2]];
    };
    const P = corners.map(xf);
    const tint = (f) => [color[0] * f, color[1] * f, color[2] * f];
    this.addQuad(P[4], P[5], P[6], P[7], tint(shadeTop)); // +z
    this.addQuad(P[1], P[0], P[3], P[2], tint(shadeSide)); // -z
    this.addQuad(P[5], P[1], P[2], P[6], tint(1.0)); // +x
    this.addQuad(P[0], P[4], P[7], P[3], tint(0.85)); // -x
    this.addQuad(P[7], P[6], P[2], P[3], tint(shadeTop)); // +y
    this.addQuad(P[0], P[1], P[5], P[4], tint(0.7)); // -y
  }
  addCone(at, radius, height, segments, color, m) {
    const tip = [0, height / 2, 0];
    const base = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      base.push([Math.cos(a) * radius, -height / 2, Math.sin(a) * radius]);
    }
    const xf = (p) => {
      if (!m) return [p[0] + at[0], p[1] + at[1], p[2] + at[2]];
      const q = [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
      ];
      return [q[0] + at[0], q[1] + at[1], q[2] + at[2]];
    };
    for (let i = 0; i < segments; i++) {
      const a = base[i], b = base[(i + 1) % segments];
      this.addTriangle(xf(tip), xf(b), xf(a), color);
      this.addTriangle(xf([0, -height / 2, 0]), xf(a), xf(b),
        [color[0] * 0.7, color[1] * 0.7, color[2] * 0.7]);
    }
  }
  addCylinder(at, rTop, rBottom, height, segments, color, m) {
    const top = [], bot = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      top.push([Math.cos(a) * rTop, height / 2, Math.sin(a) * rTop]);
      bot.push([Math.cos(a) * rBottom, -height / 2, Math.sin(a) * rBottom]);
    }
    const xf = (p) => {
      if (!m) return [p[0] + at[0], p[1] + at[1], p[2] + at[2]];
      const q = [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
      ];
      return [q[0] + at[0], q[1] + at[1], q[2] + at[2]];
    };
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      this.addQuad(xf(top[i]), xf(top[j]), xf(bot[j]), xf(bot[i]), color);
      this.addTriangle(xf([0, height / 2, 0]), xf(top[j]), xf(top[i]),
        [color[0] * 1.1, color[1] * 1.1, color[2] * 1.1]);
      this.addTriangle(xf([0, -height / 2, 0]), xf(bot[i]), xf(bot[j]),
        [color[0] * 0.7, color[1] * 0.7, color[2] * 0.7]);
    }
  }
  addSphere(at, radius, color, segments = 8, rings = 6, squashY = 1) {
    const pts = [];
    for (let ri = 0; ri <= rings; ri++) {
      const phi = (ri / rings) * Math.PI;
      const y = Math.cos(phi) * radius * squashY;
      const rr = Math.sin(phi) * radius;
      const row = [];
      for (let si = 0; si <= segments; si++) {
        const th = (si / segments) * Math.PI * 2;
        row.push([Math.cos(th) * rr + at[0], y + at[1], Math.sin(th) * rr + at[2]]);
      }
      pts.push(row);
    }
    for (let ri = 0; ri < rings; ri++) {
      for (let si = 0; si < segments; si++) {
        const a = pts[ri][si], b = pts[ri][si + 1];
        const c = pts[ri + 1][si + 1], d = pts[ri + 1][si];
        if (ri === 0) this.addTriangle(a, c, b, color);
        else if (ri === rings - 1) this.addTriangle(a, c, d, color);
        else this.addQuad(a, b, c, d, color);
      }
    }
  }
  // Flat ring in the XZ plane, centred at `at`, for gates.
  addTorus(at, radius, tube, color, segments = 28, tubeSeg = 8) {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      for (let j = 0; j < tubeSeg; j++) {
        const b0 = (j / tubeSeg) * Math.PI * 2;
        const b1 = ((j + 1) / tubeSeg) * Math.PI * 2;
        const p = (a, b) => [
          at[0] + (radius + tube * Math.cos(b)) * Math.cos(a),
          at[1] + tube * Math.sin(b),
          at[2] + (radius + tube * Math.cos(b)) * Math.sin(a),
        ];
        this.addQuad(p(a0, b0), p(a1, b0), p(a1, b1), p(a0, b1), color);
      }
    }
  }
  build(gl) {
    return new Mesh(gl, this.pos, this.nor, this.col, this.idx);
  }
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl;
    gl.getExtension('OES_element_index_uint');
    this.solid = makeProgram(gl, SOLID_VERT, SOLID_FRAG);
    this.skyProg = makeProgram(gl, SKY_VERT, SKY_FRAG);
    this.seaProg = makeProgram(gl, SEA_VERT, SEA_FRAG);
    // Warm golden-hour sun, low in the east.
    this.sunDir = [0.82, 0.30, -0.42];
    const l = Math.hypot(...this.sunDir);
    this.sunDir = this.sunDir.map((v) => v / l);
    this.sunColor = [1.0, 0.72, 0.42];
    this.skyColor = [0.45, 0.62, 0.85];
    this.fogColor = [0.98, 0.72, 0.45];
    this.fogDensity = 0.00012;
    this.time = 0;
    this.heightTex = null;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
    this.width = w;
    this.height = h;
  }

  uploadHeightTexture(canvas2d) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, canvas2d);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.heightTex = tex;
  }

  beginFrame(view, proj, camPos) {
    const gl = this.gl;
    this.view = view;
    this.proj = proj;
    this.camPos = camPos;
    gl.clearColor(0.98, 0.72, 0.45, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // Sky dome first, depth writes off so the world draws over it. The
    // dome is viewed from the inside, so culling stays off for it, and the
    // depth test stays off too: its depth is 1.0, the cleared value, and
    // a LESS test would throw every fragment away.
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(this.skyProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.skyProg, 'uView'), false, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.skyProg, 'uProj'), false, proj);
    gl.uniform3fv(gl.getUniformLocation(this.skyProg, 'uSunDir'), this.sunDir);
    this.drawRaw(this.skyMesh);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }

  setSkyMesh(mesh) {
    this.skyMesh = mesh;
  }

  drawRaw(mesh) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.posBuf);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.norBuf);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(1);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.colBuf);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.idxBuf);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
  }

  drawSolid(mesh, model, glow = 0, alpha = 1) {
    const gl = this.gl;
    gl.useProgram(this.solid);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.solid, 'uModel'), false, model);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.solid, 'uView'), false, this.view);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.solid, 'uProj'), false, this.proj);
    gl.uniform3fv(gl.getUniformLocation(this.solid, 'uSunDir'), this.sunDir);
    gl.uniform3fv(gl.getUniformLocation(this.solid, 'uSunColor'), this.sunColor);
    gl.uniform3fv(gl.getUniformLocation(this.solid, 'uSkyColor'), this.skyColor);
    gl.uniform3fv(gl.getUniformLocation(this.solid, 'uFogColor'), this.fogColor);
    gl.uniform1f(gl.getUniformLocation(this.solid, 'uFogDensity'), this.fogDensity);
    gl.uniform1f(gl.getUniformLocation(this.solid, 'uGlow'), glow);
    gl.uniform1f(gl.getUniformLocation(this.solid, 'uAlpha'), alpha);
    gl.uniform3fv(gl.getUniformLocation(this.solid, 'uCamPos'), this.camPos);
    if (alpha < 1) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
    }
    this.drawRaw(mesh);
    if (alpha < 1) {
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  }

  drawSea(mesh) {
    const gl = this.gl;
    gl.useProgram(this.seaProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.seaProg, 'uView'), false, this.view);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.seaProg, 'uProj'), false, this.proj);
    gl.uniform3fv(gl.getUniformLocation(this.seaProg, 'uSunDir'), this.sunDir);
    gl.uniform3fv(gl.getUniformLocation(this.seaProg, 'uCamPos'), this.camPos);
    gl.uniform3fv(gl.getUniformLocation(this.seaProg, 'uFogColor'), this.fogColor);
    gl.uniform1f(gl.getUniformLocation(this.seaProg, 'uFogDensity'), this.fogDensity);
    gl.uniform1f(gl.getUniformLocation(this.seaProg, 'uTime'), this.time);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.uniform1i(gl.getUniformLocation(this.seaProg, 'uHeight'), 0);
    // Sea has no normals/colours; reuse the solid attribute slots with
    // the sea mesh's own buffers (positions only matter here).
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.posBuf);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.idxBuf);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
  }

  static perspective(fov, aspect, near, far) {
    return mat4Perspective(fov, aspect, near, far);
  }

  static lookAt(eye, target, up) {
    return mat4LookAt(eye, target, up);
  }
}

export { mat4Identity, mat4Multiply };
