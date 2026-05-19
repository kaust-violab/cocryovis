import type { Camera } from "@/renderer/core/camera";
import { vec3, quat } from "gl-matrix";
import { clamp } from "../utilities/math";
import { CameraController } from "./cameraController";

export class FreeOrbitCameraController extends CameraController {
  private static readonly MOUSE_BUTTON = 2;

  minDistance = 1;
  maxDistance = 50;

  rotateSpeed = 0.005;
  zoomSpeed = 0.002;

  private offset = vec3.create(); // viewCenter -> camera
  private up = vec3.fromValues(0, 1, 0);

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

    this.initialize();
    this.addEventListeners();
    this.updateCamera();
  }

  private initialize() {
    vec3.subtract(this.offset, this.camera.position, this.camera.viewCenter);

    this.radius = vec3.length(this.offset);

    vec3.normalize(this.offset, this.offset);
  }

  setRadius(radius: number) {
    this.radius = radius;
    this.updateCamera();
  }

  setActive(active: boolean) {
    this.active = active;

    if (!active) {
      this.isDragging = false;
    }
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
    if (e.button !== FreeOrbitCameraController.MOUSE_BUTTON || !this.active) {
      return;
    }

    this.isDragging = true;

    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.isDragging || !this.active) {
      return;
    }

    const dx = (e.clientX - this.lastX) * this.rotateSpeed;

    const dy = -(e.clientY - this.lastY) * this.rotateSpeed;

    const q = quat.create();

    //
    // horizontal → local up
    //
    quat.setAxisAngle(q, this.up, -dx);

    vec3.transformQuat(this.offset, this.offset, q);

    //
    // recompute right
    //
    const right = vec3.create();

    vec3.cross(right, this.offset, this.up);

    vec3.normalize(right, right);

    //
    // vertical → local right
    //
    quat.setAxisAngle(q, right, -dy);

    vec3.transformQuat(this.offset, this.offset, q);

    vec3.transformQuat(this.up, this.up, q);

    vec3.normalize(this.offset, this.offset);

    vec3.normalize(this.up, this.up);

    this.lastX = e.clientX;
    this.lastY = e.clientY;

    this.updateCamera();
  };

  private onMouseUp = () => {
    this.isDragging = false;
  };

  private onWheel = (e: WheelEvent) => {
    if (e.shiftKey || !this.active) {
      return;
    }

    e.preventDefault();

    this.radius += e.deltaY * this.zoomSpeed;

    this.radius = clamp(this.radius, this.minDistance, this.maxDistance);

    this.updateCamera();
  };

  private updateCamera() {
    const position = vec3.create();

    vec3.scale(position, this.offset, this.radius);

    vec3.add(position, position, this.camera.viewCenter);

    this.camera.setParameters({
      position: [position[0], position[1], position[2]],
      up: [this.up[0], this.up[1], this.up[2]],
    });
  }
}
