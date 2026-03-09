import { useEffect, useRef } from "react";

/* ========= Fragment shader — LocalLink brand palette ========= */
const SHADER_SRC = `#version 300 es
precision highp float;

out vec4 fragColor;
in vec2 v_uv;

uniform vec3  iResolution;
uniform float iTime;
uniform int   iFrame;
uniform vec4  iMouse;

const float GRID_SCALE   = 18.0;
const float MAJOR_STEP   = 4.0;
const float THIN_WIDTH   = 0.010;
const float MAJOR_WIDTH  = 0.018;
const float SCROLL_SPEED = 0.02;

const float VIGNETTE_AMT = 0.28;
const float MESH_AMT     = 0.85;
const float NOISE_AMT    = 0.030;
const float DITHER_DARK  = 0.010;
const float DITHER_LIGHT = 0.004;

const float ASCII_AMT    = 0.23;
const float ASCII_SCALE  = 26.0;
const float ASCII_EVERY  = 2.0;

mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }

float bayer4(vec2 p){
  ivec2 ip = ivec2(int(mod(p.x,4.0)), int(mod(p.y,4.0)));
  int idx = ip.y*4 + ip.x;
  int m[16]; m[0]=0;m[1]=8;m[2]=2;m[3]=10;m[4]=12;m[5]=4;m[6]=14;m[7]=6;
  m[8]=3;m[9]=11;m[10]=1;m[11]=9;m[12]=15;m[13]=7;m[14]=13;m[15]=5;
  return float(m[idx]) / 15.0;
}

float hash21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  float a=hash21(i), b=hash21(i+vec2(1,0)), c=hash21(i+vec2(0,1)), d=hash21(i+vec2(1,1));
  vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}

float gridLineAA(vec2 uv, float scale, float width){
  vec2 g = abs(fract(uv*scale) - 0.5);
  float d = min(g.x, g.y);
  float aa = fwidth(d);
  return 1.0 - smoothstep(width, width + aa, d);
}
float majorGridAA(vec2 uv, float scale, float stepN, float width){
  float sMajor = max(1.0, scale/stepN);
  return gridLineAA(uv, sMajor, width);
}

// LocalLink brand mesh gradient
vec3 meshGradient(vec2 uv){
  vec2 p0=vec2(-0.70,-0.45), p1=vec2(0.75,-0.35), p2=vec2(-0.65,0.65), p3=vec2(0.80,0.55);
  vec3 c0=vec3(0.059, 0.165, 0.322);  // deep navy #0f2a52
  vec3 c1=vec3(0.122, 0.306, 0.549);  // royal blue #1F4E8C
  vec3 c2=vec3(0.086, 0.176, 0.314);  // abyss #162d50
  vec3 c3=vec3(0.165, 0.420, 0.722);  // lighter blue #2a6bb8
  float e=2.0;
  float w0=pow(1.0/(0.2+distance(uv,p0)),e);
  float w1=pow(1.0/(0.2+distance(uv,p1)),e);
  float w2=pow(1.0/(0.2+distance(uv,p2)),e);
  float w3=pow(1.0/(0.2+distance(uv,p3)),e);
  float ws=w0+w1+w2+w3;
  return (c0*w0+c1*w1+c2*w2+c3*w3)/ws;
}

float sdLineX(vec2 p, float w){ return 1.0 - smoothstep(w, w+fwidth(p.y), abs(p.y)); }
float sdLineY(vec2 p, float w){ return 1.0 - smoothstep(w, w+fwidth(p.x), abs(p.x)); }
float sdDiag1(vec2 p, float w){ float d=abs(p.x+p.y)/sqrt(2.0); return 1.0 - smoothstep(w, w+fwidth(d), d); }
float sdDiag2(vec2 p, float w){ float d=abs(p.x-p.y)/sqrt(2.0); return 1.0 - smoothstep(w, w+fwidth(d), d); }
float sdDot (vec2 p, float r){ float d=length(p); return 1.0 - smoothstep(r, r+fwidth(d), d); }

float asciiGlyph(vec2 cellUV, float level){
  vec2 p=cellUV; float w=0.11, r=0.10;
  float g0=sdDot(p,r), g1=sdLineX(p,w), g2=sdLineY(p,w),
        g3=max(sdLineX(p,w),sdLineY(p,w)),
        g4=sdDiag1(p,w), g5=sdDiag2(p,w),
        g6=max(sdDiag1(p,w),sdDiag2(p,w)),
        g7=max(sdLineX(p,w), max(sdLineY(p,w), g6));
  float m=0.;
  m=mix(m,g0, smoothstep(0.00,0.12,level)*(1.0-step(level,0.12)));
  m=mix(m,g1, smoothstep(0.12,0.28,level)*(1.0-step(level,0.28)));
  m=mix(m,g2, smoothstep(0.28,0.44,level)*(1.0-step(level,0.44)));
  m=mix(m,g3, smoothstep(0.44,0.60,level)*(1.0-step(level,0.60)));
  m=mix(m,g4, smoothstep(0.60,0.72,level)*(1.0-step(level,0.72)));
  m=mix(m,g5, smoothstep(0.72,0.84,level)*(1.0-step(level,0.84)));
  m=mix(m,g6, smoothstep(0.84,0.94,level)*(1.0-step(level,0.94)));
  m=mix(m,g7, smoothstep(0.94,1.00,level));
  return clamp(m,0.0,1.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
  vec2  R = iResolution.xy;
  float t = iTime;
  vec2 uv = (fragCoord - 0.5*R) / max(R.y, 1.0);

  // LocalLink deep navy base
  vec3 baseDeep = vec3(0.035, 0.07, 0.16);
  vec3 baseTint = vec3(0.055, 0.10, 0.22);
  float vgrad   = smoothstep(-0.92, 0.55, -uv.y);
  vec3  bg      = mix(baseDeep, baseTint, vgrad);
  bg            = mix(bg, meshGradient(uv), MESH_AMT);
  float rad     = length(uv);
  float vig     = pow(1.0 - VIGNETTE_AMT * rad, 1.0);
  bg           *= clamp(vig, 0.0, 1.0);

  vec2 scrollDir = normalize(vec2(1.0, -0.55));
  vec2 uvAnim    = uv + SCROLL_SPEED * t * scrollDir;

  float thin  = gridLineAA (uvAnim, GRID_SCALE, THIN_WIDTH);
  float major = majorGridAA(uvAnim, GRID_SCALE, MAJOR_STEP, MAJOR_WIDTH);

  // Gold-tinted grid lines (subtle warm accent)
  vec3 lineThin  = vec3(0.70, 0.58, 0.40);
  vec3 lineMajor = vec3(0.85, 0.72, 0.45);

  vec3 col = bg
           + lineThin  * thin  * 0.18
           + lineMajor * major * 0.38;

  vec2 uMajor = uvAnim * (GRID_SCALE / MAJOR_STEP);
  vec2 idx    = floor(uMajor + 0.5);
  float selX = 1.0 - step(0.001, abs(fract(idx.x / ASCII_EVERY)));
  float selY = 1.0 - step(0.001, abs(fract(idx.y / ASCII_EVERY)));
  float asciiLineSel = max(selX, selY);

  if (ASCII_AMT > 0.001) {
    vec2 aUV   = uv * ASCII_SCALE;
    vec2 cellF = fract(aUV) - 0.5;
    float lvl  = clamp(dot(col, vec3(0.2126,0.7152,0.0722)), 0.0, 1.0);
    float glyph = asciiGlyph(cellF, lvl);

    float nearMajor = major;
    float asciiMask = asciiLineSel * nearMajor;
    vec3 asciiColor = mix(vec3(0.50, 0.55, 0.80), meshGradient(uv), 0.25);

    col = mix(col, col + asciiColor * glyph * 0.30, ASCII_AMT * asciiMask);
  }

  float n = vnoise(fragCoord*0.6 + vec2(t*12.0, -t*9.0));
  col += (n - 0.5) * NOISE_AMT;

  float luma = dot(col, vec3(0.2126,0.7152,0.0722));
  float dAmt = mix(DITHER_DARK, DITHER_LIGHT, luma);
  col += (bayer4(fragCoord) - 0.5) * dAmt;

  col = tanh(col);
  fragColor = vec4(col, 1.0);
}

void main(){ mainImage(fragColor, gl_FragCoord.xy); }
`;

/* ========= Vertex shader: fullscreen triangle ========= */
const VERT_SRC = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main(){
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

/* ========= Shader compilation helpers ========= */
function safeCompile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  const ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS);
  const log = gl.getShaderInfoLog(sh) || "";
  return { shader: ok ? sh : null, log };
}

function safeLink(gl, vs, fs) {
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  const ok = gl.getProgramParameter(prog, gl.LINK_STATUS);
  const log = gl.getProgramInfoLog(prog) || "";
  return { program: ok ? prog : null, log };
}

/* ========= ShaderCanvas component ========= */
export function ShaderCanvas({ className, style }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const startRef = useRef(0);
  const frameRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0, l: 0, r: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", {
      premultipliedAlpha: false,
      antialias: false,
      alpha: false,
    });
    if (!gl) return;

    // Check reduced motion preference
    const prefersReducedMotion =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let disposed = false;
    let vao = null;
    let vbo = null;
    let program = null;
    let ro = null;
    let resizeScheduled = false;

    const getDpr = () => Math.max(1, Math.min(2, window.devicePixelRatio || 1));

    function applySize() {
      resizeScheduled = false;
      if (disposed) return;
      const dpr = getDpr();
      const cssW = Math.max(1, canvas.clientWidth | 0);
      const cssH = Math.max(1, canvas.clientHeight | 0);
      const w = Math.max(1, Math.floor(cssW * dpr));
      const h = Math.max(1, Math.floor(cssH * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    }

    function scheduleSize() {
      if (resizeScheduled) return;
      resizeScheduled = true;
      requestAnimationFrame(applySize);
    }

    // Geometry — fullscreen triangle
    vao = gl.createVertexArray();
    vbo = gl.createBuffer();
    if (!vao || !vbo) return cleanup;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Compile shaders
    const { shader: vs, log: vsLog } = safeCompile(gl, gl.VERTEX_SHADER, VERT_SRC);
    if (!vs) { console.error("Vertex compile error:", vsLog); return cleanup; }
    const { shader: fs, log: fsLog } = safeCompile(gl, gl.FRAGMENT_SHADER, SHADER_SRC);
    if (!fs) { console.error("Fragment compile error:", fsLog); gl.deleteShader(vs); return cleanup; }
    const linked = safeLink(gl, vs, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!linked.program) { console.error("Link error:", linked.log); return cleanup; }
    program = linked.program;

    // Uniforms
    const uResolution = gl.getUniformLocation(program, "iResolution");
    const uTime = gl.getUniformLocation(program, "iTime");
    const uFrame = gl.getUniformLocation(program, "iFrame");
    const uMouse = gl.getUniformLocation(program, "iMouse");

    // Resize observer
    ro = new ResizeObserver(scheduleSize);
    ro.observe(canvas);
    scheduleSize();

    // Context loss handlers
    const onContextLost = (ev) => {
      ev.preventDefault();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    const onContextRestored = () => {
      scheduleSize();
      startRef.current = performance.now();
      frameRef.current = 0;
      if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
    };
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);

    // Animation loop
    startRef.current = performance.now();
    frameRef.current = 0;

    function tick(now) {
      if (disposed) return;
      if (gl.isContextLost()) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const t = prefersReducedMotion ? 0 : (now - startRef.current) / 1000;
      frameRef.current += 1;

      try {
        gl.useProgram(program);
        if (resizeScheduled) applySize();

        const dpr = getDpr();
        const w = canvas.width;
        const h = canvas.height;

        if (uResolution) gl.uniform3f(uResolution, w, h, dpr);
        if (uTime) gl.uniform1f(uTime, t);
        if (uFrame) gl.uniform1i(uFrame, frameRef.current);
        if (uMouse) {
          const m = mouseRef.current;
          gl.uniform4f(uMouse, m.x * dpr, m.y * dpr, m.l, m.r);
        }

        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      } catch (err) {
        console.error("ShaderCanvas render error:", err);
      }

      // For reduced motion, render just one frame then stop
      if (prefersReducedMotion) return;
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    function cleanup() {
      disposed = true;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      if (ro) { try { ro.disconnect(); } catch {} ro = null; }
      try { if (vbo) gl.deleteBuffer(vbo); } catch {}
      try { if (vao) gl.deleteVertexArray(vao); } catch {}
      try { if (program) gl.deleteProgram(program); } catch {}
    }

    return cleanup;
  }, []);

  return (
    <div className={className} style={style} aria-hidden="true">
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
