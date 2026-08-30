/**
 * WebGL1 renderer. One fullscreen triangle, state read from a 128x2 texture.
 *
 * The surface is reconstructed with Catmull-Rom over four samples, not a
 * smoothstep over two. Smoothstep has ZERO derivative at every knot, so the
 * surface slope flattens 128 times across the screen — and since the specular
 * normal is derived from that slope, the highlight facets. That is what makes
 * a naive implementation look pixelated.
 */

import { N, HRES } from "./liquid.js";

const VS = `attribute vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}`;

const FS = `
// Hash and the 16-bit surface decode need more than fp16. highp is not
// guaranteed in GLES2 fragment shaders, hence the fallback.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uTex;
uniform vec2  uRes;
uniform float uAr;      // width / height, converts container units to uv.y
uniform float uRest;    // rest level in uv (0 = bottom of the canvas)
uniform float uSlope;   // tilt plane = tan(angle)
uniform float uT;
uniform float uInt;     // global intensity, also used for fade-in
uniform float uAer;     // max entrained air
uniform float uFoam;    // max foam
uniform float uIdle;    // 0..1 baseline bubbles so the surface reads when still
uniform vec3  uDeep;    // colour at depth
uniform vec3  uShallow; // colour just under the surface
uniform vec3  uFilm;    // colour of the surface film and bubbles

float h21(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973));q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);vec2 w=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1.0,0.0)),w.x),mix(h21(i+vec2(0.0,1.0)),h21(i+vec2(1.0,1.0)),w.x),w.y);}

float dec(vec4 t){ return (t.r + t.g*0.0039216)*2.0 - 1.0; }
vec4 tap(float i){ return texture2D(uTex, vec2((clamp(i,0.0,127.0)+0.5)/128.0, 0.25)); }

void main(){
  vec2 uv = gl_FragCoord.xy/uRes;

  // Catmull-Rom over four samples: C1 with the CORRECT slopes at the knots.
  float fx = uv.x*127.0;
  float i1 = floor(fx);
  float f  = fx - i1;
  float y0=dec(tap(i1-1.0)), y1=dec(tap(i1)), y2=dec(tap(i1+1.0)), y3=dec(tap(i1+2.0));
  float f2=f*f, f3=f2*f;
  float wave  = 0.5*((2.0*y1) + (-y0+y2)*f + (2.0*y0-5.0*y1+4.0*y2-y3)*f2 + (-y0+3.0*y1-3.0*y2+y3)*f3) * HRES_JS;
  // Derivative from the same polynomial, so the slope does not pulse.
  float dwave = 0.5*((-y0+y2) + 2.0*(2.0*y0-5.0*y1+4.0*y2-y3)*f + 3.0*(-y0+3.0*y1-3.0*y2+y3)*f2) * HRES_JS;

  float aer  = texture2D(uTex, vec2((i1+0.5)/128.0, 0.75)).r;
  float foam = mix(tap(i1).a, tap(i1+1.0).a, f);

  // The tilt plane is added back as an exact float — no quantisation shows.
  float y = uRest + (wave + uSlope*(uv.x-0.5))*uAr;
  float d = y - uv.y;                       // > 0 below the surface
  float sl = (dwave + uSlope)*uAr;

  // Nothing above the surface may end on a step: an exponential film still has
  // alpha ~0.09 just above it and would draw a hard ghost line along the water.
  float above = -min(d, 0.0);
  float topFade = 1.0 - smoothstep(0.030, 0.055, above);
  if (above > 0.055) { gl_FragColor = vec4(0.0); return; }

  float dep = max(d, 0.0);
  float body = smoothstep(-1.5/uRes.y, 1.5/uRes.y, d);
  vec3 col = mix(uShallow, uDeep, clamp(dep/(uAr*0.85), 0.0, 1.0));

  // Surface film: perpendicular distance, so it stays even width when tilted.
  float dn = abs(d)/sqrt(1.0 + sl*sl);
  float film = exp(-dn/0.010);
  film *= 0.75 + 0.25*vn(vec2(uv.x*40.0 - uT*0.6, uT*0.3));
  col = mix(col, uFilm, min(1.0, film*0.85));

  // Bubbles. A sparse baseline layer always rises, so the surface is readable
  // even when nothing is moving; entrained air adds to it.
  float bub = 0.0;
  {
    float dens = aer*smoothstep(0.0,0.010,d)*exp(-dep*3.4)
               + uIdle*0.055*smoothstep(0.0,0.020,d)*(0.45+0.55*exp(-dep*1.1));
    if (dens > 0.002) {
      // The grid is SHEARED by the surface slope, so bubbles rise perpendicular
      // to the surface rather than along the display axis.
      vec2 q = vec2(uv.x, uv.y/uAr);
      q.x += uSlope*q.y;
      q *= 30.0;
      q.y -= uT*0.85;                        // phase goes down, bubbles go up
      vec2 gi=floor(q), gf=fract(q);
      float r1=h21(gi+3.7);
      if (r1 > 0.55) {
        float r2=h21(gi+11.3);
        float an = uT*(0.7+1.3*r2) + r1*29.0;
        vec2 bc = vec2(0.30+0.40*r2+0.13*sin(an), 0.5+0.24*cos(an));
        float rad = 0.09 + 0.15*r2;
        float l = length(gf-bc);
        float disc = 1.0 - smoothstep(rad*0.45, rad, l);
        float core = 1.0 - smoothstep(rad*0.10, rad*0.55, l);
        bub = (disc*0.34 + max(disc-core,0.0)*0.9) * min(dens*1.6, 1.0);
      }
    }
  }
  col = mix(col, uFilm, min(1.0, bub));

  // Foam sits ON the surface and survives movement — the signature of surfactant.
  float pena = 0.0;
  if (uFoam > 0.02) {
    float band = 1.0 - smoothstep(0.0, 0.05, abs(d));
    float grain = vn(vec2(uv.x*70.0, d*70.0 + uT*0.2))*0.6
                + vn(vec2(uv.x*150.0, d*150.0 - uT*0.35))*0.4;
    pena = band*foam*smoothstep(0.35,0.75,grain);
    col = mix(col, uFilm, min(1.0, pena*0.95));
  }

  float a = body*0.62 + film*0.5 + bub*0.6 + pena*0.8;
  a = clamp(a, 0.0, 0.9)*uInt*topFade;
  gl_FragColor = vec4(col*a, a);
}
`.replace(/HRES_JS/g, HRES.toFixed(3));

const hex = (s) => {
  const v = parseInt(s.replace("#", ""), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

export function createRenderer(canvas, colors) {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: "low-power",
  });
  if (!gl) return null;

  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      console.warn("[slosh] shader:", gl.getShaderInfoLog(s));
    return s;
  };
  const pr = gl.createProgram();
  const vs = sh(gl.VERTEX_SHADER, VS);
  const fs = sh(gl.FRAGMENT_SHADER, FS);
  gl.attachShader(pr, vs);
  gl.attachShader(pr, fs);
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
    console.warn("[slosh] link:", gl.getProgramInfoLog(pr));
    return null;
  }
  gl.useProgram(pr);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aLoc = gl.getAttribLocation(pr, "a");
  gl.enableVertexAttribArray(aLoc);
  gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array(N * 2 * 4));

  const U = (n) => gl.getUniformLocation(pr, n);
  const u = {
    tex: U("uTex"), res: U("uRes"), ar: U("uAr"), rest: U("uRest"), slope: U("uSlope"),
    t: U("uT"), int: U("uInt"), aer: U("uAer"), foam: U("uFoam"), idle: U("uIdle"),
    deep: U("uDeep"), shallow: U("uShallow"), film: U("uFilm"),
  };
  gl.uniform1i(u.tex, 0);
  gl.uniform3fv(u.deep, hex(colors.deep));
  gl.uniform3fv(u.shallow, hex(colors.shallow));
  gl.uniform3fv(u.film, hex(colors.film));

  return {
    gl,
    resize(w, h) {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    },
    setColors(c) {
      gl.useProgram(pr);
      if (c.deep) gl.uniform3fv(u.deep, hex(c.deep));
      if (c.shallow) gl.uniform3fv(u.shallow, hex(c.shallow));
      if (c.film) gl.uniform3fv(u.film, hex(c.film));
    },
    draw(sim, texData, { rest, ar, t, intensity, idle }) {
      sim.encode(texData);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, 2, gl.RGBA, gl.UNSIGNED_BYTE, texData);

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform1f(u.ar, ar);
      gl.uniform1f(u.rest, rest);
      gl.uniform1f(u.slope, sim.slope);
      gl.uniform1f(u.t, t % 300);        // wrapped: mediump is real fp16 on mobile
      gl.uniform1f(u.int, intensity);
      gl.uniform1f(u.aer, sim.aerMax);
      gl.uniform1f(u.foam, sim.foamMax);
      gl.uniform1f(u.idle, idle);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy() {
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteProgram(pr);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
