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
import {
  getShapeCategory,
  getOrientationSignature,
  buildShapeGeometry,
  applyPillarAxis,
} from "../lib/blockShapes";

function centerOffset(size) {
  return { x: -size.x / 2, y: -size.y / 2, z: -size.z / 2 };
}

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

export default function StructureViewer() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [textureAssets, setTextureAssets] = useState(null);
  const [texturesLoading, setTexturesLoading] = useState(false);
  const [showUntextured, setShowUntextured] = useState(false);

  async function handleFile(file) {
    setLoading(true);
    setError(null);
    setData(null);
    setTextureAssets(null);
    setShowUntextured(false);
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
        const assets = await loadBlockTextureAtlas(parsed.blocks);
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

  // Fast neighbor lookup for connection-aware shapes (currently just
  // panes/bars). Keyed by "x,y,z" - presence in this map means "there's
  // some block here", not specifically a matching/sturdy one, which is a
  // simplification of vanilla's real connection rules.
  const blockLookup = useMemo(() => {
    if (!data) return null;
    const map = new Map();
    data.blocks.forEach((b) => map.set(`${b.x},${b.y},${b.z}`, b));
    return map;
  }, [data]);

  function getConnections(block) {
    const s = block.states || {};

    // Modern fences/panes/bars store their own connection booleans - more
    // accurate than inferring from neighbors, since it reflects exactly
    // what the game decided was connectable.
    const hasPaneConnections =
      "minecraft:connection_north" in s ||
      "minecraft:connection_south" in s ||
      "minecraft:connection_east" in s ||
      "minecraft:connection_west" in s;
    if (hasPaneConnections) {
      return {
        north: !!s["minecraft:connection_north"],
        south: !!s["minecraft:connection_south"],
        east: !!s["minecraft:connection_east"],
        west: !!s["minecraft:connection_west"],
      };
    }

    // Walls use a per-side type (e.g. "none"/"short"/"tall") rather than a
    // plain boolean - treat anything other than "none" as connected.
    const hasWallConnections =
      "wall_connection_type_north" in s ||
      "wall_connection_type_south" in s ||
      "wall_connection_type_east" in s ||
      "wall_connection_type_west" in s;
    if (hasWallConnections) {
      return {
        north: !!s.wall_connection_type_north && s.wall_connection_type_north !== "none",
        south: !!s.wall_connection_type_south && s.wall_connection_type_south !== "none",
        east: !!s.wall_connection_type_east && s.wall_connection_type_east !== "none",
        west: !!s.wall_connection_type_west && s.wall_connection_type_west !== "none",
      };
    }

    // Fallback for older/legacy blocks without explicit connection states:
    // infer from simple neighbor presence.
    return {
      north: blockLookup.has(`${block.x},${block.y},${block.z - 1}`),
      south: blockLookup.has(`${block.x},${block.y},${block.z + 1}`),
      east: blockLookup.has(`${block.x + 1},${block.y},${block.z}`),
      west: blockLookup.has(`${block.x - 1},${block.y},${block.z}`),
    };
  }

  const fallbackBlocks = useMemo(() => {
    if (!data) return [];
    if (!textureAssets) return data.blocks; // nothing textured yet
    return data.blocks.filter((b) => !textureAssets.getFaceUVs(b));
  }, [data, textureAssets]);

  // Breakdown of untextured blocks by name, for the "show untextured
  // blocks" toggle - sorted most-common first.
  const untexturedCounts = useMemo(() => {
    const counts = new Map();
    for (const b of fallbackBlocks) {
      counts.set(b.name, (counts.get(b.name) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [fallbackBlocks]);

  // Group textured blocks by (shape category, orientation, connection
  // pattern, exact UV set) so each group can use one shared geometry.
  const texturedGroups = useMemo(() => {
    if (!data || !textureAssets || !blockLookup) return [];
    const groups = new Map();
    for (const block of data.blocks) {
      const faceUVs = textureAssets.getFaceUVs(block);
      if (!faceUVs) continue;
      const category = getShapeCategory(block.name);

      let connections = null;
      let connectionKey = "";
      if (
        category === "thin_post" ||
        category === "fence_post" ||
        category === "wall_post"
      ) {
        connections = getConnections(block);
        connectionKey = `${connections.north ? 1 : 0}${connections.south ? 1 : 0}${
          connections.east ? 1 : 0
        }${connections.west ? 1 : 0}`;
      }

      const orientationKey = getOrientationSignature(category, block.states);

      const key = `${category}::${connectionKey}::${orientationKey}::${JSON.stringify(
        faceUVs
      )}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          category,
          connections,
          states: block.states,
          faceUVs,
          blocks: [],
        });
      }
      groups.get(key).blocks.push(block);
    }
    return Array.from(groups.values());
  }, [data, textureAssets, blockLookup]);

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
          maxWidth: 320,
          maxHeight: "80vh",
          overflowY: "auto",
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
          <>
            <p>
              {(data.blocks.length - fallbackBlocks.length).toLocaleString()}{" "}
              blocks textured · {fallbackBlocks.length.toLocaleString()} shown
              as color
            </p>
            {fallbackBlocks.length > 0 && (
              <button onClick={() => setShowUntextured((v) => !v)}>
                {showUntextured ? "Hide" : "Show"} untextured block names
              </button>
            )}
            {showUntextured && (
              <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                {untexturedCounts.map(([name, count]) => (
                  <li key={name}>
                    {name} × {count.toLocaleString()}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <Canvas camera={{ position: [20, 20, 20], fov: 50 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 20, 10]} intensity={1} />
        {data && (
          <>
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
        <OrbitControls />
      </Canvas>
    </div>
  );
}