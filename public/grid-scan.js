
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ChromaticAberrationEffect } from 'postprocessing';

// --- SHADERS ---
const vert = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const frag = `
precision highp float;
uniform vec3 iResolution;
uniform float iTime;
uniform vec2 uSkew;
uniform float uTilt;
uniform float uYaw;
uniform float uLineThickness;
uniform vec3 uLinesColor;
uniform vec3 uScanColor;
uniform float uGridScale;
uniform float uLineStyle;
uniform float uLineJitter;
uniform float uScanOpacity;
uniform float uScanDirection;
uniform float uNoise;
uniform float uBloomOpacity;
uniform float uScanGlow;
uniform float uScanSoftness;
uniform float uPhaseTaper;
uniform float uScanDuration;
uniform float uScanDelay;
varying vec2 vUv;

uniform float uScanStarts[8];
uniform float uScanCount;

const int MAX_SCANS = 8;

float smoother01(float a, float b, float x){
  float t = clamp((x - a) / max(1e-5, (b - a)), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;

    vec3 ro = vec3(0.0);
    vec3 rd = normalize(vec3(p, 2.0));

    float cR = cos(uTilt), sR = sin(uTilt);
    rd.xy = mat2(cR, -sR, sR, cR) * rd.xy;

    float cY = cos(uYaw), sY = sin(uYaw);
    rd.xz = mat2(cY, -sY, sY, cY) * rd.xz;

    vec2 skew = clamp(uSkew, vec2(-0.7), vec2(0.7));
    rd.xy += skew * rd.z;

    vec3 color = vec3(0.0);
    float minT = 1e20;
    float gridScale = max(1e-5, uGridScale);
    float fadeStrength = 2.0;
    vec2 gridUV = vec2(0.0);

    float hitIsY = 1.0;
    for (int i = 0; i < 4; i++)
    {
        float isY = float(i < 2);
        float pos = mix(-0.2, 0.2, float(i)) * isY + mix(-0.5, 0.5, float(i - 2)) * (1.0 - isY);
        float num = pos - (isY * ro.y + (1.0 - isY) * ro.x);
        float den = isY * rd.y + (1.0 - isY) * rd.x;
        float t = num / den;
        vec3 h = ro + rd * t;

        float depthBoost = smoothstep(0.0, 3.0, h.z);
        h.xy += skew * 0.15 * depthBoost;

        bool use = t > 0.0 && t < minT;
        gridUV = use ? mix(h.zy, h.xz, isY) / gridScale : gridUV;
        minT = use ? t : minT;
        hitIsY = use ? isY : hitIsY;
    }

    vec3 hit = ro + rd * minT;
    float dist = length(hit - ro);

    float jitterAmt = clamp(uLineJitter, 0.0, 1.0);
    if (jitterAmt > 0.0) {
        vec2 j = vec2(
        sin(gridUV.y * 2.7 + iTime * 1.8),
        cos(gridUV.x * 2.3 - iTime * 1.6)
        ) * (0.15 * jitterAmt);
        gridUV += j;
    }
    float fx = fract(gridUV.x);
    float fy = fract(gridUV.y);
    float ax = min(fx, 1.0 - fx);
    float ay = min(fy, 1.0 - fy);
    float wx = fwidth(gridUV.x);
    float wy = fwidth(gridUV.y);
    float halfPx = max(0.0, uLineThickness) * 0.5;

    float tx = halfPx * wx;
    float ty = halfPx * wy;

    float aax = wx;
    float aay = wy;

    float lineX = 1.0 - smoothstep(tx, tx + aax, ax);
    float lineY = 1.0 - smoothstep(ty, ty + aay, ay);
    if (uLineStyle > 0.5) {
        float dashRepeat = 4.0;
        float dashDuty = 0.5;
        float vy = fract(gridUV.y * dashRepeat);
        float vx = fract(gridUV.x * dashRepeat);
        float dashMaskY = step(vy, dashDuty);
        float dashMaskX = step(vx, dashDuty);
        if (uLineStyle < 1.5) {
        lineX *= dashMaskY;
        lineY *= dashMaskX;
        } else {
        float dotRepeat = 6.0;
        float dotWidth = 0.18;
        float cy = abs(fract(gridUV.y * dotRepeat) - 0.5);
        float cx = abs(fract(gridUV.x * dotRepeat) - 0.5);
        float dotMaskY = 1.0 - smoothstep(dotWidth, dotWidth + fwidth(gridUV.y * dotRepeat), cy);
        float dotMaskX = 1.0 - smoothstep(dotWidth, dotWidth + fwidth(gridUV.x * dotRepeat), cx);
        lineX *= dotMaskY;
        lineY *= dotMaskX;
        }
    }
    float primaryMask = max(lineX, lineY);

    vec2 gridUV2 = (hitIsY > 0.5 ? hit.xz : hit.zy) / gridScale;
    if (jitterAmt > 0.0) {
        vec2 j2 = vec2(
        cos(gridUV2.y * 2.1 - iTime * 1.4),
        sin(gridUV2.x * 2.5 + iTime * 1.7)
        ) * (0.15 * jitterAmt);
        gridUV2 += j2;
    }
    float fx2 = fract(gridUV2.x);
    float fy2 = fract(gridUV2.y);
    float ax2 = min(fx2, 1.0 - fx2);
    float ay2 = min(fy2, 1.0 - fy2);
    float wx2 = fwidth(gridUV2.x);
    float wy2 = fwidth(gridUV2.y);
    float tx2 = halfPx * wx2;
    float ty2 = halfPx * wy2;
    float aax2 = wx2;
    float aay2 = wy2;
    float lineX2 = 1.0 - smoothstep(tx2, tx2 + aax2, ax2);
    float lineY2 = 1.0 - smoothstep(ty2, ty2 + aay2, ay2);
    if (uLineStyle > 0.5) {
        float dashRepeat2 = 4.0;
        float dashDuty2 = 0.5;
        float vy2m = fract(gridUV2.y * dashRepeat2);
        float vx2m = fract(gridUV2.x * dashRepeat2);
        float dashMaskY2 = step(vy2m, dashDuty2);
        float dashMaskX2 = step(vx2m, dashDuty2);
        if (uLineStyle < 1.5) {
        lineX2 *= dashMaskY2;
        lineY2 *= dashMaskX2;
        } else {
        float dotRepeat2 = 6.0;
        float dotWidth2 = 0.18;
        float cy2 = abs(fract(gridUV2.y * dotRepeat2) - 0.5);
        float cx2 = abs(fract(gridUV2.x * dotRepeat2) - 0.5);
        float dotMaskY2 = 1.0 - smoothstep(dotWidth2, dotWidth2 + fwidth(gridUV2.y * dotRepeat2), cy2);
        float dotMaskX2 = 1.0 - smoothstep(dotWidth2, dotWidth2 + fwidth(gridUV2.x * dotRepeat2), cx2);
        lineX2 *= dotMaskY2;
        lineY2 *= dotMaskX2;
        }
    }
    float altMask = max(lineX2, lineY2);

    float edgeDistX = min(abs(hit.x - (-0.5)), abs(hit.x - 0.5));
    float edgeDistY = min(abs(hit.y - (-0.2)), abs(hit.y - 0.2));
    float edgeDist = mix(edgeDistY, edgeDistX, hitIsY);
    float edgeGate = 1.0 - smoothstep(gridScale * 0.5, gridScale * 2.0, edgeDist);
    altMask *= edgeGate;

    float lineMask = max(primaryMask, altMask);

    float fade = exp(-dist * fadeStrength);

    float dur = max(0.05, uScanDuration);
    float del = max(0.0, uScanDelay);
    float scanZMax = 2.0;
    float widthScale = max(0.1, uScanGlow);
    float sigma = max(0.001, 0.18 * widthScale * uScanSoftness);
    float sigmaA = sigma * 2.0;

    float combinedPulse = 0.0;
    float combinedAura = 0.0;

    // relying solely on the uScanStarts loop below.
    
    // Restore required variables for the loop:
    float taper = clamp(uPhaseTaper, 0.0, 0.49);
    float headW = taper;
    float tailW = taper;

    for (int i = 0; i < MAX_SCANS; i++) {
        if (float(i) >= uScanCount) break;
        float tActiveI = iTime - uScanStarts[i];
        float phaseI = clamp(tActiveI / dur, 0.0, 1.0);
        if (uScanDirection > 0.5 && uScanDirection < 1.5) {
        phaseI = 1.0 - phaseI;
        } else if (uScanDirection > 1.5) {
        phaseI = (phaseI < 0.5) ? (phaseI * 2.0) : (1.0 - (phaseI - 0.5) * 2.0);
        }
        float scanZI = phaseI * scanZMax;
        float dzI = abs(hit.z - scanZI);
        float lineBandI = exp(-0.5 * (dzI * dzI) / (sigma * sigma));
        float headFadeI = smoother01(0.0, headW, phaseI);
        float tailFadeI = 1.0 - smoother01(1.0 - tailW, 1.0, phaseI);
        float phaseWindowI = headFadeI * tailFadeI;
        combinedPulse += lineBandI * phaseWindowI * clamp(uScanOpacity, 0.0, 1.0);
        float auraBandI = exp(-0.5 * (dzI * dzI) / (sigmaA * sigmaA));
        combinedAura += (auraBandI * 0.25) * phaseWindowI * clamp(uScanOpacity, 0.0, 1.0);
    }

    float lineVis = lineMask;
    vec3 gridCol = uLinesColor * lineVis * fade;
    vec3 scanCol = uScanColor * combinedPulse;
    vec3 scanAura = uScanColor * combinedAura;

    color = gridCol + scanCol + scanAura;

    float n = fract(sin(dot(gl_FragCoord.xy + vec2(iTime * 123.4), vec2(12.9898,78.233))) * 43758.5453123);
    color += (n - 0.5) * uNoise;
    color = clamp(color, 0.0, 1.0);
    float alpha = clamp(max(lineVis, combinedPulse), 0.0, 1.0);
    float gx = 1.0 - smoothstep(tx * 2.0, tx * 2.0 + aax * 2.0, ax);
    float gy = 1.0 - smoothstep(ty * 2.0, ty * 2.0 + aay * 2.0, ay);
    float halo = max(gx, gy) * fade;
    alpha = max(alpha, halo * clamp(uBloomOpacity, 0.0, 1.0));
    fragColor = vec4(color, alpha);
}

void main(){
  vec4 c;
  mainImage(c, vUv * iResolution.xy);
  gl_FragColor = c;
}
`;

function srgbColor(hex) {
    const c = new THREE.Color(hex);
    return c.convertSRGBToLinear();
}

function smoothDampVec2(current, target, currentVelocity, smoothTime, maxSpeed, deltaTime) {
    const out = current.clone();
    smoothTime = Math.max(0.0001, smoothTime);
    const omega = 2 / smoothTime;
    const x = omega * deltaTime;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

    let change = current.clone().sub(target);
    const originalTo = target.clone();

    const maxChange = maxSpeed * smoothTime;
    if (change.length() > maxChange) change.setLength(maxChange);

    target = current.clone().sub(change);
    const temp = currentVelocity.clone().addScaledVector(change, omega).multiplyScalar(deltaTime);
    currentVelocity.sub(temp.clone().multiplyScalar(omega));
    currentVelocity.multiplyScalar(exp);

    out.copy(target.clone().add(change.add(temp).multiplyScalar(exp)));

    const origMinusCurrent = originalTo.clone().sub(current);
    const outMinusOrig = out.clone().sub(originalTo);
    if (origMinusCurrent.dot(outMinusOrig) > 0) {
        out.copy(originalTo);
        currentVelocity.set(0, 0);
    }
    return out;
}

function smoothDampFloat(current, target, velRef, smoothTime, maxSpeed, deltaTime) {
    smoothTime = Math.max(0.0001, smoothTime);
    const omega = 2 / smoothTime;
    const x = omega * deltaTime;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

    let change = current - target;
    const originalTo = target;

    const maxChange = maxSpeed * smoothTime;
    change = Math.sign(change) * Math.min(Math.abs(change), maxChange);

    target = current - change;
    const temp = (velRef.v + omega * change) * deltaTime;
    velRef.v = (velRef.v - omega * temp) * exp;

    let out = target + (change + temp) * exp;

    const origMinusCurrent = originalTo - current;
    const outMinusOrig = out - originalTo;
    if (origMinusCurrent * outMinusOrig > 0) {
        out = originalTo;
        velRef.v = 0;
    }
    return { value: out, v: velRef.v };
}

// --- INIT LOGIC ---
export function initGridScan(container) {
    // Config
    const sensitivity = 0.55;
    const lineThickness = 1.2;
    const linesColor = '#392e4e';
    const scanColor = '#00fff2'; // More Cyan/Blue as per request
    const scanOpacity = 0.5;
    const gridScale = 0.1;
    const lineStyle = 'solid'; // solid, dashed, dotted
    const lineJitter = 0.15;
    const scanDirection = 'pingpong';
    const bloomIntensity = 1.5;
    const bloomThreshold = 0.1;
    const bloomSmoothing = 0.5;
    const chromaticAberration = 0.005;
    const noiseIntensity = 0.05;
    const scanGlow = 1.5;
    const scanSoftness = 1.5;

    // State
    const lookTarget = new THREE.Vector2(0, 0);
    const tiltTarget = { value: 0 };
    const yawTarget = { value: 0 };

    const lookCurrent = new THREE.Vector2(0, 0);
    const lookVel = new THREE.Vector2(0, 0);
    const tiltCurrent = { value: 0 };
    const tiltVel = { v: 0 };
    const yawCurrent = { value: 0 };
    const yawVel = { v: 0 };

    // Derived
    const s = THREE.MathUtils.clamp(sensitivity, 0, 1);
    const skewScale = THREE.MathUtils.lerp(0.06, 0.2, s);
    const tiltScale = THREE.MathUtils.lerp(0.12, 0.3, s);
    const yawScale = THREE.MathUtils.lerp(0.1, 0.28, s);
    const yBoost = THREE.MathUtils.lerp(1.2, 1.6, s);
    const smoothTime = THREE.MathUtils.lerp(0.45, 0.12, s);
    const maxSpeed = Infinity;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    // Uniforms
    const uniforms = {
        iResolution: { value: new THREE.Vector3(container.clientWidth, container.clientHeight, renderer.getPixelRatio()) },
        iTime: { value: 0 },
        uSkew: { value: new THREE.Vector2(0, 0) },
        uTilt: { value: 0 },
        uYaw: { value: 0 },
        uLineThickness: { value: lineThickness },
        uLinesColor: { value: srgbColor(linesColor) },
        uScanColor: { value: srgbColor(scanColor) },
        uGridScale: { value: gridScale },
        uLineStyle: { value: 0 },
        uLineJitter: { value: lineJitter },
        uScanOpacity: { value: scanOpacity },
        uNoise: { value: noiseIntensity },
        uBloomOpacity: { value: bloomIntensity },
        uScanGlow: { value: scanGlow },
        uScanSoftness: { value: 1.0 },
        uPhaseTaper: { value: 0.9 },
        uScanDuration: { value: 4.0 }, // SLOWER (was 1.5)
        uScanDelay: { value: 0.0 },
        uScanDirection: { value: 2 },
        // Allow multiple scans in buffer for the loop effect
        uScanStarts: { value: new Array(8).fill(-100) },
        uScanCount: { value: 8 }
    };

    const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        depthTest: false
    });

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    // Post Processing
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloom = new BloomEffect({
        intensity: 1.0,
        luminanceThreshold: bloomThreshold,
        luminanceSmoothing: bloomSmoothing
    });
    bloom.blendMode.opacity.value = bloomIntensity;

    const chroma = new ChromaticAberrationEffect({
        offset: new THREE.Vector2(chromaticAberration, chromaticAberration),
        radialModulation: true
    });

    const effectPass = new EffectPass(camera, bloom, chroma);
    effectPass.renderToScreen = true;
    composer.addPass(effectPass);

    // Resize
    window.addEventListener('resize', () => {
        renderer.setSize(container.clientWidth, container.clientHeight);
        composer.setSize(container.clientWidth, container.clientHeight);
        uniforms.iResolution.value.set(container.clientWidth, container.clientHeight, renderer.getPixelRatio());
    });

    // Mouse Interaction REMOVED as per request
    // window.addEventListener('mousemove', (e) => { ... });


    // Loop
    let last = performance.now();

    function tick() {
        requestAnimationFrame(tick);
        const now = performance.now();
        const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
        last = now;

        // Create a subtle automatic sway (breathing effect)
        const time = now / 1000;
        lookTarget.set(Math.sin(time * 0.2) * 0.1, Math.cos(time * 0.15) * 0.1);

        // Smooth Damp
        lookCurrent.copy(smoothDampVec2(lookCurrent, lookTarget, lookVel, smoothTime, maxSpeed, dt));
        // Simple tilt/yaw
        const tSm = smoothDampFloat(tiltCurrent.value, tiltTarget.value, tiltVel, smoothTime, maxSpeed, dt);
        tiltCurrent.value = tSm.value;
        tiltVel.v = tSm.v;

        // Skew calc
        const skewX = lookCurrent.x * skewScale;
        const skewY = -lookCurrent.y * yBoost * skewScale;

        uniforms.uSkew.value.set(skewX, skewY);
        // Map swaying to Tilt for a subtle effect
        uniforms.uTilt.value = lookCurrent.y * 0.2;
        uniforms.uYaw.value = lookCurrent.x * 0.2;

        uniforms.iTime.value = now / 1000;

        composer.render(dt);
    }
    tick();

    // AUTO LOOP LOGIC (Forward <-> Backward)
    let loopState = 0; // 0 = forward, 1 = backward

    setInterval(() => {
        const now = performance.now() / 1000;
        const arr = uniforms.uScanStarts.value;

        // STRICT SINGLE SCAN LOGIC
        // 1. Wipe everything to -1000 (invisible)
        arr.fill(-1000);
        // 2. Set ONLY the first slot to current time
        arr[0] = now;

        // 3. Force Count to 1 (Shader only loops once)
        uniforms.uScanCount.value = 1;

        // Alternating Directions
        if (loopState === 0) {
            // Forward
            uniforms.uScanDirection.value = 0.0;
            loopState = 1;
        } else {
            // Backward
            uniforms.uScanDirection.value = 1.0;
            loopState = 0;
        }

    }, 5000); // Trigger every 5 seconds (Duration is 4s, so 1s gap)

    // Initial Trigger 
    setTimeout(() => {
        const arr = uniforms.uScanStarts.value; // Valid ref
        arr.fill(-1000);
        arr[0] = performance.now() / 1000;
        uniforms.uScanCount.value = 1;
    }, 100);

    // Keep manual trigger for compatibility but do nothing or overwrite
    container.triggerScan = (direction = 'forward') => {
        // Disabled to prevent conflicts with loop
    };
}
