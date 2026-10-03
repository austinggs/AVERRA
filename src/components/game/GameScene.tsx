'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  conditionRatio,
  machineTransform,
  visualForMachineState,
  type SceneMachine,
} from '@/lib/game/scene';

// The Mining Game 3D rendering layer (docs 17, 31).
//
// DOC 17 THREE.JS ROLE, quoted: "Three.js renders client presentation and
// interaction; it does not authoritatively decide inventory, rewards, progression,
// or energy." Nothing in this file writes game state. Every action still travels
// through `GameShell`'s existing POSTs, and every value rendered here came from
// `public.get_game_state`.
//
// LAW 26: a game resource is virtual. This scene renders no currency, no balance
// and no withdrawal, and deliberately contains no MoneyState import.
//
// DOC 17 PERFORMANCE is a requirement here, not a nicety, because this repository
// is mobile-first: device pixel ratio is capped, the render loop stops when the
// canvas scrolls out of view or the tab is hidden, and reduced-motion renders a
// single static frame.
//
// Every decision with arithmetic in it lives in src/lib/game/scene.ts and is unit
// tested. This file only draws.

interface GameSceneProps {
  machines: SceneMachine[];
  /** Accessible description, since a canvas conveys nothing to assistive tech. */
  label: string;
}

const MAX_PIXEL_RATIO = 2;

/** Deterministic colour per slot, so a machine keeps its colour between renders. */
const PALETTE = ['#1f8f4e', '#2f9e6f', '#3f8f5f', '#4f9e7f', '#5f8f9f'] as const;

export function GameScene({ machines, label }: GameSceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  // A ref, not state: the animation loop must always read current machines without
  // re-creating the WebGL context on every snapshot.
  const machinesRef = useRef<SceneMachine[]>(machines);

  useEffect(() => {
    machinesRef.current = machines;
  }, [machines]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      // No WebGL context. The DOM shell still works, so a missing 3D capability
      // never takes the page down. The caller renders a placeholder.
      return;
    }

    const width = mount.clientWidth || 320;
    const height = mount.clientHeight || 200;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.setSize(width, height, false);
    mount.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', label);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    camera.position.set(0, 4.5, 9);
    camera.lookAt(0, 0, 1);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(4, 8, 6);
    scene.add(key);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(9, 48),
      new THREE.MeshStandardMaterial({ color: 0x1f2a24, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const meshByMachineId = new Map<string, THREE.Mesh>();

    const disposeMesh = (mesh: THREE.Mesh) => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    };

    const syncMachines = () => {
      const current = machinesRef.current;
      const total = current.length;

      // Remove machines that no longer exist. Without this, stopping the last
      // machine leaves it on screen still spinning.
      const liveIds = new Set(current.map((m) => m.id));
      for (const [id, mesh] of meshByMachineId) {
        if (!liveIds.has(id)) {
          scene.remove(mesh);
          disposeMesh(mesh);
          meshByMachineId.delete(id);
        }
      }

      for (const machine of current) {
        let mesh = meshByMachineId.get(machine.id);

        if (!mesh) {
          mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.6, 0.7, 1.1, 20),
            new THREE.MeshStandardMaterial({
              color: PALETTE[Math.abs(machine.locationSlot) % PALETTE.length],
              roughness: 0.55,
              metalness: 0.15,
            }),
          );
          meshByMachineId.set(machine.id, mesh);
          scene.add(mesh);
        }

        const transform = machineTransform(machine.locationSlot, total);
        mesh.position.set(transform.x, 0.55, transform.z);

        const intent = visualForMachineState(machine.state);
        const material = mesh.material as THREE.MeshStandardMaterial;

        material.opacity = intent.dimmed ? 0.35 : 1;
        material.transparent = intent.dimmed;
        // Wear dulls a machine, so condition is legible without a label on every
        // mesh.
        material.roughness = 0.35 + (1 - conditionRatio(machine.condition)) * 0.5;

        mesh.scale.setScalar(1 + (machine.level - 1) * 0.08);
      }
    };

    syncMachines();

    const prefersReducedMotion =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;

    // Declared before `render`, which closes over them.
    const clock = new THREE.Clock();
    let visible = true;
    let frame: number | null = null;

    // DOC 17 LAYERS: animation is presentation. It reads the same snapshot the DOM
    // shell reads and never invents state.
    const render = () => {
      const elapsed = clock.getElapsedTime();

      for (const machine of machinesRef.current) {
        const mesh = meshByMachineId.get(machine.id);
        if (!mesh) continue;

        const intent = visualForMachineState(machine.state);
        // A BROKEN or LOCKED machine is not animated. A broken machine that keeps
        // spinning tells the player it is still working.
        if (!intent.animated) continue;

        mesh.rotation.y = elapsed * intent.spinRate;
        mesh.position.y =
          0.55 + Math.sin(elapsed * 1.5 + machine.locationSlot) * intent.bobAmplitude;
      }

      renderer.render(scene, camera);
    };

    if (prefersReducedMotion) {
      // One static frame: still accurate, no motion.
      render();
    } else {
      const loop = () => {
        if (visible) render();
        frame = window.requestAnimationFrame(loop);
      };
      loop();
    }

    const onVisibility = () => {
      visible = document.visibilityState === 'visible';
      // Reset the clock so a backgrounded tab does not jump on return.
      if (visible) clock.getDelta();
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Doc 17 PERFORMANCE: an off-screen scene costs nothing.
    const observer =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) => {
            visible =
              entries.some((entry) => entry.isIntersecting) &&
              document.visibilityState === 'visible';
          })
        : null;

    observer?.observe(mount);

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', onVisibility);
      observer?.disconnect();

      // Every geometry, material and the context itself is released, so navigating
      // away does not leak a WebGL context per visit.
      for (const mesh of meshByMachineId.values()) disposeMesh(mesh);
      meshByMachineId.clear();

      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();

      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [label]);

  return <div ref={mountRef} className="h-48 w-full sm:h-64" />;
}
