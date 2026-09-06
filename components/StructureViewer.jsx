"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { parseMcstructureFile } from "../lib/parseMcstructure";
import { colorForBlock } from "../lib/blockColors";

// Renders every block as one instance of a shared cube mesh. This matters:
// a naive <mesh> per block falls over well before a few thousand blocks,
// while InstancedMesh handles tens of thousands in a single draw call.
function InstancedBlocks({ blocks, size }) {
  const meshRef = useRef();

  useEffect(() => {
    if (!meshRef.current) return;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    // Center the structure on the origin so OrbitControls orbits its middle.
    const offsetX = -size.x / 2;
    const offsetY = -size.y / 2;
    const offsetZ = -size.z / 2;

    blocks.forEach((block, i) => {
      dummy.position.set(
        block.x + offsetX,
        block.y + offsetY,
        block.z + offsetZ
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

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, blocks.length]}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial />
    </instancedMesh>
  );
}

export default function StructureViewer() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleFile(file) {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const parsed = await parseMcstructureFile(arrayBuffer);
      if (parsed.blocks.length === 0) {
        setError("Parsed the file, but found no blocks to render.");
      } else {
        setData(parsed);
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
      </div>

      <Canvas camera={{ position: [20, 20, 20], fov: 50 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 20, 10]} intensity={1} />
        {data && (
          <InstancedBlocks
            key={data.blocks.length}
            blocks={data.blocks}
            size={data.size}
          />
        )}
        <OrbitControls />
      </Canvas>
    </div>
  );
}
