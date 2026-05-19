import { useEffect, useRef } from "react";
import useRenderer from "../../hooks/useRenderer";
import { makeStyles, Spinner } from "@fluentui/react-components";
import { observer } from "mobx-react-lite";
import { useMst } from "@/stores/RootStore";
import { CONFIG } from "@/constants";
import { useCanvasControls } from "@/hooks/useCanvasControls";
import Ruler from "./Ruler";
import { FreeOrbitCameraController } from "@/renderer/cameraControllers/freeOrbitCameraController";

const useStyles = makeStyles({
  canvasContainer: {
    position: "relative",
    width: "100%",
    height: "100%",
    padding: `5px`,
    boxSizing: "border-box",
  },
  canvas: {
    width: "100%",
    height: "100%",
    display: "block",
  },
  message: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
  },
});

const RendererCanvas = observer(() => {
  const rootStore = useMst();

  const classes = useStyles();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const { rendererRef, isPending, error } = useRenderer(canvasRef, {
    clearColor: [
      ...rootStore.uiState.renderSettings.clearColor.map((c) => c / 255),
      1,
    ],
    parameters: rootStore.uiState.renderSettings.getRendererParameters(),
    cameraParameters: rootStore.uiState.renderSettings.getCameraParameters(),
    onReady: (renderer) => {
      if (!canvasRef.current) {
        return;
      }
      rootStore.setRenderer(renderer);
      rootStore.setOrbitCameraController(
        new FreeOrbitCameraController(renderer.camera, canvasRef.current, 3)
      );
    },
  });

  const canvasControls = useCanvasControls({
    canvasRef,
    onDrag: (x, y) => {
      if (!rootStore.uiState.visualizedVolume) return;
      rootStore.renderer?.annotationManager.processAnnotation(
        x,
        y,
        !rootStore.uiState.visualizedVolume.eraseMode,
        rootStore.uiState.visualizedVolume.manualLabelIndex
      );
    },
    onMove: (x, y) => {
      if (!rootStore.uiState.visualizedVolume) return;
      rootStore.renderer?.annotationMarkerRenderer.setMousePosition(x, y);
    },
    onWheel: (direction, event) => {
      if (!event.shiftKey) return;
      rootStore.uiState.visualizedVolume?.changeClippingPlaneOffset(
        direction * CONFIG.clippingPlaneScrollSpeed
      );
    },
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      let { width, height } = entry.contentRect;
      width = Math.round(width);
      height = Math.round(height);

      canvas.width = width;
      canvas.height = height;

      rendererRef.current?.resize(width, height);
    });

    observer.observe(canvas);

    return () => {
      observer.disconnect();
    };
  }, [rendererRef]);

  return (
    <div className={classes.canvasContainer}>
      {isPending && (
        <Spinner className={classes.message} label={"Loading..."} />
      )}
      {error && <div className={classes.message}>{error}</div>}
      <canvas
        id="renderer-canvas"
        ref={canvasRef}
        className={classes.canvas}
        {...canvasControls}
      />
      <Ruler canvasRef={canvasRef} />
    </div>
  );
});

export default RendererCanvas;
