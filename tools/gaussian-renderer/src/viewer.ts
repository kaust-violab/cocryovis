//harness init + adapter info
import { Harness } from "./harness";
import { configFromPreset, loadPresets, type DisplayPreset } from "./presets";
import { addSelect } from "./panel";
import { LookMode } from "@/renderer/gaussian/extParametersBuffer";
import { GaussianVolumePass } from "@/renderer/gaussian/gaussianVolumePass"; //@/ is client dir
import { FullscreenComposite } from "@/renderer/core/fullscreenComposite";
import { GpuTimer } from "@/renderer/gaussian/gpuTimer";
import { FreeOrbitCameraController } from "@/renderer/cameraControllers/freeOrbitCameraController";
import { Accumulator } from "./accumulator";


// status line and canvas of viewer.html, "!" = it exists, "as" = it is a canvas
const info = document.getElementById("info")!;
const canvas = document.getElementById("view") as HTMLCanvasElement;
// the right mouse button rotates the camera, so the browser menu must not open on the canvas
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// harness: device, camera, parameter buffers, transfer functions, scene loading
const h = new Harness();
const SIZE = 1024; //same as the baseline table
const MEDIAN_FRAMES = 30; //timed frames that goes into the median
// how many frames are averaged while the camera rests (grain falls with the square root: 64 frames = 8 times less)
const ACCUM_FRAMES = 64;

// errors: on the page and in the terminal
function showError(e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    info.textContent = "ERROR: " + message;
    console.error("viewer:", message);
}

function status(text: string)
{
    info.textContent = text;
    console.log(text)
}

// middle value of a list (average of the two middle values if the count is even)
function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main()
{
    // adapter, device (with gpu timers if available) and all parameter buffers
    const a = await h.init();
    const gpu = `adapter ${a.vendor} / ${a.architecture}, timestamp-query ${a.timestampQuery}`;
    // if windows resets the gpu (a frame took longer than ~2 s: DXGI_ERROR_DEVICE_HUNG) the device is gone for good
    let lost = false;
    h.device.lost.then((l) => {
      if (l.reason === "destroyed") return; // closed by us (page closing), not an error
      lost = true;
      info.textContent = `ERROR: gpu device lost (${l.message}). close the viewer (ctrl+c) and open it again`;
    });

    // the scene and how to show it: ?scene=<name> in the address (node jobs/viewer.mjs <name>), else the first preset
    const presets = loadPresets();
    if (!presets.length) throw new Error("no display presets: open the viewer with node jobs/viewer.mjs");
    const wanted = new URLSearchParams(location.search).get("scene");
    let preset = presets.find((p) => p.scene === wanted) ?? presets[0];
    let look: "fast" | "reference" = "reference";

    // connect the canvas to the device, in the pixel format the screen prefers
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    const context = canvas.getContext("webgpu")!;
    context.configure({ device: h.device, format: canvasFormat, alphaMode: "opaque" });

    // everything that depends on the scene: loadScene() makes it again when the scene menu changes
    let scene = { count: 0 };
    let pass!: GaussianVolumePass; // "!" = loadScene() assigns it before the first frame
    let accum!: Accumulator;
    let composite!: FullscreenComposite;
    let orbit: FreeOrbitCameraController | undefined;
    let loading = false; // true while a scene loads: tick() draws nothing
    async function loadScene() {
    loading = true;
    // the frame in flight still reads the old buffers: let the gpu finish before destroying them
    await h.device.queue.onSubmittedWorkDone();
    orbit?.dispose(); // remove its mouse listeners
    pass?.destroy();
    accum?.destroy();

    // download the scene, upload it to the gpu and build the grid (takes a few seconds)
    status(`viewer: ${gpu}, loading ${preset.scene}…`);
    scene = await h.loadGaussians(`/data/scenes/${preset.scene}.json`);

    // camera, render parameters, look and transfer functions into their buffers
    h.applyCommon(configFromPreset(preset, look, SIZE));
    // mouse control of the cocryovis client: right-button drag rotates around the view center, wheel zooms
    // it starts from the camera applyCommon just set (whole) and moves h.camera, which the pass reads every frame
    // (the 3 is a start radius that the controller replaces with the real camera distance)
    orbit = new FreeOrbitCameraController(h.camera, canvas, 3);

    // the marched pass, created once per scene: framebuffer, bindings and pipeline (shader compile)
    pass = new GaussianVolumePass({
    device: h.device,
    width: SIZE,
    height: SIZE,
    format: "rgba8unorm", // same format as the harness, so the image is the same
    camera: h.camera,
    ...h.managers, // volumeManager, annotationManager, clippingPlaneManager
    renderingParameters: h.renderingParameters,
    extParameters: h.extParameters,
    field: { kind: "gaussian", scene: h.scene! },
    });

    // running average of the pass frames (rgba16float), restarted whenever the camera moves
    accum = new Accumulator(h.device, pass.framebuffer, SIZE, SIZE);
    // copies the averaged image to the canvas with one full-screen triangle
    composite = new FullscreenComposite(h.device, canvasFormat, accum.target);
    loading = false;
    }
    await loadScene();
    // random seed of the reference look: a new one every frame, so the frames differ and their average converges
    let seed = 0;

  // gpu stopwatch for the marched pass, only if the device has timestamp-query
  const timer = h.canTime ? new GpuTimer(h.device) : undefined;
  const samples: number[] = []; // last MEDIAN_FRAMES pass times in ms
  let timedFrames = 0; // all timed frames so far, the first one included
  let frames = 0; // all drawn frames
  // redraw only when something changed: the camera tells us when it moves
  let dirty = true; // true at the start, the first frame must be drawn
  h.camera.observable.observe(() => {
    dirty = true;
  });

  // one frame at a time: true from submit until the gpu has finished that frame
  let inFlight = false;

  // the fast look ignores frameSeed (guide, Q1): its frames are all equal, so one frame is the final image
  const accumFrames = () => (look === "reference" ? ACCUM_FRAMES : 1);

  // one gpu time arrives: skip the first frame (shader compile) and negative values (counter reset)
  function record(ms: number) {
    timedFrames++;
    if (timedFrames === 1 || ms < 0) return;
    samples.push(ms);
    if (samples.length > MEDIAN_FRAMES) samples.shift(); // keep only the newest ones
    // every MEDIAN_FRAMES timed frames, one line in the terminal to copy the number
    if (timedFrames % MEDIAN_FRAMES === 1) {
      console.log(`viewer: ${preset.scene}, ${look}, marched pass ${median(samples).toFixed(2)} ms (gpu, median of ${samples.length} frames)`);
    }
  }

  // one frame: the pass draws into its framebuffer, then the composite copies it to the canvas
  function frame() {
    const encoder = h.device.createCommandEncoder();
    // new random numbers for this frame (ray jitter, occlusion and shadow samples)
    seed++;
    h.extParameters.set({ frameSeed: seed });

    // time this frame only if the stopwatch is free (its read buffer is not busy)
    const timed = timer !== undefined && timer.ready;
    pass.render(encoder, [0, 0, 0, 1], timed ? timer : undefined);
    if (timed) timer.resolve(encoder); // copy the two timestamps to the read buffer
    // add this frame to the average (weight 1/n)
    accum.add(encoder);

    const screen = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(), // the canvas image of this frame
          clearValue: [0, 0, 0, 1],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    composite.render(screen);
    screen.end();
    h.device.queue.submit([encoder.finish()]);
    // the next frame waits until the gpu has finished this one (no queue of old frames, no lag)
    inFlight = true;
    h.device.queue.onSubmittedWorkDone().then(() => {//waits till gpu is finished
      inFlight = false;
    });

    // the gpu time arrives later, when the gpu has finished this frame
    if (timed) timer.read().then(record).catch(() => {});

    frames++;
    const time = samples.length
      ? `marched pass ${median(samples).toFixed(2)} ms (gpu, median of ${samples.length})`
      : timer ? "measuring…" : "no gpu timer (timestamp-query missing)";
    info.textContent = `viewer: ${gpu}, ${preset.scene} ${scene.count} gaussians, frame ${frames}, averaged ${accum.count}/${accumFrames()}, ${time}`;
  }
  
  // runs at every screen refresh; draws if the camera moved or the average is not complete, and the gpu is free
  function tick() {
    if (!loading && !lost && !inFlight && (dirty || accum.count < accumFrames())) {
      if (dirty) accum.reset(); // the camera moved: start a new average
      dirty = false; // cleared before drawing: a camera move during this frame sets it again
      frame();
    }
    requestAnimationFrame(tick);
  }

  // side panel: scene (loads it again) and look (only a uniform, no reload)
  const panel = document.getElementById("panel")!;
  const sceneMenu = addSelect(panel, "scene", presets.map((p) => ({ value: p.scene, label: p.scene })), preset.scene, (value) => {
    preset = presets.find((p) => p.scene === value)!;
    samples.length = 0; // times of the old scene do not count
    timedFrames = 0;
    sceneMenu.disabled = true; // no second change while this scene loads
    loadScene()
      .then(() => status(`viewer: ${gpu}, ${preset.scene} ${scene.count} gaussians, drawing…`))
      .catch((e) => (info.textContent = `ERROR: ${e instanceof Error ? e.message : e}`))
      .finally(() => (sceneMenu.disabled = false));
  });
  addSelect(panel, "look", [{ value: "reference", label: "reference" }, { value: "fast", label: "fast (cocryovis)" }], look, (value) => {
    look = value as "fast" | "reference";
    h.extParameters.set({ lookMode: look === "reference" ? LookMode.Reference : LookMode.Fast });
    samples.length = 0; // another look costs differently
    timedFrames = 0;
    dirty = true; // new image: start a new average
  });

  status(`viewer: ${gpu}, ${preset.scene} ${scene.count} gaussians, drawing…`);
  requestAnimationFrame(tick);
}

main().catch(showError);
