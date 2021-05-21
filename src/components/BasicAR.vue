<template>
  <header>
    <details open>
      <summary>模型融合测试</summary>
      <p>在真实世界平面上，放置虚拟三维物体。</p>
      <p>需往四周移动摄像头，等待数秒，以学习周围环境知识。</p>
      <p>支持设备：安卓 chrome 浏览器（版本81+），或其它待测试</p>
    </details>
  </header>
</template>
<script>
import { WebXRButton } from "../webar/js/util/webxr-button.js";
import { Scene } from "../webar/js/render/scenes/scene.js";
import {
  Renderer,
  createWebGLContext,
} from "../webar/js/render/core/renderer.js";
import { Node } from "../webar/js/render/core/node.js";
import { Gltf2Node } from "../webar/js/render/nodes/gltf2.js";
import { DropShadowNode } from "../webar/js/render/nodes/drop-shadow.js";
import { vec3 } from "../webar/js/render/math/gl-matrix.js";
import { Ray } from "../webar/js/render/math/ray.js";
export default {
  name: "BasicAR",
  mounted() {
    // XR globals.
    // 提示按钮
    let xrButton = null;
    // 用于绘制的参考空间
    let xrRefSpace = null;
    // 用于命中测试的参考空间
    let xrViewerSpace = null;
    // 命中测试控制句柄
    let xrHitTestSource = null;
    // WebGL scene globals.
    let gl = null;
    let renderer = null;
    let scene = new Scene();
    scene.enableStats(false);
    //集合group，用于放置花node
    let arObject = new Node();
    arObject.visible = false;
    scene.addNode(arObject);
    // 花
    let flower = new Gltf2Node({ url: "gltf/sunflower/sunflower.gltf" });
    arObject.addNode(flower);
    // 标线图像
    let reticle = new Gltf2Node({ url: "gltf/reticle/reticle.gltf" });
    reticle.visible = false;
    scene.addNode(reticle);
    // 给花group创造阴影
    // Having a really simple drop shadow underneath an object helps ground
    // it in the world without adding much complexity.
    let shadow = new DropShadowNode();
    vec3.set(shadow.scale, 0.15, 0.15, 0.15);
    arObject.addNode(shadow);
    // 最大花数量
    const MAX_FLOWERS = 30;
    // 花数组
    let flowers = [];
    // 场景透明，为了AR需要，覆盖在摄像头图像上，需透视
    // Ensure the background is transparent for AR.
    scene.clear = false;
    function initXR() {
      // 提示按钮
      xrButton = new WebXRButton({
        onRequestSession: onRequestSession,
        onEndSession: onEndSession,
        textEnterXRTitle: "START AR",
        textXRNotFoundTitle: "此设备不支持AR",
        textExitXRTitle: "EXIT  AR",
      });
      // 将提示按钮加入dom中
      document.querySelector("header").appendChild(xrButton.domElement);
      if (navigator.xr) {
        navigator.xr.isSessionSupported("immersive-ar").then((supported) => {
          xrButton.enabled = supported;
        });
      }
    }
    // 请求会话
    function onRequestSession() {
      return navigator.xr
        .requestSession("immersive-ar", {
          requiredFeatures: ["local", "hit-test"],
        })
        .then((session) => {
          // 如果请求成功则设置 AR Session
          xrButton.setSession(session);
          onSessionStarted(session);
        });
    }
    function onSessionStarted(session) {
      session.addEventListener("end", onSessionEnded);
      // 添加select事件监听器。当用户点击屏幕时，将基于标线的位置将花朵放置在相机视图中。
      session.addEventListener("select", onSelect);
      if (!gl) {
        gl = createWebGLContext({
          xrCompatible: true,
        });
        // 设置渲染器
        renderer = new Renderer(gl);
        scene.setRenderer(renderer);
      }
      session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
      // In this sample we want to cast a ray straight out from the viewer's
      // position and render a reticle where it intersects with a real world
      // surface. To do this we first get the viewer space, then create a
      // hitTestSource that tracks it.
      // 该参考空间用于命中测试，要测量与控制器的距离，可以使用以控制器为中心的参考系
      session.requestReferenceSpace("viewer").then((refSpace) => {
        xrViewerSpace = refSpace;
        session
          .requestHitTestSource({ space: xrViewerSpace })
          .then((hitTestSource) => {
            xrHitTestSource = hitTestSource;
          });
      });
      // 在屏幕上绘制某些内容，需使用以用户为中心的坐标
      session.requestReferenceSpace("local").then((refSpace) => {
        xrRefSpace = refSpace;
        // 开始帧循环
        session.requestAnimationFrame(onXRFrame);
      });
    }
    function onEndSession(session) {
      xrHitTestSource.cancel();
      xrHitTestSource = null;
      session.end();
    }
    function onSessionEnded(event) {
      xrButton.setSession(null);
    }
    // Adds a new object to the scene at the
    // specificed transform.
    // 将一朵新花加入场景
    function addARObjectAt(matrix) {
      let newFlower = arObject.clone();
      newFlower.visible = true;
      newFlower.matrix = matrix;
      scene.addNode(newFlower);
      flowers.push(newFlower);
      // For performance reasons if we add too many objects start
      // removing the oldest ones to keep the scene complexity
      // from growing too much.
      if (flowers.length > MAX_FLOWERS) {
        let oldFlower = flowers.shift();
        scene.removeNode(oldFlower);
      }
    }
    let rayOrigin = vec3.create();
    let rayDirection = vec3.create();
    function onSelect(event) {
      if (reticle.visible) {
        // The reticle should already be positioned at the latest hit point,
        // so we can just use it's matrix to save an unnecessary call to
        // event.frame.getHitTestResults.
        addARObjectAt(reticle.matrix);
      }
    }
    // Called every time a XRSession requests that a new frame be drawn.
    // 重绘一帧时调用
    function onXRFrame(t, frame) {
      // 获取AR会话
      let session = frame.session;
      // 获取渲染所需位姿
      // Get the viewer's pose.
      let pose = frame.getViewerPose(xrRefSpace);
      // 将上一个标线隐去
      reticle.visible = false;
      // If we have a hit test source, get its results for the frame
      // and use the pose to display a reticle in the scene.
      // 如果命中测试源都存在，则用摄像机位姿信息在场景中显示标线，要在AR中绘制任何内容，需要知道观看者在哪里以及他们在看什么
      if (xrHitTestSource && pose) {
        // 获取命中测试结果，返回平面数据数组
        // 数组中的第一个是距离相机最近的那个。如果没有返回命中结果，则继续在下一帧中再试一次。
        let hitTestResults = frame.getHitTestResults(xrHitTestSource);
        if (hitTestResults.length > 0) {
          // 从最近的命中测试结果中获取姿势，将标线图像转换（移动）到命中测试位置，然后将其visible属性设置为true。
          // 姿势表示表面上点的姿势。
          let pose = hitTestResults[0].getPose(xrRefSpace);
          reticle.visible = true;
          reticle.matrix = pose.transform.matrix;
        }
      }
      scene.startFrame();
      session.requestAnimationFrame(onXRFrame);
      scene.drawXRFrame(frame, pose);
      scene.endFrame();
    }
    // Start the XR application.
    initXR();
  },
};
</script>
<style scoped>
header {
  position: relative;
  z-index: 2;
  left: 0px;
  text-align: left;
  max-width: 420px;
  padding: 0.5em;
  background-color: rgba(255, 255, 255, 0.9);
  margin-bottom: 0.5em;
  border-radius: 2px;
}
details summary {
  font-size: 1em;
  font-weight: bold;
}
details[open] summary {
  font-size: 1.4em;
  font-weight: bold;
}
header h1 {
  margin-top: 0px;
}
canvas {
  position: absolute;
  z-index: 0;
  width: 100%;
  height: 100%;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  margin: 0;
  touch-action: none;
}
.back {
  float: right;
  text-decoration: none;
}
.back:hover {
  text-decoration: underline;
}
.back::before {
  display: inline-block;
  content: attr(data-index) "<";
  font-weight: bold;
  white-space: nowrap;
  margin-right: 0.2em;
  margin-left: 0.2em;
}
/* Used for the 'barebones' samples */
.barebones-button {
  font-family: "Karla", sans-serif;
  border: rgb(80, 168, 252) 2px solid;
  border-radius: 2px;
  box-sizing: border-box;
  background: none;
  height: 55px;
  min-width: 176px;
  display: inline-block;
  position: relative;
  cursor: pointer;
  font-size: 18px;
  color: rgb(80, 168, 252);
  background-color: rgba(255, 255, 255, 0.7);
}
</style>
