import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PetAnimation } from "./types";

type RockySceneProps = {
  animation: PetAnimation;
  interactive?: boolean;
};

type LegData = {
  uLeg: THREE.Mesh;
  lLeg: THREE.Mesh;
  baseUpper: number;
  baseLower: number;
  lift: number;
  name: string;
  index: number;
};

const noisePermutation = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8,
  99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35,
  11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134,
  139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46,
  245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169,
  200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124,
  123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28,
  42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
  129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251,
  34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192,
  214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205,
  93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
];

const perm = Array.from({ length: 512 }, (_, index) => noisePermutation[index & 255]);

export default function RockyScene({ animation, interactive = true }: RockySceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef(animation);

  useEffect(() => {
    animationRef.current = animation;
  }, [animation]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const container = mount;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x161716, 0.008);

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(10, 7, 14);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enabled = interactive;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 4.2, 0);
    controls.autoRotate = false;

    scene.add(new THREE.AmbientLight(0xffecd4, 0.68));

    const dir = new THREE.DirectionalLight(0xfff5e6, 0.95);
    dir.position.set(5, 18, 10);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 50;
    dir.shadow.camera.left = -15;
    dir.shadow.camera.right = 15;
    dir.shadow.camera.top = 15;
    dir.shadow.camera.bottom = -15;
    dir.shadow.bias = -0.0005;
    scene.add(dir);

    const fill = new THREE.DirectionalLight(0x88aacc, 0.3);
    fill.position.set(-10, 5, -10);
    scene.add(fill);

    const frontFill = new THREE.DirectionalLight(0xffffff, 0.55);
    frontFill.position.set(0, 7, 14);
    scene.add(frontFill);

    const rim = new THREE.DirectionalLight(0xffcc88, 0.25);
    rim.position.set(-5, 8, -12);
    scene.add(rim);

    const rockMat = new THREE.MeshStandardMaterial({
      map: makeRockTexture(1024, 1024, false),
      bumpMap: makeRockTexture(1024, 1024, true),
      bumpScale: 0.8,
      color: 0xb29f86,
      emissive: 0x1c1711,
      emissiveIntensity: 0.22,
      roughness: 0.88,
      metalness: 0.05,
      flatShading: true,
    });

    const glowMat = new THREE.MeshStandardMaterial({
      color: 0x3ddc84,
      emissive: 0x3ddc84,
      emissiveIntensity: 2,
      roughness: 0.3,
      transparent: true,
      opacity: 0.85,
    });

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const rockyGroup = new THREE.Group();
    rockyGroup.rotation.y = Math.PI;
    scene.add(rockyGroup);

    const coreMesh = new THREE.Group();
    coreMesh.position.y = 6.2;
    rockyGroup.add(coreMesh);

    const legsData = buildRocky(coreMesh, rockMat, glowMat);
    const clock = new THREE.Clock();
    let animTime = 0;
    let frameId = 0;

    function resize() {
      const width = container.clientWidth;
      const height = container.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    }

    function animate() {
      frameId = window.requestAnimationFrame(animate);
      animTime += clock.getDelta();
      applyMotion(animationRef.current, animTime, coreMesh, legsData);

      const glowPulse = 0.7 + Math.sin(animTime * 3) * 0.3;
      glowMat.emissiveIntensity = 1.5 + glowPulse;

      controls.update();
      renderer.render(scene, camera);
    }

    window.addEventListener("resize", resize);
    animate();

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      disposeObject(scene);
    };
  }, [interactive]);

  return <div ref={mountRef} className="rocky-scene" />;
}

function buildRocky(coreMesh: THREE.Group, rockMat: THREE.Material, glowMat: THREE.Material) {
  const carapGeo = new THREE.SphereGeometry(3, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6);
  displaceGeo(carapGeo, 0.6, 0.35);
  const carapace = new THREE.Mesh(carapGeo, rockMat);
  carapace.scale.set(1.25, 0.65, 1.05);
  carapace.position.y = 0.3;
  carapace.castShadow = true;
  carapace.receiveShadow = true;
  coreMesh.add(carapace);

  const bellyGeo = new THREE.SphereGeometry(2.2, 10, 6, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.5);
  displaceGeo(bellyGeo, 0.7, 0.2);
  const belly = new THREE.Mesh(bellyGeo, rockMat);
  belly.position.y = -0.6;
  belly.scale.set(1.15, 0.9, 0.95);
  belly.castShadow = true;
  belly.receiveShadow = true;
  coreMesh.add(belly);

  const ridgeGeo = new THREE.DodecahedronGeometry(1.2, 1);
  displaceGeo(ridgeGeo, 0.8, 0.25);
  const ridge = new THREE.Mesh(ridgeGeo, rockMat);
  ridge.scale.set(1.8, 0.35, 1.1);
  ridge.position.y = 1.5;
  ridge.castShadow = true;
  coreMesh.add(ridge);

  [
    [1.8, 1.2, 1.5],
    [-1.8, 1.2, 1.5],
    [2.2, 0.8, -0.8],
    [-2.2, 0.8, -0.8],
    [0, 1.8, 0],
    [1, 0.5, 2.2],
    [-1, 0.5, 2.2],
  ].forEach(([x, y, z]) => {
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 4), glowMat);
    glow.position.set(x, y, z);
    glow.scale.set(1, 0.5, 1);
    coreMesh.add(glow);
  });

  const legs = [
    { name: "front", yaw: 0, ax: [0, -0.3, 3.2], uAng: -0.25, lAng: 1.1, uLen: 3, lLen: 3, th: 0.85, lift: 0.8 },
    { name: "frontLeft", yaw: 1.1, ax: [-2.9, -0.2, 2.2], uAng: -0.3, lAng: 1.2, uLen: 3.8, lLen: 3.8, th: 0.85, lift: 1 },
    { name: "frontRight", yaw: -1.1, ax: [2.9, -0.2, 2.2], uAng: -0.3, lAng: 1.2, uLen: 3.8, lLen: 3.8, th: 0.85, lift: 1 },
    { name: "rearLeft", yaw: 2.5, ax: [-2.9, -0.4, -2], uAng: -0.2, lAng: 1, uLen: 3.2, lLen: 3.4, th: 0.7, lift: 0.6 },
    { name: "rearRight", yaw: -2.5, ax: [2.9, -0.4, -2], uAng: -0.2, lAng: 1, uLen: 3.2, lLen: 3.4, th: 0.7, lift: 0.6 },
  ];

  return legs.map((leg, index): LegData => {
    const container = new THREE.Group();
    container.position.set(leg.ax[0], leg.ax[1], leg.ax[2]);
    container.rotation.y = leg.yaw;
    coreMesh.add(container);

    container.add(makeJoint(1.05, leg.th, rockMat));

    const upperJoint = new THREE.Group();
    container.add(upperJoint);

    const uLeg = makeSegment(0.85, 0.65, leg.uLen, leg.th, rockMat);
    uLeg.rotation.x = leg.uAng;
    if (leg.name.includes("Left")) uLeg.rotation.z = -0.05;
    if (leg.name.includes("Right")) uLeg.rotation.z = 0.05;
    upperJoint.add(uLeg);

    const upperGlow = new THREE.Mesh(new THREE.SphereGeometry(0.18, 5, 3), glowMat);
    upperGlow.position.set(0, -leg.uLen * 0.45, 0.6);
    uLeg.add(upperGlow);

    const plateGeo = new THREE.DodecahedronGeometry(0.55 * leg.th, 0);
    displaceGeo(plateGeo, 1.2, 0.08);
    const plate = new THREE.Mesh(plateGeo, rockMat);
    plate.position.set(0, -leg.uLen * 0.5, 0);
    plate.scale.set(1.3, 0.6, 1.1);
    plate.castShadow = true;
    uLeg.add(plate);

    const kneeJoint = new THREE.Group();
    kneeJoint.position.set(0, -leg.uLen, 0);
    uLeg.add(kneeJoint);
    kneeJoint.add(makeJoint(0.9, leg.th, rockMat));

    const kneeGlow = new THREE.Mesh(new THREE.SphereGeometry(0.18, 5, 3), glowMat);
    kneeGlow.position.set(0, 0, 0.8);
    kneeJoint.add(kneeGlow);

    const lLeg = makeSegment(0.6, 0.42, leg.lLen, leg.th, rockMat);
    lLeg.rotation.x = leg.lAng;
    kneeJoint.add(lLeg);

    const lowerPlate = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4 * leg.th, 0), rockMat);
    lowerPlate.position.set(0, -leg.lLen * 0.5, 0);
    lowerPlate.scale.set(1.2, 0.5, 1);
    lowerPlate.castShadow = true;
    lLeg.add(lowerPlate);

    const lowerGlow = new THREE.Mesh(new THREE.SphereGeometry(0.15, 5, 3), glowMat);
    lowerGlow.position.set(0, -leg.lLen * 0.6, 0.5);
    lLeg.add(lowerGlow);

    const footGeo = new THREE.DodecahedronGeometry(0.5 * leg.th, 1);
    displaceGeo(footGeo, 1, 0.1);
    const foot = new THREE.Mesh(footGeo, rockMat);
    foot.position.set(0, -leg.lLen, 0);
    foot.scale.set(1.1, 1.4, 1);
    foot.castShadow = true;
    foot.receiveShadow = true;
    lLeg.add(foot);

    return {
      uLeg,
      lLeg,
      baseUpper: leg.uAng,
      baseLower: leg.lAng,
      lift: leg.lift,
      name: leg.name,
      index,
    };
  });
}

function applyMotion(animation: PetAnimation, animTime: number, coreMesh: THREE.Group, legsData: LegData[]) {
  const currentAnim = animation === "think" ? "thinking" : animation;
  const speed = { idle: 2, walk: 6, run: 12, inspect: 3, confused: 3, thinking: 2, sleep: 0.8, wake: 1.5, talk: 3, celebrate: 8 }[currentAnim] ?? 2;
  const t = animTime * speed;
  let targetY = 6.2;
  let targetRotX = 0;
  let targetRotY = 0;
  let targetRotZ = 0;

  if (currentAnim === "idle" || currentAnim === "talk") {
    targetY = 6.2 + Math.sin(t) * 0.08;
    targetRotY = Math.sin(t * 0.5) * 0.02;
    legsData.forEach((leg) => {
      leg.uLeg.rotation.x = leg.baseUpper + Math.sin(t + leg.index) * 0.025;
      leg.lLeg.rotation.x = leg.baseLower + Math.cos(t + leg.index) * 0.025;
    });
  } else if (currentAnim === "inspect") {
    targetY = 5.8 + Math.sin(t * 0.8) * 0.1;
    targetRotX = 0.25 + Math.sin(t * 0.6) * 0.05;
    legsData.forEach((leg, index) => {
      if (leg.name === "front") {
        leg.uLeg.rotation.x = -0.6 + Math.sin(t * 1.5) * 0.15;
        leg.lLeg.rotation.x = 0.4 + Math.sin(t * 1.5 + 1) * 0.1;
      } else {
        leg.uLeg.rotation.x = leg.baseUpper + 0.05;
        leg.lLeg.rotation.x = leg.baseLower - 0.05 + Math.sin(t * 0.5 + index) * 0.02;
      }
    });
  } else if (currentAnim === "confused") {
    targetY = 6.2 + Math.sin(t) * 0.06;
    targetRotZ = Math.sin(t * 0.7) * 0.2;
    targetRotY = Math.sin(t * 0.5) * 0.15;
    legsData.forEach((leg, index) => {
      if (leg.name === "frontRight") {
        leg.uLeg.rotation.x = -0.8 + Math.sin(t * 2.5) * 0.12;
        leg.lLeg.rotation.x = 1.8 + Math.cos(t * 2.5) * 0.1;
      } else {
        leg.uLeg.rotation.x = leg.baseUpper + Math.sin(t * 0.4 + index) * 0.04;
        leg.lLeg.rotation.x = leg.baseLower + Math.cos(t * 0.4 + index) * 0.03;
      }
    });
  } else if (currentAnim === "thinking") {
    targetY = 6 + Math.sin(t * 0.6) * 0.1;
    targetRotX = 0.15 + Math.sin(t * 0.4) * 0.05;
    targetRotY = Math.sin(t * 0.3) * 0.1;
    legsData.forEach((leg) => {
      if (leg.name === "frontLeft") {
        leg.uLeg.rotation.x = -0.7 + Math.sin(t * 3) * 0.06;
        leg.lLeg.rotation.x = 1.6 + Math.cos(t * 3) * 0.08;
      } else {
        leg.uLeg.rotation.x = leg.baseUpper + 0.08;
        leg.lLeg.rotation.x = leg.baseLower - 0.06;
      }
    });
  } else if (currentAnim === "sleep") {
    targetY = 2.8 + Math.sin(t * 0.4) * 0.05;
    targetRotX = 0.1 * Math.sin(t * 0.3);
    legsData.forEach((leg) => {
      leg.uLeg.rotation.x = leg.baseUpper + 0.7;
      leg.lLeg.rotation.x = -0.1;
    });
  } else if (currentAnim === "wake") {
    const cycle = Math.min((animTime * speed) % 6, 1);
    const wakeAmount = Math.min(cycle * 1.5, 1);
    targetY = 2.8 + (6.2 - 2.8) * wakeAmount + Math.sin(t * 2) * 0.05 * wakeAmount;
    targetRotX = 0.1 * (1 - wakeAmount);
    legsData.forEach((leg) => {
      const collapsed = leg.baseUpper + 0.7;
      leg.uLeg.rotation.x = collapsed + (leg.baseUpper - collapsed) * wakeAmount;
      leg.lLeg.rotation.x = -0.1 + (leg.baseLower + 0.1) * wakeAmount;
    });
  } else if (currentAnim === "celebrate") {
    targetY = 6.35 + Math.abs(Math.sin(t * 2)) * 0.45;
    targetRotY = Math.sin(t * 1.5) * 0.18;
    legsData.forEach((leg, index) => {
      const phase = t * 2 + index;
      leg.uLeg.rotation.x = leg.baseUpper + Math.sin(phase) * 0.12 * leg.lift;
      leg.lLeg.rotation.x = leg.baseLower - Math.abs(Math.cos(phase)) * 0.18 * leg.lift;
    });
  } else {
    legsData.forEach((leg) => {
      leg.uLeg.rotation.x = leg.baseUpper;
      leg.lLeg.rotation.x = leg.baseLower;
    });
  }

  coreMesh.position.y += (targetY - coreMesh.position.y) * 0.15;
  coreMesh.rotation.x += (targetRotX - coreMesh.rotation.x) * 0.15;
  coreMesh.rotation.y += (targetRotY - coreMesh.rotation.y) * 0.15;
  coreMesh.rotation.z += (targetRotZ - coreMesh.rotation.z) * 0.15;
}

function makeSegment(rTop: number, rBot: number, length: number, thick: number, material: THREE.Material) {
  const geo = new THREE.CylinderGeometry(rTop * thick, rBot * thick, length, 8);
  geo.translate(0, -length / 2, 0);
  displaceGeo(geo, 0.9, 0.12);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeJoint(radius: number, thick: number, material: THREE.Material) {
  const geo = new THREE.DodecahedronGeometry(radius * thick, 1);
  displaceGeo(geo, 1, 0.15);
  const mesh = new THREE.Mesh(geo, material);
  mesh.scale.set(1.15, 0.85, 1);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function displaceGeo(geo: THREE.BufferGeometry, scale: number, amount: number) {
  const position = geo.attributes.position as THREE.BufferAttribute;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const noise = fbm(x * scale, y * scale, z * scale, 4);
    const length = Math.sqrt(x * x + y * y + z * z) || 1;
    position.setXYZ(index, x + (x / length) * noise * amount, y + (y / length) * noise * amount, z + (z / length) * noise * amount);
  }
  position.needsUpdate = true;
  geo.computeVertexNormals();
}

function makeRockTexture(width: number, height: number, isBump: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  if (isBump) {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.fillStyle = "#8b7d6b";
    ctx.fillRect(0, 0, width, height);
    for (let index = 0; index < width * height * 0.3; index += 1) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const size = Math.random() * 3 + 1;
      const value = Math.floor(Math.random() * 40 + 100);
      ctx.fillStyle = `rgb(${value + 30},${value + 20},${value})`;
      ctx.fillRect(x, y, size, size);
    }
  }

  const crackCount = isBump ? 40 : 30;
  for (let index = 0; index < crackCount; index += 1) {
    ctx.beginPath();
    let x = Math.random() * width;
    let y = Math.random() * height;
    ctx.moveTo(x, y);
    const segments = Math.floor(Math.random() * 8 + 4);
    for (let segment = 0; segment < segments; segment += 1) {
      x += Math.random() * 60 - 30;
      y += Math.random() * 60 - 30;
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = isBump ? "#333" : "#4a3f32";
    ctx.lineWidth = Math.random() * 2 + 0.5;
    ctx.stroke();
  }

  for (let index = 0; index < 60; index += 1) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const radius = Math.random() * 15 + 5;
    const value = Math.floor(Math.random() * 40 + 108);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = isBump ? `rgb(${value},${value},${value})` : `rgba(${100 + Math.random() * 40},${90 + Math.random() * 30},${70 + Math.random() * 20},0.3)`;
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function fade(value: number) {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number) {
  return a + t * (b - a);
}

function grad(hash: number, x: number, y: number, z: number) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function perlin3(x: number, y: number, z: number) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  const px = x - Math.floor(x);
  const py = y - Math.floor(y);
  const pz = z - Math.floor(z);
  const u = fade(px);
  const v = fade(py);
  const w = fade(pz);
  const A = perm[X] + Y;
  const AA = perm[A] + Z;
  const AB = perm[A + 1] + Z;
  const B = perm[X + 1] + Y;
  const BA = perm[B] + Z;
  const BB = perm[B + 1] + Z;

  return lerp(
    lerp(lerp(grad(perm[AA], px, py, pz), grad(perm[BA], px - 1, py, pz), u), lerp(grad(perm[AB], px, py - 1, pz), grad(perm[BB], px - 1, py - 1, pz), u), v),
    lerp(lerp(grad(perm[AA + 1], px, py, pz - 1), grad(perm[BA + 1], px - 1, py, pz - 1), u), lerp(grad(perm[AB + 1], px, py - 1, pz - 1), grad(perm[BB + 1], px - 1, py - 1, pz - 1), u), v),
    w,
  );
}

function fbm(x: number, y: number, z: number, octaves: number) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let index = 0; index < octaves; index += 1) {
    value += amplitude * perlin3(x * frequency, y * frequency, z * frequency);
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      Object.values(material).forEach((value: unknown) => {
        if (value instanceof THREE.Texture) value.dispose();
      });
      material.dispose();
    });
  });
}
