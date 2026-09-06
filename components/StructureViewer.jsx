"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { parseMcstructureFile } from "../lib/parseMcstructure";
import { colorForBlock } from "../lib/blockColors";
import {
  loadBlockTextureAtlas,
  buildTexturedBoxGeometry,
} from "../lib/blockTextures";

function centerOffset(size) {
  return { x: -size.x / 2, y: -size.y / 2, z: -size.z / 2 };
}

// One InstancedMesh per block type that has real textures resolved, sharing
// a single atlas texture but each with its own UV-mapped cube geometry.
function TexturedBlockGroup({ blocks, size, faceUVs, atlasTexture }) {
  const meshRef = useRef();
  const geometry = useMemo(() => buildTexturedBoxGeometry(faceUVs), [faceUVs]);

  useEffect(() => {
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
  }, [blocks, size]);

  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, blocks.length]}>
      <meshStandardMaterial map={atlasTexture} />
    </instancedMesh>
  );
}

// Flat-colored fallback for anything we couldn't map to a real texture
// (unmapped block names, fetch failures, no network access, etc.) - and the
// only path used at all until textures finish loading.
function FallbackColorBlocks({ blocks, size }) {
  const meshRef = useRef();

  useEffect(() => {
    if (!meshRef.current || blocks.length === 0) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const offset = centerOffset(size);

    blocks.forEach((block, i) => {
      dummy.position.set(
        block.x + offset.x,
        block.y + offset.y,
        block.z + offset.z
      );
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      color.set(colorForBlock(block.name));
      meshRef.current.setColorAt(i, color);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
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

export default function StructureViewer() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [textureAssets, setTextureAssets] = useState(null);
  const [texturesLoading, setTexturesLoading] = useState(false);

  async function handleFile(file) {
    setLoading(true);
    setError(null);
    setData(null);
    setTextureAssets(null);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const parsed = await parseMcstructureFile(arrayBuffer);
      if (parsed.blocks.length === 0) {
        setError("Parsed the file, but found no blocks to render.");
        return;
      }
      setData(parsed);

      setTexturesLoading(true);
      try {
        const uniqueNames = [...new Set(parsed.blocks.map((b) => b.name))];
        const assets = await loadBlockTextureAtlas(uniqueNames);
        setTextureAssets(assets);
      } catch (textureErr) {
        console.error("Falling back to flat colors:", textureErr);
      } finally {
        setTexturesLoading(false);
      }
    } catch (err) {
      console.error(err);
      setError(
        "Could not parse this file. Confirm it's an uncompressed .mcstructure export."
      );
    } finally {
      setLoading(false);
    }
  }

  const groupedByName = useMemo(() => {
    if (!data) return null;
    const map = new Map();
    data.blocks.forEach((b) => {
      if (!map.has(b.name)) map.set(b.name, []);
      map.get(b.name).push(b);
    });
    return map;
  }, [data]);

  const fallbackBlocks = useMemo(() => {
    if (!data) return [];
    if (!textureAssets) return data.blocks;
    return data.blocks.filter(
      (b) => !textureAssets.faceUVByBlock.has(b.name)
    );
  }, [data, textureAssets]);

  const texturedEntries = useMemo(() => {
    if (!groupedByName || !textureAssets) return [];
    return Array.from(groupedByName.entries()).filter(([name]) =>
      textureAssets.faceUVByBlock.has(name)
    );
  }, [groupedByName, textureAssets]);

  return (
    <div style={{ width: "100%", height: "100vh", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          zIndex: 10,
          padding: 16,
          background: "rgba(255,255,255,0.9)",
          borderRadius: 8,
          margin: 16,
        }}
      >
        <input
          type="file"
          accept=".mcstructure"
          onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
        />
        {loading && <p>Parsing structure…</p>}
        {error && <p style={{ color: "crimson" }}>{error}</p>}
        {data && (
          <p>
            {data.blocks.length.toLocaleString()} blocks · {data.size.x}×
            {data.size.y}×{data.size.z}
          </p>
        )}
        {texturesLoading && <p>Loading textures from bedrock-samples…</p>}
        {data && textureAssets && (
          <p>
            {(data.blocks.length - fallbackBlocks.length).toLocaleString()}{" "}
            blocks textured · {fallbackBlocks.length.toLocaleString()} shown
            as color
          </p>
        )}
      </div>

      <Canvas camera={{ position: [20, 20, 20], fov: 50 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 20, 10]} intensity={1} />
        {data && (
          <>
            {texturedEntries.map(([name, blocksForName]) => (
              <TexturedBlockGroup
                key={name}
                blocks={blocksForName}
                size={data.size}
                faceUVs={textureAssets.faceUVByBlock.get(name)}
                atlasTexture={textureAssets.atlasTexture}
              />
            ))}
            <FallbackColorBlocks
              key={`fallback-${fallbackBlocks.length}-${texturesLoading}`}
              blocks={fallbackBlocks}
              size={data.size}
            />
          </>
        )}
        <OrbitControls />
      </Canvas>
    </div>
  );
}