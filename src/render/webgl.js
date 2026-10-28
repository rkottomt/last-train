// WebGL2 3D world renderer: a soft-shaded "toy diorama" of the station.
// Implements the renderer interface documented at the top of src/render/canvas2d.js
// (init / render / isLost) and reads only the `view` object; it never changes game
// state. WebGL2 (not WebGPU) because it's on by default in every current browser,
// including Brave. If anything is unsupported, init() resolves false silently and
// main.js uses Canvas 2D instead.
//
// How it draws: every object is an instance of one of three unit meshes (a cube, a
// cube that hangs down from its top face for limbs, and a sphere). Each frame we
// rebuild one instance list per mesh (transform + color + material params) and
// draw each mesh with a single instanced call. Soft contact shadows and the light
// pools in front of open doors are instanced quads drawn with blending afterwards.
//
// World units are meters. Layout pixels (what game logic uses) map to the world
// through layoutToWorldX/Z below: 56.25 px per meter puts the four door centers at
// x = -6, -2, 2, 6 m, the platform edge at z = 0, and z grows toward the camera.

const GL_TUNING = {
  pixelsPerMeter: 56.25, // (door spacing 225 px) / (4 m between real subway doors)
  maxPixelRatio: 2, // sharper than 2x costs fill rate for no visible gain
  maxInstancesPerMesh: 3000,
  maxBlobs: 256,
  // Camera: about 34 degrees pitched down at the platform, so all four doors and the
  // whole platform are readable and the top of the screen (under the HTML HUD) is
  // only the back wall.
  cameraFovDegrees: 34,
  cameraPitchDegrees: 33,
  cameraDistance: 17.5,
  cameraTarget: [0, 1.1, 2.3],
  exposure: 0.92,
  doorOpenSmoothing: 16, // per second; logic opens instantly, the leaves glide
  turnSmoothing: 10, // per second; how fast passengers swing round to face their way
};

// Palette in sRGB hex (converted to linear once, below). Muted station, saturated
// passengers, so the crowd always reads against the background.
const GL_PALETTE_HEX = {
  wallTile: '#E8E2D0',
  trimBand: '#2F6B66',
  concrete: '#8B8984',
  tactileStrip: '#D4AE3B',
  bullnose: '#D8D1BF',
  trackPit: '#17140F',
  rail: '#55585c',
  fluorescent: '#F2FFF9',
  trainSteel: '#C3C9CF',
  trainRoof: '#8E959D',
  trainSkirt: '#3A3F45',
  trainStripe: '#6B4FA0',
  trainWindow: '#FFE3A3',
  doorPanel: '#AEB5BC',
  doorway: '#2A2116',
  numberPlate: '#0E0F12',
  numberPixel: '#FFFFFF',
  doorLightOpen: '#3DDC84',
  doorLightClosing: '#FFB020',
  doorLightClosed: '#FF3B30',
  doorLightHeld: '#FF8C1A',
  stairStep: '#6F6D69',
  stairWall: '#CFC8B6',
  handrail: '#9AA3AD',
  skin: '#F1C9A5',
  faceInk: '#1B1B1F',
  hair: '#3B2A20',
  legs: '#2E3440',
  box: '#CDA066',
  phoneScreen: '#9FE8FF',
  sparkle: '#FFF4C2',
};

// Passenger body colors by type key; anything unlisted falls back to its spec color.
const GL_PASSENGER_COLORS = {
  commuter: '#5F6B78',
  sprinter: '#E8413C',
  luggage: '#9C6234',
  phoneGuy: '#2F7FE6',
  doorBlocker: '#FF8C1A',
  vip: '#FFD040',
};

// 3x5 pixel font for the door numbers, built from little glowing cubes.
const GL_DIGIT_PIXELS = {
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
};

// Material ids understood by the fragment shader (params.y).
const GL_MATERIAL = { plain: 0, wallTile: 1, concrete: 2, tactile: 3 };

function hexToLinear(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => Math.pow(channel / 255, 2.2));
}

const GL_COLORS = Object.fromEntries(Object.entries(GL_PALETTE_HEX).map(([key, hex]) => [key, hexToLinear(hex)]));

// ---- Small column-major 4x4 matrix helpers (no allocation in the hot path) ----

const GLMath = {
  create() {
    const matrix = new Float32Array(16);
    matrix[0] = matrix[5] = matrix[10] = matrix[15] = 1;
    return matrix;
  },

  // out = T(x,y,z) * Ry(yaw) * Rx(pitch) * Rz(roll) * S(scaleX, scaleY, scaleZ)
  compose(out, x, y, z, yaw, pitch, roll, scaleX, scaleY, scaleZ) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cx = Math.cos(pitch), sx = Math.sin(pitch);
    const cz = Math.cos(roll), sz = Math.sin(roll);
    out[0] = (cy * cz + sy * sx * sz) * scaleX;
    out[1] = cx * sz * scaleX;
    out[2] = (-sy * cz + cy * sx * sz) * scaleX;
    out[3] = 0;
    out[4] = (-cy * sz + sy * sx * cz) * scaleY;
    out[5] = cx * cz * scaleY;
    out[6] = (sy * sz + cy * sx * cz) * scaleY;
    out[7] = 0;
    out[8] = sy * cx * scaleZ;
    out[9] = -sx * scaleZ;
    out[10] = cy * cx * scaleZ;
    out[11] = 0;
    out[12] = x;
    out[13] = y;
    out[14] = z;
    out[15] = 1;
    return out;
  },

  // out = a * b. `out` must not be `a` or `b`.
  multiply(out, a, b) {
    for (let column = 0; column < 4; column++) {
      const b0 = b[column * 4], b1 = b[column * 4 + 1], b2 = b[column * 4 + 2], b3 = b[column * 4 + 3];
      out[column * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
      out[column * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
      out[column * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      out[column * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return out;
  },

  // OpenGL-style perspective (clip depth -1..1).
  perspective(out, fovY, aspect, near, far) {
    const focal = 1 / Math.tan(fovY / 2);
    out.fill(0);
    out[0] = focal / aspect;
    out[5] = focal;
    out[10] = (far + near) / (near - far);
    out[11] = -1;
    out[14] = (2 * far * near) / (near - far);
    return out;
  },

  lookAt(out, eye, target) {
    let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    const zLength = Math.hypot(zx, zy, zz);
    zx /= zLength; zy /= zLength; zz /= zLength;
    // x = normalize(cross(up=(0,1,0), z))
    let xx = zz, xy = 0, xz = -zx;
    const xLength = Math.hypot(xx, xy, xz);
    xx /= xLength; xz /= xLength;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
    out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    out[15] = 1;
    return out;
  },
};

// ---- Shaders ----

const GL_SHADERS = {
  meshVertex: `#version 300 es
    layout(location = 0) in vec3 aPosition;
    layout(location = 1) in vec3 aNormal;
    layout(location = 2) in vec4 aModel0;
    layout(location = 3) in vec4 aModel1;
    layout(location = 4) in vec4 aModel2;
    layout(location = 5) in vec4 aModel3;
    layout(location = 6) in vec4 aColor;   // linear rgb, unused
    layout(location = 7) in vec4 aParams;  // emissive, material, rim, ambient occlusion
    uniform mat4 uViewProjection;
    out vec3 vWorldPosition;
    out vec3 vNormal;
    out vec3 vColor;
    out vec4 vParams;
    void main() {
      mat4 model = mat4(aModel0, aModel1, aModel2, aModel3);
      vec4 worldPosition = model * vec4(aPosition, 1.0);
      // Divide by squared axis scales so normals stay correct on squashed shapes.
      vec3 squaredScale = vec3(dot(aModel0.xyz, aModel0.xyz), dot(aModel1.xyz, aModel1.xyz), dot(aModel2.xyz, aModel2.xyz));
      vNormal = normalize(mat3(model) * (aNormal / max(squaredScale, vec3(1e-6))));
      vWorldPosition = worldPosition.xyz;
      vColor = aColor.rgb;
      vParams = aParams;
      gl_Position = uViewProjection * worldPosition;
    }`,

  meshFragment: `#version 300 es
    precision highp float;
    in vec3 vWorldPosition;
    in vec3 vNormal;
    in vec3 vColor;
    in vec4 vParams;
    uniform vec3 uCameraPosition;
    uniform vec2 uResolution;
    uniform float uExposure;
    out vec4 outColor;

    const vec3 SKY_LIGHT = vec3(0.72, 0.79, 0.82);
    const vec3 GROUND_LIGHT = vec3(0.11, 0.085, 0.06);
    const vec3 KEY_LIGHT = vec3(1.0, 0.87, 0.70) * 1.9;
    const vec3 KEY_DIRECTION = vec3(-0.37, 0.74, 0.56); // up-left, toward the camera
    const vec3 RIM_LIGHT = vec3(0.62, 0.80, 1.0);
    const vec3 TUNNEL_DARK = vec3(0.006, 0.007, 0.009);

    // Narkowicz's ACES fit: filmic highlight roll-off for emissives and bright floor.
    vec3 aces(vec3 x) {
      return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    }

    void main() {
      vec3 base = vColor;
      float material = vParams.y;
      if (material > 0.5 && material < 1.5) {
        // Running-bond wall tiles with darker grout.
        vec2 tile = vec2(vWorldPosition.x / 0.30, vWorldPosition.y / 0.15);
        tile.x += 0.5 * mod(floor(tile.y), 2.0);
        vec2 inTile = fract(tile);
        float grout = max(step(inTile.x, 0.035), step(inTile.y, 0.07));
        base = mix(base, base * 0.62, grout);
      } else if (material > 1.5 && material < 2.5) {
        // Big concrete slabs with thin seams.
        vec2 slab = fract(vWorldPosition.xz / 1.6);
        float seam = max(step(slab.x, 0.012), step(slab.y, 0.012));
        base *= 1.0 - 0.2 * seam;
      } else if (material > 2.5) {
        // Raised tactile dots on the yellow edge strip.
        vec2 cell = fract(vWorldPosition.xz / 0.12) - 0.5;
        base *= 0.82 + 0.3 * step(length(cell), 0.27);
      }

      vec3 normal = normalize(vNormal);
      // Hemisphere ambient + wrap-around key light: soft, toy-like shading.
      vec3 ambient = mix(GROUND_LIGHT, SKY_LIGHT, normal.y * 0.5 + 0.5) * 0.55;
      float wrapKey = max(0.0, (dot(normal, normalize(KEY_DIRECTION)) + 0.3) / 1.3);
      float occlusion = mix(1.0, mix(0.55, 1.0, smoothstep(-0.3, 1.0, vWorldPosition.y)), vParams.w);
      vec3 viewDirection = normalize(uCameraPosition - vWorldPosition);
      float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.0) * vParams.z;

      vec3 lit = base * (ambient + KEY_LIGHT * wrapKey) * occlusion + RIM_LIGHT * rim + base * vParams.x;
      // The tunnel mouths fade to black, so the train glides in from and out into darkness.
      lit = mix(lit, TUNNEL_DARK, smoothstep(10.0, 14.0, abs(vWorldPosition.x)));

      vec3 color = aces(lit * uExposure);
      vec2 screenUv = gl_FragCoord.xy / uResolution;
      color *= mix(1.0, 0.74, smoothstep(0.35, 0.95, length(screenUv - 0.5) * 1.414));
      outColor = vec4(pow(color, vec3(1.0 / 2.2)), 1.0);
    }`,

  blobVertex: `#version 300 es
    layout(location = 0) in vec2 aCorner;
    layout(location = 1) in vec4 aBlob;   // x, y, z, radius
    layout(location = 2) in vec4 aColor;  // display-space rgb, alpha
    uniform mat4 uViewProjection;
    out vec2 vCorner;
    out vec4 vColor;
    void main() {
      vCorner = aCorner;
      vColor = aColor;
      vec3 position = vec3(aBlob.x + aCorner.x * aBlob.w, aBlob.y, aBlob.z + aCorner.y * aBlob.w);
      gl_Position = uViewProjection * vec4(position, 1.0);
    }`,

  blobFragment: `#version 300 es
    precision highp float;
    in vec2 vCorner;
    in vec4 vColor;
    out vec4 outColor;
    void main() {
      float falloff = pow(1.0 - smoothstep(0.15, 1.0, length(vCorner)), 1.5);
      outColor = vec4(vColor.rgb, vColor.a * falloff);
    }`,
};

// ---- Meshes ----

function buildCubeMesh(yOffset) {
  // 6 faces x 4 corners, each with its own flat normal.
  const faces = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
    [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  const vertices = [];
  const indices = [];
  for (const [normal, up, side] of faces) {
    const start = vertices.length / 6;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      vertices.push(
        0.5 * (normal[0] + up[0] * v + side[0] * u),
        0.5 * (normal[1] + up[1] * v + side[1] * u) + yOffset,
        0.5 * (normal[2] + up[2] * v + side[2] * u),
        normal[0], normal[1], normal[2],
      );
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
}

function buildSphereMesh(rings, segments) {
  const vertices = [];
  const indices = [];
  for (let ring = 0; ring <= rings; ring++) {
    const theta = (ring / rings) * Math.PI;
    for (let segment = 0; segment <= segments; segment++) {
      const phi = (segment / segments) * Math.PI * 2;
      const x = Math.sin(theta) * Math.cos(phi);
      const y = Math.cos(theta);
      const z = Math.sin(theta) * Math.sin(phi);
      vertices.push(x, y, z, x, y, z);
    }
  }
  for (let ring = 0; ring < rings; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const a = ring * (segments + 1) + segment;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
}

// ---- The renderer ----

const FLOATS_PER_INSTANCE = 24; // mat4 (16) + color (4) + params (4)
const FLOATS_PER_BLOB = 8; // x, y, z, radius + rgba

function layoutToWorldX(layoutX) {
  return (layoutX - CONFIG.canvasWidth / 2) / GL_TUNING.pixelsPerMeter;
}

function layoutToWorldZ(layoutY) {
  return (layoutY - CONFIG.layout.platformTop) / GL_TUNING.pixelsPerMeter;
}

const WebGLRenderer = {
  name: 'WebGL',
  gl: null,
  canvas: null,
  contextLost: false,
  batches: null, // { cube, limb, sphere }: per-mesh instance lists
  shadowBlobs: null,
  glowBlobs: null,
  passengerPoses: new WeakMap(), // per-passenger smoothed facing direction
  doorVisualOpen: [0, 0, 0, 0], // smoothed leaf positions
  previousTimeSeconds: null,
  // Scratch matrices, reused every frame so rendering never allocates.
  scratch: { root: GLMath.create(), local: GLMath.create(), head: GLMath.create(), world: GLMath.create(), view: GLMath.create(), projection: GLMath.create(), viewProjection: GLMath.create() },
  cameraPosition: [0, 0, 0],

  async init(canvas) {
    try {
      const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
      if (!gl) return false;
      this.gl = gl;
      this.canvas = canvas;
      this.meshProgram = this.createProgram(GL_SHADERS.meshVertex, GL_SHADERS.meshFragment);
      this.blobProgram = this.createProgram(GL_SHADERS.blobVertex, GL_SHADERS.blobFragment);
      if (!this.meshProgram || !this.blobProgram) return false;

      this.batches = {
        cube: this.createMeshBatch(buildCubeMesh(0)),
        limb: this.createMeshBatch(buildCubeMesh(-0.5)), // hangs from its top face (pivot at y = 0)
        sphere: this.createMeshBatch(buildSphereMesh(14, 20)),
      };
      this.shadowBlobs = this.createBlobBatch();
      this.glowBlobs = this.createBlobBatch();
      this.uniforms = {
        meshViewProjection: gl.getUniformLocation(this.meshProgram, 'uViewProjection'),
        cameraPosition: gl.getUniformLocation(this.meshProgram, 'uCameraPosition'),
        resolution: gl.getUniformLocation(this.meshProgram, 'uResolution'),
        exposure: gl.getUniformLocation(this.meshProgram, 'uExposure'),
        blobViewProjection: gl.getUniformLocation(this.blobProgram, 'uViewProjection'),
      };

      // A lost context (GPU reset) turns render() into a no-op; main.js sees
      // isLost() and switches to Canvas 2D.
      canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        this.contextLost = true;
      });
      return !gl.isContextLost();
    } catch (error) {
      return false;
    }
  },

  isLost() {
    return this.contextLost;
  },

  createProgram(vertexSource, fragmentSource) {
    const gl = this.gl;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vertexShader = compile(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertexShader || !fragmentShader) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
  },

  createMeshBatch(mesh) {
    const gl = this.gl;
    const vertexArray = gl.createVertexArray();
    gl.bindVertexArray(vertexArray);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

    const instanceData = new Float32Array(GL_TUNING.maxInstancesPerMesh * FLOATS_PER_INSTANCE);
    const instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, instanceData.byteLength, gl.DYNAMIC_DRAW);
    for (let attribute = 0; attribute < 6; attribute++) {
      gl.enableVertexAttribArray(2 + attribute);
      gl.vertexAttribPointer(2 + attribute, 4, gl.FLOAT, false, FLOATS_PER_INSTANCE * 4, attribute * 16);
      gl.vertexAttribDivisor(2 + attribute, 1);
    }
    gl.bindVertexArray(null);
    return { vertexArray, instanceBuffer, instanceData, count: 0, indexCount: mesh.indices.length };
  },

  createBlobBatch() {
    const gl = this.gl;
    const vertexArray = gl.createVertexArray();
    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    const blobData = new Float32Array(GL_TUNING.maxBlobs * FLOATS_PER_BLOB);
    const blobBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, blobBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, blobData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    return { vertexArray, blobBuffer, blobData, count: 0 };
  },

  // ---- Instance helpers ----

  // Adds one instance. matrix: world transform; color: linear [r, g, b].
  addInstance(batch, matrix, color, emissive = 0, material = GL_MATERIAL.plain, rim = 0, occlusion = 0) {
    if (batch.count >= GL_TUNING.maxInstancesPerMesh) return;
    const data = batch.instanceData;
    const offset = batch.count * FLOATS_PER_INSTANCE;
    data.set(matrix, offset);
    data[offset + 16] = color[0];
    data[offset + 17] = color[1];
    data[offset + 18] = color[2];
    data[offset + 19] = 1;
    data[offset + 20] = emissive;
    data[offset + 21] = material;
    data[offset + 22] = rim;
    data[offset + 23] = occlusion;
    batch.count += 1;
  },

  // An axis-aligned box by center and size (the bulk of the station and train).
  addBox(centerX, centerY, centerZ, sizeX, sizeY, sizeZ, color, emissive = 0, material = GL_MATERIAL.plain, occlusion = 0) {
    GLMath.compose(this.scratch.world, centerX, centerY, centerZ, 0, 0, 0, sizeX, sizeY, sizeZ);
    this.addInstance(this.batches.cube, this.scratch.world, color, emissive, material, 0, occlusion);
  },

  // A body part relative to `parent`: local = T * Ry * Rx * Rz * S, world = parent * local.
  addPart(batch, parent, x, y, z, yaw, pitch, roll, scaleX, scaleY, scaleZ, color, emissive = 0, rim = 0) {
    GLMath.compose(this.scratch.local, x, y, z, yaw, pitch, roll, scaleX, scaleY, scaleZ);
    GLMath.multiply(this.scratch.world, parent, this.scratch.local);
    this.addInstance(batch, this.scratch.world, color, emissive, GL_MATERIAL.plain, rim, 0);
  },

  addBlob(blobs, x, y, z, radius, red, green, blue, alpha) {
    if (blobs.count >= GL_TUNING.maxBlobs) return;
    const offset = blobs.count * FLOATS_PER_BLOB;
    const data = blobs.blobData;
    data[offset] = x; data[offset + 1] = y; data[offset + 2] = z; data[offset + 3] = radius;
    data[offset + 4] = red; data[offset + 5] = green; data[offset + 6] = blue; data[offset + 7] = alpha;
    blobs.count += 1;
  },

  // ---- Frame ----

  render(view) {
    if (this.contextLost) return;
    const gl = this.gl;
    const dt = this.previousTimeSeconds === null ? 0 : Math.min(0.1, Math.max(0, view.timeSeconds - this.previousTimeSeconds));
    this.previousTimeSeconds = view.timeSeconds;
    this.matchCanvasToDisplaySize();

    for (const batch of Object.values(this.batches)) batch.count = 0;
    this.shadowBlobs.count = 0;
    this.glowBlobs.count = 0;

    this.buildStation();
    this.buildTrain(view, dt);
    this.buildPassengers(view, dt);
    this.updateCamera();

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.07, 0.075, 0.09, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);

    gl.useProgram(this.meshProgram);
    gl.uniformMatrix4fv(this.uniforms.meshViewProjection, false, this.scratch.viewProjection);
    gl.uniform3fv(this.uniforms.cameraPosition, this.cameraPosition);
    gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.exposure, GL_TUNING.exposure);
    for (const batch of Object.values(this.batches)) {
      if (batch.count === 0) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, batch.instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.instanceData, 0, batch.count * FLOATS_PER_INSTANCE);
      gl.bindVertexArray(batch.vertexArray);
      gl.drawElementsInstanced(gl.TRIANGLES, batch.indexCount, gl.UNSIGNED_SHORT, 0, batch.count);
    }

    // Soft shadows darken; door light pools add light. Neither writes depth.
    gl.useProgram(this.blobProgram);
    gl.uniformMatrix4fv(this.uniforms.blobViewProjection, false, this.scratch.viewProjection);
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.drawBlobs(this.shadowBlobs);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    this.drawBlobs(this.glowBlobs);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  },

  drawBlobs(blobs) {
    if (blobs.count === 0) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, blobs.blobBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, blobs.blobData, 0, blobs.count * FLOATS_PER_BLOB);
    gl.bindVertexArray(blobs.vertexArray);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, blobs.count);
  },

  matchCanvasToDisplaySize() {
    const ratio = Math.min(window.devicePixelRatio || 1, GL_TUNING.maxPixelRatio);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  },

  updateCamera() {
    const pitch = (GL_TUNING.cameraPitchDegrees * Math.PI) / 180;
    const [targetX, targetY, targetZ] = GL_TUNING.cameraTarget;
    this.cameraPosition[0] = targetX;
    this.cameraPosition[1] = targetY + Math.sin(pitch) * GL_TUNING.cameraDistance;
    this.cameraPosition[2] = targetZ + Math.cos(pitch) * GL_TUNING.cameraDistance;
    const aspect = this.canvas.width / this.canvas.height;
    GLMath.perspective(this.scratch.projection, (GL_TUNING.cameraFovDegrees * Math.PI) / 180, aspect, 0.5, 80);
    GLMath.lookAt(this.scratch.view, this.cameraPosition, GL_TUNING.cameraTarget);
    GLMath.multiply(this.scratch.viewProjection, this.scratch.projection, this.scratch.view);
  },

  // ---- Station ----

  buildStation() {
    const c = GL_COLORS;
    const width = 32;
    // Back wall (tiled), its trim band and a fluorescent strip.
    this.addBox(0, 2.6, -4.6, width, 7.4, 0.4, c.wallTile, 0, GL_MATERIAL.wallTile, 1);
    this.addBox(0, 0.9, -4.38, width, 0.35, 0.06, c.trimBand);
    this.addBox(0, 4.55, -4.36, width, 0.14, 0.1, c.fluorescent, 3.2);
    // Track pit and rails, seen when no train is docked.
    this.addBox(0, -1.35, -2.2, width, 0.2, 4.6, c.trackPit);
    this.addBox(0, -1.18, -1.4, width, 0.12, 0.09, c.rail, 0.15);
    this.addBox(0, -1.18, -2.9, width, 0.12, 0.09, c.rail, 0.15);

    // Platform slab, split around the three stair openings at the front.
    const stairTopZ = layoutToWorldZ(CONFIG.layout.stairwellTop);
    const stairWidth = CONFIG.layout.stairwellWidth / GL_TUNING.pixelsPerMeter;
    this.addBox(0, -0.7, stairTopZ / 2, width, 1.4, stairTopZ, c.concrete, 0, GL_MATERIAL.concrete);
    const stairXs = CONFIG.layout.stairwellCenterXs.map(layoutToWorldX);
    const frontDepth = 6;
    let segmentLeft = -width / 2;
    for (const stairX of [...stairXs, width / 2 + stairWidth / 2]) {
      const segmentRight = stairX - stairWidth / 2;
      if (segmentRight > segmentLeft) {
        this.addBox((segmentLeft + segmentRight) / 2, -0.7, stairTopZ + frontDepth / 2, segmentRight - segmentLeft, 1.4, frontDepth, c.concrete, 0, GL_MATERIAL.concrete);
      }
      segmentLeft = stairX + stairWidth / 2;
    }
    // Platform edge: light bullnose and the tactile warning strip.
    this.addBox(0, -0.04, 0.07, width, 0.09, 0.16, c.bullnose);
    this.addBox(0, 0.006, 0.47, width, 0.014, 0.55, c.tactileStrip, 0, GL_MATERIAL.tactile);

    // Stairs going down toward the camera, with low side walls and handrails.
    for (const stairX of stairXs) {
      for (let step = 0; step < 9; step++) {
        const stepDepth = 0.3;
        this.addBox(stairX, -0.2 * (step + 1) - 0.1, stairTopZ + stepDepth * (step + 0.5), stairWidth, 0.2, stepDepth, c.stairStep, 0, GL_MATERIAL.plain, 1);
      }
      for (const side of [-1, 1]) {
        const wallX = stairX + side * (stairWidth / 2 + 0.05);
        this.addBox(wallX, 0.25, stairTopZ + 2.2, 0.1, 0.5, 4.4, c.stairWall, 0, GL_MATERIAL.plain, 1);
        this.addBox(wallX, 0.92, stairTopZ + 2.2, 0.06, 0.06, 4.4, c.handrail, 0.1);
        this.addBox(wallX, 0.7, stairTopZ + 0.05, 0.06, 0.45, 0.06, c.handrail, 0.1);
      }
    }
  },

  // ---- Train ----

  buildTrain(view, dt) {
    const c = GL_COLORS;
    const offsetX = view.trainOffsetPixels / GL_TUNING.pixelsPerMeter;
    const { trainLeft, trainRight, doorWidth: doorWidthPixels } = CONFIG.layout;
    const left = layoutToWorldX(trainLeft) + offsetX;
    const right = layoutToWorldX(trainRight) + offsetX;
    const length = right - left;
    const centerX = (left + right) / 2;
    const frontZ = -0.28; // a small gap between the car and the platform edge
    const doorWidth = doorWidthPixels / GL_TUNING.pixelsPerMeter;
    const doorHeight = 2.05;
    const doorBottom = 0.2;

    // Body, roof, skirt and the purple line stripe.
    this.addBox(centerX, 1.7, frontZ - 1.4, length, 3.0, 2.8, c.trainSteel);
    this.addBox(centerX, 3.32, frontZ - 1.4, length - 0.3, 0.3, 2.4, c.trainRoof);
    this.addBox(centerX, 0.18, frontZ - 1.35, length - 0.4, 0.4, 2.6, c.trainSkirt, 0, GL_MATERIAL.plain, 1);
    this.addBox(centerX, 0.95, frontZ + 0.02, length + 0.02, 0.2, 0.06, c.trainStripe);
    // Rounded-ish cab ends.
    for (const end of [-1, 1]) {
      this.addBox(centerX + end * (length / 2 + 0.12), 1.7, frontZ - 1.4, 0.25, 2.7, 2.5, c.trainRoof);
    }

    const doorXs = view.train.doors.map((door) => layoutToWorldX(door.centerX) + offsetX);
    // Warm lit windows between the doors.
    const edges = [left, ...doorXs, right];
    for (let i = 0; i < edges.length - 1; i++) {
      const windowLeft = edges[i] + (i === 0 ? 0.45 : doorWidth / 2 + 0.4);
      const windowRight = edges[i + 1] - (i === edges.length - 2 ? 0.45 : doorWidth / 2 + 0.4);
      if (windowRight - windowLeft > 0.3) {
        this.addBox((windowLeft + windowRight) / 2, 1.95, frontZ + 0.02, windowRight - windowLeft, 0.85, 0.05, c.trainWindow, 1.6);
      }
    }

    const blink = Math.sin(view.timeSeconds * Math.PI * 8) > 0; // 4 Hz
    view.train.doors.forEach((door, index) => {
      const doorX = doorXs[index];
      // Logic opens instantly; the leaves glide open, but follow closing exactly.
      const target = door.openFraction();
      const visual = this.doorVisualOpen[index];
      this.doorVisualOpen[index] = target < visual ? target : visual + (target - visual) * Math.min(1, dt * GL_TUNING.doorOpenSmoothing);
      const openAmount = this.doorVisualOpen[index];

      // Lit interior behind the doors, then the two sliding leaves.
      this.addBox(doorX, doorBottom + doorHeight / 2, frontZ + 0.01, doorWidth, doorHeight, 0.05, c.doorway, 1.2);
      const leafWidth = (doorWidth / 2) * (1 - openAmount);
      if (leafWidth > 0.01) {
        for (const side of [-1, 1]) {
          const leafCenter = doorX + side * (doorWidth / 2 - leafWidth / 2);
          this.addBox(leafCenter, doorBottom + doorHeight / 2, frontZ + 0.05, leafWidth, doorHeight, 0.05, c.doorPanel);
          this.addBox(leafCenter, doorBottom + doorHeight * 0.68, frontZ + 0.08, leafWidth * 0.6, 0.55, 0.02, c.trainWindow, 1.2);
        }
      }

      // Number plate with a state-colored light frame (AC 2): green open, amber
      // blinking while closing, red closed, pulsing orange while a Blocker holds it.
      let lightColor = c.doorLightClosed;
      let lightGlow = 1.4;
      if (door.isLocked()) {
        lightColor = c.doorLightHeld;
        lightGlow = 2 + 2 * Math.abs(Math.sin(view.timeSeconds * 10));
      } else if (door.state === DOOR_STATE.OPEN) {
        lightColor = c.doorLightOpen;
      } else if (door.state === DOOR_STATE.CLOSING) {
        lightColor = c.doorLightClosing;
        lightGlow = blink ? 2.6 : 0.4;
      }
      const plateY = doorBottom + doorHeight + 0.48;
      this.addBox(doorX, plateY, frontZ + 0.03, 0.78, 0.66, 0.04, lightColor, lightGlow);
      this.addBox(doorX, plateY, frontZ + 0.06, 0.6, 0.5, 0.04, c.numberPlate);
      this.addDigit(door.label, doorX, plateY, frontZ + 0.09);
      this.addDoorTimerBar(door, doorX, plateY + 0.52, frontZ + 0.1);

      if (door.isLocked()) {
        // A hazard bar across the doorway shows why the key isn't working.
        this.addBox(doorX, doorBottom + 1.05, frontZ + 0.12, doorWidth + 0.1, 0.12, 0.04, c.doorLightHeld, 2.5);
      }
      if (openAmount > 0.02) {
        // A pool of warm light spills onto the platform from each open door.
        this.addBlob(this.glowBlobs, doorX, 0.02, 0.85, 1.35, 1.0, 0.92, 0.72, 0.32 * openAmount);
      }
    });
  },

  // Above each door: green bar draining while it's open (time until it closes by
  // itself), orange bar draining while it recharges after closing.
  addDoorTimerBar(door, centerX, centerY, z) {
    let fraction = 0;
    let color = null;
    if (door.state === DOOR_STATE.OPEN) {
      fraction = door.openSecondsLeft / CONFIG.doorOpenSeconds;
      color = GL_COLORS.doorLightOpen;
    } else if (door.isCoolingDown()) {
      fraction = door.cooldownSecondsLeft / CONFIG.doorCooldownSeconds;
      color = GL_COLORS.doorLightHeld;
    }
    if (!color) return;
    const width = 1.1;
    const height = 0.13;
    fraction = Math.max(0, Math.min(1, fraction));
    this.addBox(centerX, centerY, z, width + 0.08, height + 0.08, 0.03, GL_COLORS.numberPlate);
    if (fraction > 0) {
      this.addBox(centerX - (width * (1 - fraction)) / 2, centerY, z + 0.02, width * fraction, height, 0.03, color, 2.4);
    }
  },

  addDigit(label, centerX, centerY, z) {
    const rows = GL_DIGIT_PIXELS[label];
    if (!rows) return;
    const pixel = 0.085;
    rows.forEach((row, rowIndex) => {
      for (let column = 0; column < row.length; column++) {
        if (row[column] !== '#') continue;
        const x = centerX + (column - 1) * pixel;
        const y = centerY + (2 - rowIndex) * pixel;
        this.addBox(x, y, z, pixel * 0.92, pixel * 0.92, 0.03, GL_COLORS.numberPixel, 2.2);
      }
    });
  },

  // ---- Passengers ----

  buildPassengers(view, dt) {
    for (const passenger of view.passengers) {
      if (passenger.isVisible()) this.buildPassenger(passenger, view, dt);
    }
  },

  buildPassenger(passenger, view, dt) {
    const c = GL_COLORS;
    const bodyColor = hexToLinearCached(GL_PASSENGER_COLORS[passenger.typeKey] || passenger.type.color);
    const time = passenger.animationSeconds;
    const isRunning = passenger.state === PASSENGER_STATE.RUNNING && !passenger.isCheckingPhone();
    const isPhone = passenger.isCheckingPhone();
    const isWaiting = passenger.state === PASSENGER_STATE.WAITING;
    const isLeftBehind = passenger.state === PASSENGER_STATE.LEFT_BEHIND;
    const isBoarding = passenger.state === PASSENGER_STATE.BOARDED;

    let x = layoutToWorldX(passenger.x);
    let z = layoutToWorldZ(passenger.y);
    let y = 0;
    let scale = 1;

    // Facing: toward where they're running; at the doors they face the train; left
    // behind they turn to face the camera so you see the sad face.
    let pose = this.passengerPoses.get(passenger);
    if (!pose) {
      pose = { yaw: Math.PI };
      this.passengerPoses.set(passenger, pose);
    }
    let targetYaw = pose.yaw;
    if (passenger.state === PASSENGER_STATE.RUNNING) {
      const dx = passenger.waitX - passenger.x;
      const dz = passenger.waitY - passenger.y;
      if (Math.hypot(dx, dz) > 1) targetYaw = Math.atan2(dx, dz);
    } else if (isWaiting || isBoarding) {
      targetYaw = Math.PI;
    } else if (isLeftBehind) {
      targetYaw = 0;
    }
    let turn = targetYaw - pose.yaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    pose.yaw += turn * Math.min(1, dt * GL_TUNING.turnSmoothing);

    if (isBoarding) {
      // Hop up and into the doorway, shrinking as they disappear inside.
      const progress = Math.min(1, passenger.secondsSinceBoarded / CONFIG.boardingAnimationSeconds);
      const door = view.train.doors[passenger.targetDoorIndex];
      const doorX = layoutToWorldX(door.centerX) + view.trainOffsetPixels / GL_TUNING.pixelsPerMeter;
      x += (doorX - x) * progress;
      z += (-0.6 - z) * progress;
      y = 4 * 0.45 * progress * (1 - progress);
      scale = 1 - progress * progress;
    }

    // Run cycle: faster types cycle faster; bob, squash and lean sell the effort.
    const stride = time * 9 * Math.pow(passenger.type.speedMultiplier, 0.6);
    const swing = isRunning ? Math.sin(stride) : 0;
    let bodySquash = 1;
    let lean = 0;
    let headTilt = 0;
    let armRaise = 0.25;
    let armSwing = 0;
    if (isRunning) {
      y += 0.08 * Math.abs(Math.sin(stride));
      bodySquash = 1 + 0.07 * Math.cos(2 * stride);
      lean = 0.18 + 0.05 * passenger.type.speedMultiplier;
      armRaise = 0.9 + 0.5 * Math.sin(stride * 2); // the cartoon flail
      armSwing = swing * 0.9;
    } else if (isWaiting) {
      y += 0.1 * Math.abs(Math.sin(time * 6)); // impatient hopping
      armRaise = 2.5 + 0.3 * Math.sin(time * 9); // arms up, waving at the closed door
    } else if (isPhone) {
      headTilt = 0.45;
    } else if (isLeftBehind) {
      bodySquash = 0.9 + 0.02 * Math.sin(time * 2.2); // slumped, sighing
      lean = 0.38;
      headTilt = 0.5;
      armRaise = 0.08;
    } else if (isBoarding) {
      armRaise = 2.6; // arms up in triumph
    }

    // Soft contact shadow, smaller and fainter when they're in the air.
    this.addBlob(this.shadowBlobs, x, 0.015, z, 0.42 * scale * (1 - y * 0.6), 0, 0, 0, 0.42 * scale);
    if (scale <= 0.02) return;

    const root = this.scratch.root;
    const squashWidth = 1 / Math.sqrt(bodySquash);
    GLMath.compose(root, x, y, z, pose.yaw, 0, 0, scale * squashWidth, scale * bodySquash, scale * squashWidth);
    const rim = 0.45;

    // Legs (pivot at the hips), then torso, arms, head and face.
    for (const side of [-1, 1]) {
      this.addPart(this.batches.limb, root, side * 0.11, 0.62, 0, 0, side * swing * 0.8, 0, 0.14, 0.62, 0.15, c.legs, 0, rim);
    }
    this.addPart(this.batches.sphere, root, 0, 0.95, 0, 0, lean, 0, 0.26, 0.38, 0.2, bodyColor, passenger.type.sparkles ? 0.25 : 0, rim);
    for (const side of [-1, 1]) {
      const armPitch = isPhone && side === 1 ? -1.3 : -armSwing * side;
      const raise = isPhone && side === 1 ? 0.15 : armRaise;
      this.addPart(this.batches.limb, root, side * 0.27, 1.22, 0, 0, armPitch, side * raise, 0.1, 0.5, 0.1, bodyColor, 0, rim);
    }

    // Head: a parent transform so the face tilts with it.
    GLMath.compose(this.scratch.local, 0, 1.5, 0.02 + lean * 0.25, 0, headTilt, 0, 1, 1, 1);
    GLMath.multiply(this.scratch.head, root, this.scratch.local);
    const head = this.scratch.head;
    this.addPart(this.batches.sphere, head, 0, 0, 0, 0, 0, 0, 0.24, 0.24, 0.24, c.skin, 0, rim * 0.5);
    this.addPart(this.batches.sphere, head, 0, 0.1, -0.03, 0, 0, 0, 0.245, 0.17, 0.23, c.hair);
    for (const side of [-1, 1]) {
      this.addPart(this.batches.sphere, head, side * 0.085, 0.03, 0.21, 0, 0, 0, 0.035, 0.045, 0.03, c.faceInk);
    }
    // Mouth: a frown when left behind, a grin while boarding, flat otherwise.
    const mouthCurve = isLeftBehind ? -0.035 : isBoarding ? 0.035 : 0;
    this.addPart(this.batches.cube, head, 0, -0.085, 0.215, 0, 0, 0, 0.07, 0.022, 0.02, c.faceInk);
    for (const side of [-1, 1]) {
      this.addPart(this.batches.cube, head, side * 0.055, -0.085 + mouthCurve * 0.6, 0.205, 0, 0, side * (mouthCurve > 0 ? 0.6 : mouthCurve < 0 ? -0.6 : 0), 0.045, 0.022, 0.02, c.faceInk);
    }

    if (passenger.type.carriesBox) {
      this.addPart(this.batches.cube, root, 0, 0.92, 0.3, 0, 0, 0, 0.5, 0.4, 0.34, c.box, 0, rim);
    }
    if (isPhone) {
      this.addPart(this.batches.cube, root, 0.16, 1.32, 0.38, 0, -0.5, 0, 0.12, 0.2, 0.03, c.phoneScreen, 2.4);
    }
    if (passenger.type.sparkles) {
      for (let i = 0; i < 4; i++) {
        const angle = time * 2.6 + (i * Math.PI) / 2;
        const size = 0.05 + 0.04 * Math.abs(Math.sin(time * 7 + i));
        this.addPart(this.batches.cube, root, Math.cos(angle) * 0.5, 1.45 + Math.sin(time * 3 + i) * 0.25, Math.sin(angle) * 0.5, angle, angle, 0, size, size, size, c.sparkle, 3);
      }
    }
  },
};

// Passenger colors are hex strings in a table; convert each only once.
const glLinearColorCache = new Map();
function hexToLinearCached(hex) {
  let linear = glLinearColorCache.get(hex);
  if (!linear) {
    linear = hexToLinear(hex);
    glLinearColorCache.set(hex, linear);
  }
  return linear;
}
