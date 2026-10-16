// Pure, framework-agnostic helpers for turning a parsed structure into
// renderable groups. No React, no three.js, no Next.js - just data in,
// data out - so the workshop and the embeddable component can share it.

import { getShapeCategory, getOrientationSignature } from "./blockShapes";

/**
 * Blocks occupy integer cells 0..size-1 and each cube is centered on its
 * cell, so shifting by (size - 1) / 2 centers the structure's bounding box
 * exactly on the origin (extents run from -size/2 to +size/2 on each axis).
 */
export function centerOffset(size) {
  return {
    x: -(size.x - 1) / 2,
    y: -(size.y - 1) / 2,
    z: -(size.z - 1) / 2,
  };
}

/**
 * Fast neighbor lookup for connection-aware shapes. Keyed by "x,y,z" -
 * presence in this map means "there's some block here", not specifically a
 * matching/sturdy one, which is a simplification of vanilla's real
 * connection rules.
 */
export function buildBlockLookup(blocks) {
  const map = new Map();
  for (const b of blocks) map.set(`${b.x},${b.y},${b.z}`, b);
  return map;
}

/**
 * Which sides of a fence/wall/pane/bar block connect to a neighbor.
 */
export function getConnections(block, blockLookup) {
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

/**
 * Blocks that have no resolved texture. With no texture assets yet, every
 * block counts as untextured (so it renders as flat color in the meantime).
 */
export function findUntexturedBlocks(blocks, textureAssets) {
  if (!textureAssets) return blocks;
  return blocks.filter((b) => !textureAssets.getFaceUVs(b));
}

/**
 * Counts blocks by name, sorted most-common first, as [name, count] pairs.
 */
export function countBlockNames(blocks) {
  const counts = new Map();
  for (const b of blocks) {
    counts.set(b.name, (counts.get(b.name) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

/**
 * Groups textured blocks by (shape category, orientation, connection
 * pattern, exact UV set) so each group can share one geometry and be drawn
 * as a single InstancedMesh.
 */
export function groupTexturedBlocks(blocks, textureAssets, blockLookup) {
  if (!textureAssets || !blockLookup) return [];

  const groups = new Map();
  for (const block of blocks) {
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
      connections = getConnections(block, blockLookup);
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
}