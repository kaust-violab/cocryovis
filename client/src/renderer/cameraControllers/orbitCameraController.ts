import type { Camera } from "@/renderer/core/camera";
import { clamp } from "../utilities/math";
import { CameraController } from "./cameraController";

export class OrbitCameraController extends CameraController {
  private static readonly MOUSE_BUTTON = 2;

  minDistance = 1;
  maxDistance = 50;
  minPolarAngleRadians = 0.01;
  maxPolarAngleRadians = Math.PI - 0.01;
  rotateSpeed = 0.005;
  zoomSpeed = 0.002;

  private azimuthalAngleRadians = Math.PI;
  private polarAngleRadians = Math.PI / 2;

  private isDragging = false;
  private lastX = 0;
  private lastY = 0;
  private active = true;

  constructor(
    private camera: Camera,
    private domElement: HTMLElement,
    private radius: number
  ) {
    super();
    this.addEventListeners();
    this.updateCamera();
  }

  setRadius(radius: number) {
    this.radius = radius;
  }

  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    this.isDragging = false;
  }

  private addEventListeners() {
    this.domElement.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
    this.domElement.addEventListener("wheel", this.onWheel, { passive: false });
  }

  dispose() {
    this.domElement.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);
    this.domElement.removeEventListener("wheel", this.onWheel);
  }

  private onMouseDown = (e: MouseEvent) => {
    if (e.button !== OrbitCameraController.MOUSE_BUTTON || !this.active) return;

    this.isDragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.isDragging || !this.active) return;

    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;

    this.azimuthalAngleRadians -= dx * this.rotateSpeed;
    this.polarAngleRadians -= dy * this.rotateSpeed;

    this.polarAngleRadians = clamp(
      this.polarAngleRadians,
      this.minPolarAngleRadians,
      this.maxPolarAngleRadians
    );

    this.lastX = e.clientX;
    this.lastY = e.clientY;

    this.updateCamera();
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button !== OrbitCameraController.MOUSE_BUTTON) return;

    this.isDragging = false;
  };

  private onWheel = (e: WheelEvent) => {
    if (e.shiftKey || !this.active) return;

    e.preventDefault();

    this.radius += e.deltaY * this.zoomSpeed;
    this.radius = clamp(this.radius, this.minDistance, this.maxDistance);

    this.updateCamera();
  };

  private updateCamera() {
    const sinPhi = Math.sin(this.polarAngleRadians);

    const x =
      this.camera.viewCenter[0] +
      this.radius * sinPhi * Math.sin(this.azimuthalAngleRadians);
    const y =
      this.camera.viewCenter[1] +
      this.radius * Math.cos(this.polarAngleRadians);
    const z =
      this.camera.viewCenter[2] +
      this.radius * sinPhi * Math.cos(this.azimuthalAngleRadians);

    this.camera.setParameters({
      position: [x, y, z],
    });
  }
}
