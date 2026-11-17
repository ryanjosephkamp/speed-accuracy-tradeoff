// Light for the decision machine: ball trails (or the exact flow) accumulate as light in a
// floating-point buffer that fades a little each frame, like a long exposure; a blurred copy adds
// bloom; the result is tone-mapped over the board picture. WebGL 2; returns null without it, and
// the machine then draws its trails on a plain canvas instead. Coordinates are CSS pixels.

const VS_QUAD = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const VS_SEG = `#version 300 es
in vec2 pos; in float side; in float val;
uniform vec2 res;
out float vSide; out float vVal;
void main() {
  vSide = side; vVal = val;
  vec2 c = pos / res * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;

const FS_SEG = `#version 300 es
precision highp float;
in float vSide; in float vVal; out vec4 o;
void main() { float f = 1.0 - vSide * vSide; o = vec4(vec3(vVal * f), 1.0); }`;

const FS_FILL = `#version 300 es
precision highp float; out vec4 o; void main() { o = vec4(1.0); }`;

const FS_COPY = `#version 300 es
precision highp float; in vec2 uv; uniform sampler2D t; out vec4 o;
void main() { o = texture(t, uv); }`;

const FS_BLUR = `#version 300 es
precision highp float; in vec2 uv; uniform sampler2D t; uniform vec2 d; out vec4 o;
void main() {
  vec4 s = texture(t, uv) * 0.2270270;
  s += (texture(t, uv + d * 1.3846154) + texture(t, uv - d * 1.3846154)) * 0.3162162;
  s += (texture(t, uv + d * 3.2307692) + texture(t, uv - d * 3.2307692)) * 0.0702703;
  o = s;
}`;

const FS_COMPOSITE = `#version 300 es
precision highp float; in vec2 uv;
uniform sampler2D board, trails, flow, bloom;
uniform float expTrails, expFlow, mixF, bloomGain, paper;
uniform vec3 tint;
out vec4 o;
void main() {
  vec3 b = texture(board, vec2(uv.x, 1.0 - uv.y)).rgb;
  float l = mix(texture(trails, uv).r * expTrails, texture(flow, uv).r * expFlow, mixF) + texture(bloom, uv).r * bloomGain;
  float m = 1.0 - exp(-l);
  if (paper > 0.5) {
    // on paper the same exposure develops as ink: the paper darkens toward the ink's color, and
    // the densest paths run toward black, like silver in a print
    vec3 ink = mix(tint, vec3(0.17, 0.17, 0.19), smoothstep(0.6, 1.0, m));
    o = vec4(b * (1.0 - m * (1.0 - ink)), 1.0);
  } else {
    // hot light runs from warm to white
    vec3 c = mix(tint, vec3(1.0), smoothstep(0.55, 1.0, m)) * m;
    o = vec4(b + c * (1.0 - b * 0.6), 1.0);
  }
}`;

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

export function createGlow(canvas) {
  let gl;
  try { gl = canvas.getContext("webgl2", { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true }); } catch { return null; }
  if (!gl) return null;
  const float = gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float");
  const fmt = float ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT } : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };
  let progs;
  try {
    progs = {
      seg: compile(gl, VS_SEG, FS_SEG), fill: compile(gl, VS_QUAD, FS_FILL), copy: compile(gl, VS_QUAD, FS_COPY),
      blur: compile(gl, VS_QUAD, FS_BLUR), comp: compile(gl, VS_QUAD, FS_COMPOSITE),
    };
  } catch { return null; }
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const segBuf = gl.createBuffer();

  const target = (w, h, filter = gl.LINEAR) => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, gl.RGBA, fmt.type, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && fmt.internal !== gl.RGBA8) {
      fmt.internal = gl.RGBA8; fmt.type = gl.UNSIGNED_BYTE;
      gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
      return target(w, h, filter);
    }
    return { tex, fb, w, h };
  };
  const boardTex = gl.createTexture();
  let W = 1, H = 1, dpr = 1, trails = null, flow = null, small = null, small2 = null, boardReady = false;

  function drawQuad(prog) {
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  function clear(t) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.viewport(0, 0, t.w, t.h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  }

  const api = {
    float: Boolean(float),
    resize(w, h, ratio) {
      dpr = ratio; W = Math.max(1, Math.round(w * dpr)); H = Math.max(1, Math.round(h * dpr));
      canvas.width = W; canvas.height = H;
      trails = target(W, H); flow = target(W, H);
      small = target(Math.max(1, W >> 2), Math.max(1, H >> 2)); small2 = target(small.w, small.h);
      clear(trails); clear(flow);
    },
    /** The board picture (an opaque canvas of the same size) under the light. */
    setBoard(src) {
      gl.bindTexture(gl.TEXTURE_2D, boardTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      boardReady = true;
    },
    clearTrails() { if (trails) clear(trails); },
    /** Fade the trails: multiply the stored light by k. */
    fade(k) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, trails.fb); gl.viewport(0, 0, W, H);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ZERO, gl.CONSTANT_COLOR); gl.blendColor(k, k, k, k);
      drawQuad(progs.fill);
      gl.disable(gl.BLEND);
    },
    /** Add light along segments [x0, y0, x1, y1, value] (CSS px), each `width` px wide. */
    segments(list, width, into = "trails") {
      const n = list.length / 5;
      if (!n) return;
      const v = new Float32Array(n * 6 * 4), hw = (width * dpr) / 2;
      let o = 0;
      for (let i = 0; i < n; i++) {
        const x0 = list[5 * i] * dpr, y0 = list[5 * i + 1] * dpr, x1 = list[5 * i + 2] * dpr, y1 = list[5 * i + 3] * dpr, val = list[5 * i + 4];
        let dx = x1 - x0, dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * hw, ny = (dx / len) * hw;
        const pts = [[x0 + nx, y0 + ny, 1], [x0 - nx, y0 - ny, -1], [x1 + nx, y1 + ny, 1], [x1 + nx, y1 + ny, 1], [x0 - nx, y0 - ny, -1], [x1 - nx, y1 - ny, -1]];
        for (const [x, y, s] of pts) { v[o++] = x; v[o++] = y; v[o++] = s; v[o++] = val; }
      }
      const t = into === "flow" ? flow : trails;
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.viewport(0, 0, W, H);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      const prog = progs.seg;
      gl.useProgram(prog);
      gl.uniform2f(gl.getUniformLocation(prog, "res"), W, H);
      gl.bindBuffer(gl.ARRAY_BUFFER, segBuf);
      gl.bufferData(gl.ARRAY_BUFFER, v, gl.DYNAMIC_DRAW);
      const stride = 16;
      for (const [name, size, off] of [["pos", 2, 0], ["side", 1, 8], ["val", 1, 12]]) {
        const loc = gl.getAttribLocation(prog, name);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
      }
      gl.drawArrays(gl.TRIANGLES, 0, n * 6);
      gl.disable(gl.BLEND);
      for (const name of ["pos", "side", "val"]) gl.disableVertexAttribArray(gl.getAttribLocation(prog, name));
    },
    clearFlow() { if (flow) clear(flow); },
    /** Draw the board, then the light (trails or flow) with bloom, to the canvas. */
    render(mixF, expTrails, expFlow, bloomGain, tint, paper = 0) {
      if (!boardReady) return;
      const src = mixF > 0.5 ? flow : trails;
      const srcExp = mixF > 0.5 ? expFlow : expTrails;
      // bloom: shrink, then blur across and down
      gl.bindFramebuffer(gl.FRAMEBUFFER, small.fb); gl.viewport(0, 0, small.w, small.h);
      gl.useProgram(progs.copy); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(gl.getUniformLocation(progs.copy, "t"), 0);
      drawQuad(progs.copy);
      for (const [from, to, dx, dy] of [[small, small2, 1, 0], [small2, small, 0, 1], [small, small2, 2, 0], [small2, small, 0, 2]]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb); gl.viewport(0, 0, to.w, to.h);
        gl.useProgram(progs.blur); gl.bindTexture(gl.TEXTURE_2D, from.tex);
        gl.uniform1i(gl.getUniformLocation(progs.blur, "t"), 0);
        gl.uniform2f(gl.getUniformLocation(progs.blur, "d"), dx / from.w, dy / from.h);
        drawQuad(progs.blur);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      const p = progs.comp;
      gl.useProgram(p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, boardTex); gl.uniform1i(gl.getUniformLocation(p, "board"), 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, trails.tex); gl.uniform1i(gl.getUniformLocation(p, "trails"), 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, flow.tex); gl.uniform1i(gl.getUniformLocation(p, "flow"), 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, small.tex); gl.uniform1i(gl.getUniformLocation(p, "bloom"), 3);
      gl.uniform1f(gl.getUniformLocation(p, "expTrails"), expTrails);
      gl.uniform1f(gl.getUniformLocation(p, "expFlow"), expFlow);
      gl.uniform1f(gl.getUniformLocation(p, "mixF"), mixF);
      gl.uniform1f(gl.getUniformLocation(p, "bloomGain"), bloomGain * srcExp);
      gl.uniform3f(gl.getUniformLocation(p, "tint"), ...tint);
      gl.uniform1f(gl.getUniformLocation(p, "paper"), paper);
      drawQuad(p);
      gl.activeTexture(gl.TEXTURE0);
    },
  };
  return api;
}
