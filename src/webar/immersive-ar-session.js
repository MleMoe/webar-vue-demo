import { WebXRButton } from './js/util/webxr-button.js';
import { Scene } from './js/render/scenes/scene.js';
import { Renderer, createWebGLContext } from './js/render/core/renderer.js';
import { SkyboxNode } from './js/render/nodes/skybox.js';
import { InlineViewerHelper } from './js/util/inline-viewer-helper.js';
import { Gltf2Node } from './js/render/nodes/gltf2.js';
import { QueryArgs } from './js/util/query-args.js';

// If requested, use the polyfill to provide support for mobile devices
// and devices which only support WebVR.
import WebXRPolyfill from './js/third-party/webxr-polyfill/build/webxr-polyfill.module.js';
if (QueryArgs.getBool('usePolyfill', true)) {
    let polyfill = new WebXRPolyfill();
}

// XR globals.
let xrButton = null;
let xrImmersiveRefSpace = null;
let inlineViewerHelper = null;

// WebGL scene globals.
let gl = null;
let renderer = null;
let scene = new Scene();
let solarSystem = new Gltf2Node({ url: 'media/gltf/space/space.gltf' });
// The solar system is big (citation needed). Scale it down so that users
// can move around the planets more easily.
solarSystem.scale = [0.1, 0.1, 0.1];
scene.addNode(solarSystem);
// Still adding a skybox, but only for the benefit of the inline view.
let skybox = new SkyboxNode({ url: 'media/textures/milky-way-4k.png' });
scene.addNode(skybox);

function initXR() {
    xrButton = new WebXRButton({
        onRequestSession: onRequestSession,
        onEndSession: onEndSession,
        textEnterXRTitle: "START AR",
        textXRNotFoundTitle: "AR NOT FOUND",
        textExitXRTitle: "EXIT  AR",
    });
    document.querySelector('header').appendChild(xrButton.domElement);

    if (navigator.xr) {
        // Checks to ensure that 'immersive-ar' mode is available, and only
        // enables the button if so.
        navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
            xrButton.enabled = supported;
        });

        navigator.xr.requestSession('inline').then(onSessionStarted);
    }
}

function onRequestSession() {
    // Requests an 'immersive-ar' session, which ensures that the users
    // environment will be visible either via video passthrough or a
    // transparent display. This may be presented either in a headset or
    // fullscreen on a mobile device.
    return navigator.xr.requestSession('immersive-ar')
        .then((session) => {
            xrButton.setSession(session);
            session.isImmersive = true;
            onSessionStarted(session);
        });
}

function initGL() {
    if (gl)
        return;

    gl = createWebGLContext({
        xrCompatible: true
    });
    document.body.appendChild(gl.canvas);

    function onResize() {
        gl.canvas.width = gl.canvas.clientWidth * window.devicePixelRatio;
        gl.canvas.height = gl.canvas.clientHeight * window.devicePixelRatio;
    }
    window.addEventListener('resize', onResize);
    onResize();

    renderer = new Renderer(gl);

    scene.setRenderer(renderer);
}

function onSessionStarted(session) {
    session.addEventListener('end', onSessionEnded);

    if (session.isImmersive) {
        // When in 'immersive-ar' mode don't draw an opaque background because
        // we want the real world to show through.
        skybox.visible = false;
    }

    initGL();

    session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });

    let refSpaceType = session.isImmersive ? 'local' : 'viewer';
    session.requestReferenceSpace(refSpaceType).then((refSpace) => {
        if (session.isImmersive) {
            xrImmersiveRefSpace = refSpace;
        } else {
            inlineViewerHelper = new InlineViewerHelper(gl.canvas, refSpace);
        }
        session.requestAnimationFrame(onXRFrame);
    });
}

function onEndSession(session) {
    session.end();
}

function onSessionEnded(event) {
    if (event.session.isImmersive) {
        xrButton.setSession(null);
        // Turn the background back on when we go back to the inlive view.
        skybox.visible = true;
    }
}

// Called every time a XRSession requests that a new frame be drawn.
function onXRFrame(t, frame) {
    let session = frame.session;
    let refSpace = session.isImmersive ?
        xrImmersiveRefSpace :
        inlineViewerHelper.referenceSpace;
    let pose = frame.getViewerPose(refSpace);

    scene.startFrame();

    session.requestAnimationFrame(onXRFrame);

    scene.drawXRFrame(frame, pose);

    scene.endFrame();
}

// Start the XR application.
initXR();