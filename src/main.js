import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { groupings } from "./groupings.js";
import { gradientPresets } from "./gradients.js";
import { rotate180, getGroupOriginalCenter } from "./rotationUtils.js";
import gsap from "gsap";

// === Setup scene ===
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xfff2e5); // 你可以用任何淡橙色调，比如这个

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight, // aspect ratio
  0.1,
  1000
);

camera.position.set(30, 30, 30);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({
  alpha: true,
  preserveDrawingBuffer: true,
});
renderer.setClearColor(0x000000, 0);
// 目标比例

// 获取屏幕尺寸
const screenWidth = window.innerWidth;
const screenHeight = window.innerHeight;

// 设置 renderer 尺寸
renderer.setSize(screenWidth, screenHeight);
document.body.appendChild(renderer.domElement);

// 更新相机宽高比
camera.aspect = screenWidth / screenHeight;
camera.updateProjectionMatrix();
const gl = renderer.getContext();
const pixel = new Uint8Array(4);
gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

//加入声波RMS
let useRemoteRMS = false;
let RMS_MAX = 0.05; // 固定经验值
let NOISE_FLOOR = 0.009;
let lastSmoothRms = 0; // 平滑后的RMS
let lastSpeed = 0.04; // 平滑后的speed
let lastMotionScale = 1; // 初始幅度，设你动效一开始的缩放即可
let phase = 0;

let doRotation = false;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const lightIntensity = 6;
// const fixedAmplitude = 3;

scene.add(new THREE.AmbientLight(0xffffff, 0.4));

const light1 = new THREE.DirectionalLight(0xffffff, lightIntensity);
light1.position.set(3, 5, 4);
scene.add(light1);

const light2 = new THREE.DirectionalLight(0xffffff, lightIntensity * 0.5);
light2.position.set(0, 5, -5);
scene.add(light2);

const light3 = new THREE.DirectionalLight(0xffffff, lightIntensity * 0.5);
light3.position.set(0, -5, -5);
scene.add(light3);

// 创建用于播放音频的 AudioContext
const globalAudioCtx = new (window.AudioContext || window.webkitAudioContext)({
  sampleRate: 24000,
});
const analyserNode = globalAudioCtx.createAnalyser();
analyserNode.fftSize = 256;
const audioDataArray = new Float32Array(analyserNode.fftSize);

const audioCtx = new AudioContext({ sampleRate: 24000 });
const playQueue = []; // 播放队列，避免卡顿

// 创建 WebSocket 接收后端音频数据
const audioSocket = new WebSocket("wss://realtimedialogue.onrender.com/ws/tts");
audioSocket.binaryType = "arraybuffer";

audioSocket.onmessage = async (event) => {
  const arrayBuffer = event.data;

  // 检查音频数据基本状态
  console.log("📥 收到音频包:", arrayBuffer.byteLength);
  const float32Data = new Float32Array(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  console.log("原始前10字节:", bytes.slice(0, 10));
  console.log("Float32前5个:", float32Data.slice(0, 5));

  // ✅ 确保音频值范围合理
  const max = Math.max(...float32Data);
  const min = Math.min(...float32Data);
  console.log("Float32 范围:", min, "~", max);

  // ✅ 创建 AudioBuffer
  const audioBuffer = globalAudioCtx.createBuffer(
    1, // 单声道
    float32Data.length,
    globalAudioCtx.sampleRate
  );
  audioBuffer.copyToChannel(float32Data, 0);

  // ✅ 入队并播放
  playQueue.push(audioBuffer);
  playFromQueue();
};

document.body.addEventListener(
  "click",
  () => {
    if (audioCtx.state !== "running") {
      audioCtx.resume();
      console.log("🔊 audioCtx resumed");
    }
    if (globalAudioCtx.state !== "running") {
      globalAudioCtx.resume();
      console.log("🔊 globalAudioCtx resumed");
    }
  },
  { once: true }
);

let isPlaying = false;

let nextPlayTime = globalAudioCtx.currentTime;

function playFromQueue() {
  if (isPlaying || playQueue.length === 0) return;

  const buffer = playQueue.shift();
  const source = globalAudioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(analyserNode);
  analyserNode.connect(globalAudioCtx.destination);

  source.start(nextPlayTime); // 🎯 不立即播，而是排队播
  nextPlayTime += buffer.duration;

  isPlaying = true;
  source.onended = () => {
    isPlaying = false;
    playFromQueue();
  };
}

// === Create cubes ===
const size = 5;
const width = 5;
let groupNum = 8;
let cubeArray = [null];
let groupArray = [null];
let groupDirectionArray = [null];

for (let i = 1; i <= groupNum; i++) {
  const group = new THREE.Group();
  groupArray.push(group);
}

const boxMaterial = new THREE.MeshLambertMaterial({
  vertexColors: true,
  flatShading: true,
  transparent: true, // 必须加这一行
  opacity: 1,
});

for (let a = -((width - 1) / 2); a <= (width - 1) / 2; a++) {
  for (let b = -((width - 1) / 2); b <= (width - 1) / 2; b++) {
    for (let c = -((width - 1) / 2); c <= (width - 1) / 2; c++) {
      const position = new THREE.Vector3(a * size, b * size, c * size);
      const gradientIndex = 1;
      const colors = gradientPresets[gradientIndex];

      const bottomColor = new THREE.Color(colors.bottom);
      const topColor = new THREE.Color(colors.top);

      const cube = createGradientCube(position, bottomColor, topColor);
      cube.position.copy(position);
      cubeArray.push(cube);
    }
  }
}

for (let i = 1; i <= cubeArray.length; i++) {
  const curGroup = groupings[i];
  if (curGroup != null) {
    groupArray[curGroup].add(cubeArray[i]);
  }
}

const sceneCenter = new THREE.Vector3(0, 0, 0);
for (let j = 1; j <= groupNum; j++) {
  scene.add(groupArray[j]);
  const groupCenter = getGroupOriginalCenter(j);
  const direction = groupCenter.clone().sub(sceneCenter).normalize();
  groupDirectionArray.push(direction);
}

function getGroupCenter(group) {
  const center = new THREE.Vector3();
  group.children.forEach((child) => {
    center.add(child.getWorldPosition(new THREE.Vector3()));
  });
  center.divideScalar(group.children.length);
  return center;
}

// === Microphone audio analysis ===
let analyser, dataArray;
navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const mic = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  mic.connect(analyser);
  dataArray = new Uint8Array(analyser.fftSize);
});

function getMicAmplitude() {
  if (!analyser || !dataArray) return 0;
  analyser.getByteTimeDomainData(dataArray);
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    let value = dataArray[i] - 128;
    sum += value * value;
  }
  return Math.sqrt(sum / dataArray.length);
}

// === Animation control ===
const AMP_THRESHOLD = 11;
const DEBOUNCE_FRAMES = 120;
let lowAmpFrameCount = 0;
let isActive = false;
let isFreezingToOrigin = false;
let backToOriginalCenter = false;
let backToOriginalCenterColor = false;
let isColoring = false;
let isBreathing = true;
const freezeLerpSpeed = 0.009;

// === Rotation/Motion state ===
let skipExpandOnce = false;

let isRotating = false;
let faceSequence = ["top", "right", "bottom", "left", "front", "back"];
let faceIndex = 0;

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !isRotating) {
    const face = faceSequence[faceIndex];
    faceIndex = (faceIndex + 1) % faceSequence.length;

    isRotating = true;
    rotate180(
      face,
      groupArray,
      groupDirectionArray,
      getGroupCenter,
      sceneCenter,
      () => {
        isRotating = false;
      }
    );
  } else if (e.code === "KeyD") {
    isBreathing = false;

    backToOriginalCenter = true;
  } else if (e.code === "KeyU") {
    backToOriginalCenterColor = !backToOriginalCenterColor;
  } else if (e.code === "KeyS") {
    isActive = !isActive;
  }
});

let frame = 0; // 用于记录当前帧数，驱动正弦波动画节奏

function animate() {
  frame += 1; // 帧计数器递增
  requestAnimationFrame(animate); // 请求下一帧，形成动画循环

  // === 获取当前麦克风振幅 ===
  let rawAmp = getMicAmplitude(); // 获取麦克风当前音量（RMS）
  if (rawAmp < 1) rawAmp = 0; // 低于阈值视为静音，避免误触发

  //color mode
  if (backToOriginalCenterColor) {
    isColoring = true;
  } else {
    isColoring = false;
  }

  if (doRotation && !isRotating) {
    const face = faceSequence[faceIndex];
    faceIndex = (faceIndex + 1) % faceSequence.length;

    isRotating = true;
    rotate180(
      face,
      groupArray,
      groupDirectionArray,
      getGroupCenter,
      sceneCenter,
      () => {
        isRotating = false;
      }
    );
  }
  // === 状态判断：是否进入活跃模式（声音触发）===
  // console.log(rawAmp);
  if (rawAmp > AMP_THRESHOLD) {
    lowAmpFrameCount = 0; // 重置静音计数
    isActive = true; // 标记当前为活跃状态
  } else {
    lowAmpFrameCount++; // 否则累计静音帧数
    // if (lowAmpFrameCount >= DEBOUNCE_FRAMES) {
    //   isActive = false; // 超过一定帧数则视为不活跃
    // }
  }
  if (backToOriginalCenter) {
    moveGroupsBackToOriginalCenter(() => {
      isFreezingToOrigin = true;
    });
    backToOriginalCenter = false;
  } else if (isFreezingToOrigin) {
    let minDistance = Infinity;

    for (let i = 1; i <= groupNum; i++) {
      const group = groupArray[i];
      const currentCenter = getGroupCenter(group);

      // ✅ 设置微偏移目标点，避免 group 重叠堆叠
      const baseTarget = new THREE.Vector3(0, 0, 0);
      const offsetDir = groupDirectionArray[i].clone().negate(); // 朝中心方向
      const target = baseTarget.clone().add(offsetDir.multiplyScalar(1.3)); // 每组微偏移D

      const offset = currentCenter
        .clone()
        .lerp(target, freezeLerpSpeed)
        .sub(currentCenter);

      group.position.add(offset);

      // === 设置透明度随距离渐变 ===
      const distance = currentCenter.distanceTo(target);
      minDistance = Math.min(minDistance, distance);
    }

    // ✅ 提前触发颗粒化
    if (minDistance < 10) {
      for (let i = 1; i <= groupNum; i++) {
        const group = groupArray[i];
        const targetOpacity = 0;

        group.children.forEach((cube) => {
          cube.material.transparent = true;
          gsap.to(cube.material, {
            opacity: targetOpacity,
            duration: 20, // 1 second fade
            ease: "power2.out",
          });
        });
      }
    }
  } else if (isColoring) {
    const baseBottom = new THREE.Color("#ff6f61"); // 珊瑚色
    const baseTop = new THREE.Color("#fbb5b5"); // 桃粉色

    const waveFreq = 2.0; // 控制颜色变化的波长感知度（越大越密集）

    // ✅ 初始化 wave 控制器（持续单向循环）
    if (!window.colorWave) {
      window.colorWave = { t: 0 };
      gsap.to(window.colorWave, {
        t: Math.PI * 4, // 扩大周期以让过渡更顺滑
        duration: 6.0,
        repeat: -1,
        ease: "linear", // 线性推进，不来回
      });
    }

    const waveDir = new THREE.Vector3(-1, -1, -1).normalize();

    // === 预先获取投影范围，用于归一化 ===
    let minProj = Infinity;
    let maxProj = -Infinity;

    for (let i = 1; i < cubeArray.length; i++) {
      const cube = cubeArray[i];
      const cubeWorldPos = new THREE.Vector3();
      cube.getWorldPosition(cubeWorldPos);
      const geometry = cube.geometry;
      const posAttr = geometry.attributes.position;
      const pos = new THREE.Vector3();

      for (let j = 0; j < posAttr.count; j++) {
        pos.fromBufferAttribute(posAttr, j);
        const worldVertex = pos.clone().applyMatrix4(cube.matrixWorld);
        const proj = worldVertex.dot(waveDir);
        minProj = Math.min(minProj, proj);
        maxProj = Math.max(maxProj, proj);
      }
    }

    // === 正式设置每个 cube 的 vertex color ===
    for (let i = 1; i < cubeArray.length; i++) {
      const cube = cubeArray[i];
      const cubeWorldPos = new THREE.Vector3();
      cube.getWorldPosition(cubeWorldPos);
      const geometry = cube.geometry;
      const colorAttr = geometry.attributes.color;
      const posAttr = geometry.attributes.position;
      const pos = new THREE.Vector3();

      for (let j = 0; j < posAttr.count; j++) {
        pos.fromBufferAttribute(posAttr, j);
        const worldVertex = pos.clone().applyMatrix4(cube.matrixWorld);
        const projection = worldVertex.dot(waveDir);
        const normalized = (projection - minProj) / (maxProj - minProj);

        const wave = Math.sin(
          window.colorWave.t - normalized * waveFreq * Math.PI * 2
        );
        let t = (wave + 1) / 2;
        t = THREE.MathUtils.clamp(t, 0.1, 0.9);

        const color = baseBottom.clone().lerp(baseTop, t);
        colorAttr.setXYZ(j, color.r, color.g, color.b);
      }

      colorAttr.needsUpdate = true;
    }
  }

  if (isBreathing) {
    let targetSpeed;
    let norm = 0; // 兜底
    if (useRemoteRMS) {
      analyserNode.getFloatTimeDomainData(audioDataArray); // 实时读取播放中的样本
      let sum = 0;
      for (let i = 0; i < audioDataArray.length; i++) {
        sum += audioDataArray[i] * audioDataArray[i];
      }
      let currRms = Math.sqrt(sum / audioDataArray.length); // 当前播放声音的 RMS

      lastSmoothRms = lastSmoothRms * 0.7 + currRms * 0.3;
      // 2. 归一化
      norm = lastSmoothRms > NOISE_FLOOR ? lastSmoothRms / RMS_MAX : 0;
      norm = Math.max(0, Math.min(1, norm)); // clamp to 0~1
      // 3. 推导speed
      targetSpeed = 0.013 + 0.32 * norm;
      // 4. Clamp跳变
      if (Math.abs(targetSpeed - lastSpeed) > 0.012) {
        targetSpeed = lastSpeed + 0.012 * Math.sign(targetSpeed - lastSpeed);
      }
      // console.log(lastSpeed);
    } else {
      targetSpeed = isActive ? 0.075 : 0.013;
      // console.log(targetSpeed);
      norm = 0.5;
      // norm 保持为0即可
    }

    // 5. 平滑speed
    let lerpAlpha = 0.2;
    lastSpeed = lastSpeed * (1 - lerpAlpha) + targetSpeed * lerpAlpha;

    // 6. phase推进
    phase += lastSpeed;
    if (phase > Math.PI * 1000) phase -= Math.PI * 1000;
    const wave = (Math.sin(phase - Math.PI / 2) + 1) / 2;

    // 7. 动态最大伸缩幅度
    const minAmplitude = 1.2;
    const maxAmplitude = 7;
    let dynamicAmplitude = minAmplitude + (maxAmplitude - minAmplitude) * norm;

    let rawMotionScale = dynamicAmplitude * wave;
    lastMotionScale = lastMotionScale * 0.9 + rawMotionScale * 0.1;
    for (let i = 1; i <= groupNum; i++) {
      const group = groupArray[i];
      const dir = groupDirectionArray[i];
      const offset = dir.clone().multiplyScalar(lastMotionScale);
      group.position.copy(offset);
      group.children.forEach((cube) => (cube.material.opacity = 1));
    }
  }
  controls.update(); // 更新 OrbitControls 控制器
  renderer.render(scene, camera); // 渲染当前帧
}

animate();

function createGradientCube(position, bottomColor, topColor) {
  const geometry = new THREE.BoxGeometry(size, size, size);

  const colorAttribute = [];
  const pos = new THREE.Vector3();

  for (let i = 0; i < geometry.attributes.position.count; i++) {
    pos.fromBufferAttribute(geometry.attributes.position, i);
    pos.add(position);

    let t = (pos.x + pos.y + pos.z) / (size * width * 1.5);
    t = THREE.MathUtils.clamp(t, 0, 1);

    const color = bottomColor.clone().lerp(topColor, t);
    colorAttribute.push(color.r, color.g, color.b);
  }

  geometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(colorAttribute, 3)
  );
  return new THREE.Mesh(geometry, boxMaterial);
}

function moveGroupsBackToOriginalCenter(onCompleteAll) {
  for (let i = 1; i <= groupNum; i++) {
    const group = groupArray[i];
    const currentCenter = getGroupOriginalCenter(group);

    gsap.to(group.position, {
      x: currentCenter.x,
      y: currentCenter.y,
      z: currentCenter.z,
      duration: 0.8,
      ease: "power1.inOut",
      onComplete: i === groupNum ? onCompleteAll : undefined,
    });
  }
}

let currentEventId = null;

async function pollBackendStatus() {
  try {
    const response = await fetch(
      "https://realtimedialogue.onrender.com/status"
    );
    const data = await response.json();
    let eventId = data.event_id;

    // ✅ 自动修复：如果播放结束但后端还没更新 event_id
    const audioIdle = playQueue.length === 0 && !isPlaying;
    if (eventId === 359 && audioIdle) {
      console.log("✅ 音频播放完毕，自动切换为 event_id 999");
      eventId = 999;
    }

    if (eventId !== currentEventId) {
      currentEventId = eventId;
      handleEvent(eventId, data.text);
    }
  } catch (error) {
    console.error("获取后端状态失败:", error);
  }
}

// 根据 eventId 执行动画或状态切换
function handleEvent(eventId, text) {
  console.log("切换状态:", eventId, "识别文本:", text);

  switch (eventId) {
    case 451:
      doRotation = true;
      backToOriginalCenterColor = false;
      useRemoteRMS = false;

      // 用户说话中
      break;
    case 459:
      isActive = false;
      doRotation = false;

      // doRotation = true;
      break;
    case 550:
      // isActive = false;
      // backToOriginalCenterColor = true;
      doRotation = false;
      backToOriginalCenterColor = true;
      useRemoteRMS = true;

      break;
    case 352:
      isActive = true;

      doRotation = false;
      backToOriginalCenterColor = true;
      useRemoteRMS = true;

      // backToOriginalCenterColor = true;

      break;
    case 359:
      isActive = true;

      doRotation = false;
      backToOriginalCenterColor = true;
      useRemoteRMS = true;

      // 播放音频中
      break;
    case 999:
      isActive = false;
      backToOriginalCenterColor = false;
      useRemoteRMS = false;

      // 播放结束
      break;
    default:
      break;
  }
}

// 每 100ms 轮询一次
setInterval(pollBackendStatus, 100);

//麦克风输入
let micStream;
let socket = new WebSocket("wss://realtimedialogue.onrender.com/ws/audio");
socket.binaryType = "arraybuffer";

// Float32 → Int16 转换函数
function convertFloat32ToInt16(float32Array) {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return new Uint8Array(int16Array.buffer);
}

socket.onopen = async () => {
  console.log("🎤 WebSocket连接建立，准备推送音频数据");

  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioCtx = new AudioContext({ sampleRate: 24000 }); // 确保采样率一致
  const source = audioCtx.createMediaStreamSource(micStream);
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);

  source.connect(processor);
  processor.connect(audioCtx.destination);

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0); // Float32Array
    const pcmBytes = convertFloat32ToInt16(input); // ✅ 转换为 Int16 PCM

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(pcmBytes); // ✅ 发送 Int16 PCM 数据
    }
  };
};

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

startBtn.onclick = () => {
  fetch("https://realtimedialogue.onrender.com/start", {
    method: "POST",
  }).catch((err) => console.error("❌ Start error:", err));

  // 🌟 一秒后刷新页面
  setTimeout(() => {
    location.reload();
  }, 2000);
};

stopBtn.onclick = async () => {
  try {
    const res = await fetch("https://realtimedialogue.onrender.com/stop", {
      method: "POST",
    });
    const data = await res.json();
    console.log("🛑 Stop Response:", data);
  } catch (err) {
    console.error("❌ Stop error:", err);
  }

  // 🌟 一秒后刷新页面
  setTimeout(() => {
    location.reload();
  }, 1000);
};
