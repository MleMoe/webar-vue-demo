<template>
  <header>
    <h1>Web AR 测试</h1>
    <p>需往四周移动摄像头，等待数秒，以学习周围环境知识。</p>
    <p>
      【支持设备】：安卓 chrome 浏览器（版本81+）或 chrome canary。 搜索
      chrome://flags，将 WebXR incubations，设为启用
    </p>
    <div id="btn-container"></div>
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
export default {
  name: "BasicAR",
  mounted() {
    let xrButton = null; // 提示按钮
    let xrRefSpace = null; // 用于绘制的参考空间，the XRReferenceSpace can be used to establish a spatial relationship with the user’s physical environment.
    let xrViewerSpace = null; // 用于命中测试的参考空间
    let xrHitTestSource = null; // 命中测试控制句柄

    let gl = null;
    let renderer = null;
    let scene = new Scene();
    scene.enableStats(false);

    let arObject = new Node(); // 容器节点，用于放置花节点
    arObject.visible = false;
    scene.addNode(arObject);
    let flower = new Gltf2Node({ url: "gltf/sunflower/sunflower.gltf" }); // 花节点
    arObject.addNode(flower); // 将花节点加入容器
    let shadow = new DropShadowNode(); // 加阴影
    vec3.set(shadow.scale, 0.15, 0.15, 0.15);
    arObject.addNode(shadow);

    const MAX_FLOWERS = 30; // 最大花数量
    let flowers = []; // 数组，用来暂存花对象的引用，以判断花的数量，以及便于删除多余的花

    let reticle = new Gltf2Node({ url: "gltf/reticle/reticle.gltf" }); // 标线图像
    reticle.visible = false;
    scene.addNode(reticle);

    scene.clear = false; // 背景透明，AR需要3D物体与现实场景结合

    /**
     * 初始化 XR 内容
     */
    function initXR() {
      // 提示按钮
      xrButton = new WebXRButton({
        onRequestSession: onRequestSession, // 请求会话
        onEndSession: onEndSession, //终止会话
        textEnterXRTitle: "开始 AR",
        textXRNotFoundTitle: "此设备不支持AR",
        textExitXRTitle: "退出 AR",
      });

      document.querySelector("#btn-container").appendChild(xrButton.domElement); // 将提示按钮加入dom中
      // 若浏览器支持 navigator.xr，即拥有 the XRSystem object
      if (navigator.xr) {
        // 判断设备和浏览器是否支持该 XR 类型，这里是 immersive-ar
        navigator.xr.isSessionSupported("immersive-ar").then((supported) => {
          xrButton.enabled = supported; // 根据检测结果设定是否支持
        });
      }
    }

    /**
     * 请求会话
     */
    function onRequestSession() {
      return navigator.xr
        .requestSession("immersive-ar", {
          requiredFeatures: ["local", "hit-test"],
        })
        .then((session) => {
          xrButton.setSession(session); // 设置 AR Session
          onSessionStarted(session);
        });
    }

    /**
     * 开始会话
     */
    function onSessionStarted(session) {
      session.addEventListener("end", onSessionEnded);
      session.addEventListener("select", onSelect); // 添加select事件监听器。当用户点击屏幕时，将基于标线的位置将花朵放置在相机视图中。

      if (!gl) {
        gl = createWebGLContext({
          xrCompatible: true,
        });
        // 设置渲染器
        renderer = new Renderer(gl);
        scene.setRenderer(renderer);
      }
      session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
      // 该参考空间用于命中测试，要测量与控制器的距离，可以使用以控制器为中心的参考系
      // 其原始位置跟踪查看者的位置和方向。它用于用户可以在其中进行物理移动的环境
      session.requestReferenceSpace("viewer").then((refSpace) => {
        xrViewerSpace = refSpace;
        session
          .requestHitTestSource({ space: xrViewerSpace })
          .then((hitTestSource) => {
            xrHitTestSource = hitTestSource;
          });
      });
      // 在屏幕上绘制某些内容，需使用以用户为中心的坐标
      // The requestReferenceSpace(type) method constructs a new XRReferenceSpace of a given type
      // local 类型，创建会话时其原始位置位于查看者位置附近的跟踪空间。确切位置取决于基础平台和实现。用户不会移动太多，甚至不会超出他们的起始位置。所以用来绘制模型
      session.requestReferenceSpace("local").then((refSpace) => {
        xrRefSpace = refSpace;
        // 开始帧循环
        session.requestAnimationFrame(onXRFrame);
      });
    }

    /**
     * 结束会话
     */
    function onEndSession(session) {
      xrHitTestSource.cancel();
      xrHitTestSource = null;
      session.end();
    }
    function onSessionEnded(event) {
      xrButton.setSession(null);
    }

    /**
     * 选择事件回调函数
     */
    function onSelect(event) {
      if (reticle.visible) {
        addARObjectAt(reticle.matrix);
      }
    }
    /**
     * 将一朵新花加入场景
     */
    function addARObjectAt(matrix) {
      let newFlower = arObject.clone();
      newFlower.visible = true;
      newFlower.matrix = matrix;
      scene.addNode(newFlower);
      flowers.push(newFlower);
      if (flowers.length > MAX_FLOWERS) {
        let oldFlower = flowers.shift();
        scene.removeNode(oldFlower);
      }
    }

    /**
     * 每次绘制一帧时调用
     */
    function onXRFrame(t, frame) {
      // 获取AR会话
      let session = frame.session;
      // 获取渲染所需位姿
      let pose = frame.getViewerPose(xrRefSpace);
      // 将上一个标线隐去
      reticle.visible = false;
      // 如果命中测试源都存在，则用摄像机位姿信息在场景中显示标线。要在AR中绘制任何内容，需要知道观看者在哪里以及其观察方向
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
    initXR();
  },
};
</script>
<style scoped>
header {
  z-index: 2;
  display: flex;
  justify-content: center;
  flex-direction: column;
  position: relative;
  max-width: 500px;
  margin: 0 auto;
}

header h1 {
  margin-top: 0px;
}

header div {
  align-items: center;
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
</style>
