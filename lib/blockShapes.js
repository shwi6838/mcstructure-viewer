import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// three.js's BoxGeometry (1 segment) lays out its 24 vertices in this face
// order: +X, -X, +Y, -Y, +Z, -Z, 4 vertices per face.
const BOX_FACE_ORDER = ["east", "west", "up", "down", "south", "north"];

/** Maps atlas UV rects onto every face of a box, regardless of its size. */
function applyBoxFaceUVs(geometry, faceUVs) {
  const uvAttr = geometry.attributes.uv;
  BOX_FACE_ORDER.forEach((face, faceIndex) => {
    const rect = faceUVs[face] || faceUVs.up || faceUVs.north;
    const [u0, v0, u1, v1] = rect;
    const vertOffset = faceIndex * 4;
    uvAttr.setXY(vertOffset + 0, u0, v1);
    uvAttr.setXY(vertOffset + 1, u1, v1);
    uvAttr.setXY(vertOffset + 2, u0, v0);
    uvAttr.setXY(vertOffset + 3, u1, v0);
  });
  uvAttr.needsUpdate = true;
  return geometry;
}

/** Maps one atlas UV rect onto a single plane (both sides read the same rect). */
function applyPlaneUV(geometry, rect) {
  const [u0, v0, u1, v1] = rect;
  const uvAttr = geometry.attributes.uv;
  uvAttr.setXY(0, u0, v1);
  uvAttr.setXY(1, u1, v1);
  uvAttr.setXY(2, u0, v0);
  uvAttr.setXY(3, u1, v0);
  uvAttr.needsUpdate = true;
  return geometry;
}

/**
 * Pattern-matches a block name to one of a small set of shape families.
 * This is a silhouette approximation, not a 1:1 model of Bedrock's real
 * block geometry.
 */
export function getShapeCategory(blockName) {
  const n = blockName.replace("minecraft:", "");

  if (/_stairs$/.test(n)) return "stairs";
  if (/_slab$/.test(n) && !/_double_slab$/.test(n)) return "slab";
  if (/_trapdoor$/.test(n)) return "trapdoor";
  if (/_door$/.test(n)) return "door";
  if (n === "iron_bars" || /_pane$/.test(n)) return "thin_post";
  if (/_fence_gate$/.test(n)) return "fence_gate";
  if (/_fence$/.test(n)) return "fence_post";
  if (/_wall$/.test(n)) return "wall_post";
  if (/_button$/.test(n)) return "button";
  if (n === "torch" || /_torch$/.test(n)) return "torch";
  if (n === "ladder") return "ladder";
  if (n === "rail" || /_rail$/.test(n)) return "rail";
  if (/_carpet$/.test(n)) return "carpet";
  if (
    /_sapling$/.test(n) ||
    n === "wheat" ||
    n === "dead_bush" ||
    n === "tall_grass" ||
    n === "fern" ||
    /_bush$/.test(n) ||
    [
      "allium",
      "azure_bluet",
      "blue_orchid",
      "dandelion",
      "poppy",
      "oxeye_daisy",
      "cornflower",
      "lily_of_the_valley",
    ].includes(n)
  ) {
    return "cross";
  }

  return "full_cube";
}

// --- Orientation/facing lookups -------------------------------------------

// Legacy stairs: numeric weirdo_direction 0-3. Calibrated against a real
// structure - confirmed correct as of this mapping.
const WEIRDO_DIRECTION_TO_ROTATION = {
  0: -Math.PI / 2,
  1: Math.PI / 2,
  2: Math.PI,
  3: 0,
};

// Wall-mounted blocks (ladders, buttons): facing_direction 2-5 (0 = down,
// 1 = up are excluded for ladders since they can't mount those faces).
const FACING_DIRECTION_TO_ROTATION = {
  2: 0,
  3: Math.PI,
  4: Math.PI / 2,
  5: -Math.PI / 2,
};

// Trapdoors: numeric "direction" 0-3. Calibrated against a real structure -
// confirmed correct as of this mapping.
const DIRECTION_TO_ROTATION = {
  0: Math.PI / 2,
  1: -Math.PI / 2,
  2: 0,
  3: Math.PI,
};

// Doors and fence gates use the modern "minecraft:cardinal_direction"
// string state, not the legacy numeric "direction". This mapping is
// Mojang's own documented convention (from their block-rotation example
// code), not a guess: north=0°, west=+90°, south=180°, east=-90°. Whether
// our canonical (unrotated) geometry actually points "north" in the same
// sense Mojang means is the one part that could still need a one-time
// flip if doors/gates come out systematically wrong.
const CARDINAL_DIRECTION_TO_ROTATION = {
  north: 0,
  west: Math.PI / 2,
  south: Math.PI,
  east: -Math.PI / 2,
};

/**
 * Returns a short string capturing only the state values that affect a
 * given category's geometry, so the caller can group blocks that need
 * the same geometry together. Also appends pillar_axis when present,
 * since that affects any category (mainly full_cube blocks like logs).
 */
export function getOrientationSignature(category, states = {}) {
  let base = "";
  switch (category) {
    case "stairs":
      base = `${states.weirdo_direction ?? 0}-${states.upside_down_bit ? 1 : 0}`;
      break;
    case "trapdoor":
      base = `${states.upside_down_bit ? 1 : 0}-${states.open_bit ? 1 : 0}-${
        states.direction ?? 0
      }`;
      break;
    case "slab":
      base = states["minecraft:vertical_half"] === "top" ? "1" : "0";
      break;
    case "ladder":
    case "button":
      base = `${states.facing_direction ?? 0}`;
      break;
    case "door":
      base = `${states["minecraft:cardinal_direction"] ?? "north"}`;
      break;
    case "fence_gate":
      base = `${states["minecraft:cardinal_direction"] ?? "north"}-${
        states.open_bit ? 1 : 0
      }`;
      break;
    default:
      base = "";
  }
  if (states.pillar_axis) {
    base += `-axis:${states.pillar_axis}`;
  }
  return base;
}

/**
 * Rotates an already-built cube geometry so its "up/down" texture faces
 * the correct axis for pillar-like blocks (logs, wood, deepslate, basalt,
 * etc.) instead of always pointing along Y. Mutates and returns geometry.
 */
export function applyPillarAxis(geometry, states = {}) {
  if (states.pillar_axis === "x") geometry.rotateZ(Math.PI / 2);
  else if (states.pillar_axis === "z") geometry.rotateX(Math.PI / 2);
  return geometry;
}

function buildSlab(faceUVs, states = {}) {
  const top = states["minecraft:vertical_half"] === "top";
  const geometry = new THREE.BoxGeometry(1, 0.5, 1);
  geometry.translate(0, top ? 0.25 : -0.25, 0);
  return applyBoxFaceUVs(geometry, faceUVs);
}

function buildTrapdoor(faceUVs, states = {}) {
  const open = !!states.open_bit;
  const top = !!states.upside_down_bit;
  const rotation = DIRECTION_TO_ROTATION[states.direction] ?? 0;

  let geometry;
  if (open) {
    // Swung up into a vertical panel flush against the mounted wall.
    geometry = new THREE.BoxGeometry(1, 1, 0.1875);
    geometry.translate(0, 0, -(0.5 - 0.09375));
  } else {
    geometry = new THREE.BoxGeometry(1, 0.1875, 1);
    geometry.translate(0, top ? 0.5 - 0.09375 : -0.5 + 0.09375, 0);
  }

  applyBoxFaceUVs(geometry, faceUVs);
  geometry.rotateY(rotation);
  return geometry;
}

function buildDoor(faceUVs, states = {}) {
  // Hinge side and open state aren't read yet - only which wall it faces.
  const rotation =
    CARDINAL_DIRECTION_TO_ROTATION[states["minecraft:cardinal_direction"]] ?? 0;
  const geometry = new THREE.BoxGeometry(0.1875, 1, 1);
  geometry.rotateY(rotation);
  return applyBoxFaceUVs(geometry, faceUVs);
}

function buildConnectedPost(faceUVs, connections = {}, thickness) {
  // Center post, always present.
  const post = new THREE.BoxGeometry(thickness, 1, thickness);
  applyBoxFaceUVs(post, faceUVs);
  const parts = [post];

  const halfPost = thickness / 2;
  const armLength = 0.5 - halfPost;
  const armCenterOffset = halfPost + armLength / 2;

  if (connections.east) {
    const arm = new THREE.BoxGeometry(armLength, 1, thickness);
    arm.translate(armCenterOffset, 0, 0);
    applyBoxFaceUVs(arm, faceUVs);
    parts.push(arm);
  }
  if (connections.west) {
    const arm = new THREE.BoxGeometry(armLength, 1, thickness);
    arm.translate(-armCenterOffset, 0, 0);
    applyBoxFaceUVs(arm, faceUVs);
    parts.push(arm);
  }
  if (connections.south) {
    const arm = new THREE.BoxGeometry(thickness, 1, armLength);
    arm.translate(0, 0, armCenterOffset);
    applyBoxFaceUVs(arm, faceUVs);
    parts.push(arm);
  }
  if (connections.north) {
    const arm = new THREE.BoxGeometry(thickness, 1, armLength);
    arm.translate(0, 0, -armCenterOffset);
    applyBoxFaceUVs(arm, faceUVs);
    parts.push(arm);
  }

  return parts.length > 1 ? mergeGeometries(parts) : parts[0];
}

function buildThinPost(faceUVs, connections) {
  return buildConnectedPost(faceUVs, connections, 0.125);
}

function buildFencePost(faceUVs, connections) {
  return buildConnectedPost(faceUVs, connections, 0.25);
}

function buildWallPost(faceUVs, connections) {
  return buildConnectedPost(faceUVs, connections, 0.375);
}

function buildButton(faceUVs, states = {}) {
  const facing = states.facing_direction ?? 0;

  if (facing === 1) {
    const geometry = new THREE.BoxGeometry(0.375, 0.125, 0.25);
    geometry.translate(0, -0.5 + 0.0625, 0);
    return applyBoxFaceUVs(geometry, faceUVs);
  }
  if (facing === 0) {
    const geometry = new THREE.BoxGeometry(0.375, 0.125, 0.25);
    geometry.translate(0, 0.5 - 0.0625, 0);
    return applyBoxFaceUVs(geometry, faceUVs);
  }

  const rotation = FACING_DIRECTION_TO_ROTATION[facing] ?? 0;
  const geometry = new THREE.BoxGeometry(0.375, 0.25, 0.125);
  geometry.translate(0, 0, 0.5 - 0.0625);
  geometry.rotateY(rotation);
  return applyBoxFaceUVs(geometry, faceUVs);
}

function buildFenceGate(faceUVs, states = {}) {
  const open = !!states.open_bit;
  const baseRotation =
    CARDINAL_DIRECTION_TO_ROTATION[states["minecraft:cardinal_direction"]] ?? 0;
  const rotation = open ? baseRotation + Math.PI / 2 : baseRotation;

  const postThickness = 0.25;
  const panelDepth = 0.1875;
  const railThickness = 0.1875;
  const middlePostThickness = 0.125;
  const innerWidth = 1 - 2 * postThickness;
  const middleHeight = 1 - 2 * railThickness;

  const leftPost = new THREE.BoxGeometry(postThickness, 1, panelDepth);
  leftPost.translate(-0.5 + postThickness / 2, 0, 0);
  applyBoxFaceUVs(leftPost, faceUVs);

  const rightPost = new THREE.BoxGeometry(postThickness, 1, panelDepth);
  rightPost.translate(0.5 - postThickness / 2, 0, 0);
  applyBoxFaceUVs(rightPost, faceUVs);

  const topRail = new THREE.BoxGeometry(innerWidth, railThickness, panelDepth);
  topRail.translate(0, 0.5 - railThickness / 2, 0);
  applyBoxFaceUVs(topRail, faceUVs);

  const bottomRail = new THREE.BoxGeometry(innerWidth, railThickness, panelDepth);
  bottomRail.translate(0, -0.5 + railThickness / 2, 0);
  applyBoxFaceUVs(bottomRail, faceUVs);

  const middlePost = new THREE.BoxGeometry(
    middlePostThickness,
    middleHeight,
    panelDepth
  );
  applyBoxFaceUVs(middlePost, faceUVs);

  const merged = mergeGeometries([
    leftPost,
    rightPost,
    topRail,
    bottomRail,
    middlePost,
  ]);
  merged.rotateY(rotation);
  return merged;
}

function buildTorch(faceUVs) {
  const geometry = new THREE.BoxGeometry(0.1, 0.6, 0.1);
  geometry.translate(0, -0.2, 0);
  return applyBoxFaceUVs(geometry, faceUVs);
}

function buildLadder(faceUVs, states = {}) {
  const rotation = FACING_DIRECTION_TO_ROTATION[states.facing_direction] ?? 0;
  const geometry = new THREE.BoxGeometry(1, 1, 0.0625);
  geometry.translate(0, 0, 0.5 - 0.03125);
  geometry.rotateY(rotation);
  return applyBoxFaceUVs(geometry, faceUVs);
}

function buildRail(faceUVs) {
  const geometry = new THREE.BoxGeometry(1, 0.0625, 1);
  geometry.translate(0, -0.5 + 0.03125, 0);
  return applyBoxFaceUVs(geometry, faceUVs);
}

function buildCarpet(faceUVs) {
  const geometry = new THREE.BoxGeometry(1, 0.0625, 1);
  geometry.translate(0, -0.5 + 0.03125, 0);
  return applyBoxFaceUVs(geometry, faceUVs);
}

function buildCross(faceUVs) {
  const rect = faceUVs.north || faceUVs.up;

  const planeA = new THREE.PlaneGeometry(1, 1);
  applyPlaneUV(planeA, rect);
  planeA.rotateY(Math.PI / 4);

  const planeB = new THREE.PlaneGeometry(1, 1);
  applyPlaneUV(planeB, rect);
  planeB.rotateY(-Math.PI / 4);

  return mergeGeometries([planeA, planeB]);
}

function buildStairs(faceUVs, states = {}) {
  const upsideDown = !!states.upside_down_bit;
  const rotation = WEIRDO_DIRECTION_TO_ROTATION[states.weirdo_direction] ?? 0;

  const base = new THREE.BoxGeometry(1, 0.5, 1);
  base.translate(0, upsideDown ? 0.25 : -0.25, 0);
  applyBoxFaceUVs(base, faceUVs);

  const step = new THREE.BoxGeometry(1, 0.5, 0.5);
  step.translate(0, upsideDown ? -0.25 : 0.25, -0.25);
  applyBoxFaceUVs(step, faceUVs);

  const merged = mergeGeometries([base, step]);
  merged.rotateY(rotation);
  return merged;
}

/**
 * Builds a geometry for the given shape category. `extra` may include
 * `connections` (for thin_post/fence_post/wall_post) and/or `states` (for
 * anything that reads placement/orientation state). Returns whether
 * DoubleSide rendering is needed (only cross planes do).
 */
export function buildShapeGeometry(category, faceUVs, extra = {}) {
  const { connections = {}, states = {} } = extra;

  switch (category) {
    case "slab":
      return { geometry: buildSlab(faceUVs, states), doubleSided: false };
    case "trapdoor":
      return { geometry: buildTrapdoor(faceUVs, states), doubleSided: false };
    case "door":
      return { geometry: buildDoor(faceUVs, states), doubleSided: false };
    case "thin_post":
      return { geometry: buildThinPost(faceUVs, connections), doubleSided: false };
    case "fence_post":
      return { geometry: buildFencePost(faceUVs, connections), doubleSided: false };
    case "wall_post":
      return { geometry: buildWallPost(faceUVs, connections), doubleSided: false };
    case "button":
      return { geometry: buildButton(faceUVs, states), doubleSided: false };
    case "fence_gate":
      return { geometry: buildFenceGate(faceUVs, states), doubleSided: false };
    case "torch":
      return { geometry: buildTorch(faceUVs), doubleSided: false };
    case "ladder":
      return { geometry: buildLadder(faceUVs, states), doubleSided: false };
    case "rail":
      return { geometry: buildRail(faceUVs), doubleSided: false };
    case "carpet":
      return { geometry: buildCarpet(faceUVs), doubleSided: false };
    case "cross":
      return { geometry: buildCross(faceUVs), doubleSided: true };
    case "stairs":
      return { geometry: buildStairs(faceUVs, states), doubleSided: false };
    default: {
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      return { geometry: applyBoxFaceUVs(geometry, faceUVs), doubleSided: false };
    }
  }
}