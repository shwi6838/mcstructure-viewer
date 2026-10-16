"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { colorForBlock } from "../lib/blockColors";
import {
  loadBlockTextureAtlas,
  buildTexturedBoxGeometry,
} from "../lib/blockTextures";
import { buildShapeGeometry, applyPillarAxis } from "../lib/blockShapes";
import {
  centerOffset,
  buildBlockLookup,
  findUntexturedBlocks,
  countBlockNames,
  groupTexturedBlocks,
} from "../lib/structureLayout";

function placeInstances(meshRef, blocks, size) {
  if (!meshRef.current) return;
  const dummy = new THREE.Object3D();
  const offset = centerOffset(size);
  blocks.forEach((block, i) => {
    dummy.position.set(
      block.x + offset.x,
      block.y + offset.y,
      block.z + offset.z
    );
    dummy.updateMatrix();
    meshRef.current.setMatrixAt(i, dummy.matrix);
  });
  meshRef.current.instanceMatrix.needsUpdate = true;
}

// Viewing direction used when framing: a slightly raised corner view.
const FRAME_DIRECTION = new THREE.Vector3(1, 0.8, 1).normalize();
// Extra breathing room around the structure (1 = touching the edges).
const FRAME_MARGIN = 1.15;

/**
 * Positions the camera so the whole structure fits in view, and aims the
 * orbit controls at its center. Re-runs when a new structure loads or when
 * `resetKey` changes. It deliberately does NOT re-run on resize, so it
 * won't undo the user's orbiting.
 */
function AutoFrame({ size, resetKey }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls);
  const get = useThree((state) => state.get);

  useEffect(() => {
    // OrbitControls (makeDefault) registers itself after first render;
    // this effect re-runs once it's available.
    if (!controls) return;

    const viewport = get().size;
    const aspect = viewport.width / Math.max(1, viewport.height);

    const radius =
      0.5 * Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z);

    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const fitFov = Math.min(verticalFov, horizontalFov);

    const distance = (radius / Math.sin(fitFov / 2)) * FRAME_MARGIN;

    camera.position.copy(FRAME_DIRECTION).multiplyScalar(distance);
    camera.near = 0.1;
    camera.far = Math.max(1000, distance * 10);
    camera.updateProjectionMatrix();

    controls.target.set(0, 0, 0);
    controls.update();
  }, [size, resetKey, controls, camera, get]);

  return null;
}

// One InstancedMesh per (shape category, orientation, connection pattern,
// exact UV set) group, sharing the atlas texture but each with its own
// geometry - a full cube for most blocks, or a slab/stairs/torch/etc.
// silhouette, correctly rotated/positioned where applicable.
function TexturedBlockGroup({
  blocks,
  size,
  faceUVs,
  atlasTexture,
  category,
  connections,
  states,
}) {
  const meshRef = useRef();

  const { geometry, doubleSided } = useMemo(() => {
    if (category === "full_cube") {
      const geo = buildTexturedBoxGeometry(faceUVs);
      applyPillarAxis(geo, states);
      return { geometry: geo, doubleSided: false };
    }
    return buildShapeGeometry(category, faceUVs, { connections, states });
  }, [faceUVs, category, connections, states]);

  useEffect(() => {
    placeInstances(meshRef, blocks, size);
  }, [blocks, size]);

  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, blocks.length]}>
      <meshStandardMaterial
        map={atlasTexture}
        alphaTest={0.5}
        side={doubleSided ? THREE.DoubleSide : THREE.FrontSide}
      />
    </instancedMesh>
  );
}

// Flat-colored fallback for anything we couldn't map to a real texture -
// always a full cube, regardless of shape, since without a resolved
// texture there's nothing to UV-map onto a custom shape anyway.
function FallbackColorBlocks({ blocks, size }) {
  const meshRef = useRef();

  useEffect(() => {
    if (!meshRef.current || blocks.length === 0) return;
    const color = new THREE.Color();
    placeInstances(meshRef, blocks, size);
    blocks.forEach((block, i) => {
      color.set(colorForBlock(block.name));
      meshRef.current.setColorAt(i, color);
    });
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  }, [blocks, size]);

  if (blocks.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, blocks.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial />
    </instancedMesh>
  );
}

/**
 * Shared structure viewer - used by the workshop and (later) the embeddable
 * component. It renders only the 3D scene; all surrounding UI (file input,
 * stats, lists) belongs to the host.
 *
 * Props
 *   data      Parsed structure from parseMcstructureFile:
 *             { size: {x,y,z}, blocks: [...] }. Pass null for an empty scene.
 *   onStatus  Optional callback, called whenever texture state changes, with:
 *             { texturesLoading, textureError, texturedCount,
 *               untexturedCount, untexturedCounts: [[name, count], ...] }
 *   style, className   Applied to the root element.
 *
 * Sizing
 *   Fills its parent (width/height 100%). The parent must have a size; the
 *   canvas tracks it automatically as it changes.
 *
 * Ref handle
 *   resetView()  Re-frames the camera on the whole structure.
 */
const StructureViewer = forwardRef(function StructureViewer(
  { data = null, onStatus, style, className },
  ref
) {
  const [textureAssets, setTextureAssets] = useState(null);
  const [texturesLoading, setTexturesLoading] = useState(false);
  const [textureError, setTextureError] = useState(null);
  const [resetKey, setResetKey] = useState(0);

  useImperativeHandle(
    ref,
    () => ({ resetView: () => setResetKey((k) => k + 1) }),
    []
  );

  // Load textures whenever a new structure arrives. The cancelled flag
  // keeps a slow load for an old structure from overwriting a newer one.
  useEffect(() => {
    setTextureAssets(null);
    setTextureError(null);
    if (!data) {
      setTexturesLoading(false);
      return;
    }

    let cancelled = false;
    setTexturesLoading(true);
    loadBlockTextureAtlas(data.blocks)
      .then((assets) => {
        if (!cancelled) setTextureAssets(assets);
      })
      .catch((err) => {
        console.error("Falling back to flat colors:", err);
        if (!cancelled) setTextureError(err);
      })
      .finally(() => {
        if (!cancelled) setTexturesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [data]);

  const blockLookup = useMemo(
    () => (data ? buildBlockLookup(data.blocks) : null),
    [data]
  );

  const fallbackBlocks = useMemo(
    () => (data ? findUntexturedBlocks(data.blocks, textureAssets) : []),
    [data, textureAssets]
  );

  const untexturedCounts = useMemo(
    () => countBlockNames(fallbackBlocks),
    [fallbackBlocks]
  );

  const texturedGroups = useMemo(
    () =>
      data ? groupTexturedBlocks(data.blocks, textureAssets, blockLookup) : [],
    [data, textureAssets, blockLookup]
  );

  // Report texture status to the host. The callback lives in a ref so an
  // inline function from the parent doesn't retrigger this effect.
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  useEffect(() => {
    if (!data) {
      onStatusRef.current?.(null);
      return;
    }
    onStatusRef.current?.({
      texturesLoading,
      textureError,
      texturedCount: data.blocks.length - fallbackBlocks.length,
      untexturedCount: fallbackBlocks.length,
      untexturedCounts,
    });
  }, [data, texturesLoading, textureError, fallbackBlocks, untexturedCounts]);

  return (
    <div
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", ...style }}
    >
      <Canvas camera={{ position: [20, 20, 20], fov: 50 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 20, 10]} intensity={1} />
        {data && (
          <>
            <AutoFrame size={data.size} resetKey={resetKey} />
            {texturedGroups.map(
              ({ key, category, connections, states, faceUVs, blocks }) => (
                <TexturedBlockGroup
                  key={key}
                  blocks={blocks}
                  size={data.size}
                  faceUVs={faceUVs}
                  atlasTexture={textureAssets.atlasTexture}
                  category={category}
                  connections={connections}
                  states={states}
                />
              )
            )}
            <FallbackColorBlocks
              key={`fallback-${fallbackBlocks.length}-${texturesLoading}`}
              blocks={fallbackBlocks}
              size={data.size}
            />
          </>
        )}
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  );
});

export default StructureViewer;