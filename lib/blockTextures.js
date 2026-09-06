import * as THREE from "three";

// Mojang's official blocks.json and terrain_texture.json are in a public GitHub repo
const REPO_RAW =
  "https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack";

const FACES = ["up", "down", "north", "south", "east", "west"];

let blocksJsonPromise = null;
let terrainJsonPromise = null;

// Mojang's JSON files include // comments and can have trailing commas,
// which breaks a strict JSON.parse (and fetch().json()). Strip those before
// parsing rather than assuming these are valid JSON.
function stripJsonComments(text) {
  return text
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n")
    .replace(/,\s*([}\]])/g, "$1"); // trailing commas before } or ]
}

async function fetchLenientJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  return JSON.parse(stripJsonComments(text));
}

function getBlocksJson() {
  if (!blocksJsonPromise) {
    blocksJsonPromise = fetchLenientJson(`${REPO_RAW}/blocks.json`);
  }
  return blocksJsonPromise;
}

function getTerrainJson() {
  if (!terrainJsonPromise) {
    terrainJsonPromise = fetchLenientJson(
      `${REPO_RAW}/textures/terrain_texture.json`
    );
  }
  return terrainJsonPromise;
}

// blocks.json's "textures" field is either a single string (same texture on
// every face) or an object like { up, down, side } / { north, south, ... }.
// This normalizes either shape into one explicit key per face.
function normalizeFaceTextures(texturesField) {
  if (typeof texturesField === "string") {
    const all = {};
    FACES.forEach((f) => (all[f] = texturesField));
    return all;
  }
  if (texturesField && typeof texturesField === "object") {
    const side = texturesField.side;
    return {
      up: texturesField.up ?? side ?? texturesField.north,
      down: texturesField.down ?? side ?? texturesField.north,
      north: texturesField.north ?? side,
      south: texturesField.south ?? side ?? texturesField.north,
      east: texturesField.east ?? side ?? texturesField.north,
      west: texturesField.west ?? side ?? texturesField.north,
    };
  }
  return null;
}

function resolveTextureKeyPath(terrainJson, key) {
  const entry = terrainJson.texture_data?.[key];
  if (!entry) return null;
  const tex = Array.isArray(entry.textures) ? entry.textures[0] : entry.textures;
  return typeof tex === "string" ? tex : null; // e.g. "textures/blocks/dirt"
}

/**
 * Given the list of unique block names present in a parsed structure,
 * fetches only the textures actually needed and returns:
 *   - atlasTexture: a single THREE.Texture containing every needed image
 *   - faceUVByBlock: Map<blockName, { up, down, north, south, east, west }>
 *       where each value is a [u0, v0, u1, v1] UV rect into the atlas
 *   - unresolved: Set<blockName> for anything we couldn't map (caller
 *       should fall back to a flat color for these)
 */
export async function loadBlockTextureAtlas(blockNames) {
  const [blocksJson, terrainJson] = await Promise.all([
    getBlocksJson(),
    getTerrainJson(),
  ]);

  const faceKeysByBlock = new Map();
  const unresolved = new Set();

  for (const name of blockNames) {
    const short = name.replace("minecraft:", "");
    const entry = blocksJson[name] || blocksJson[`minecraft:${short}`];
    const normalized = entry ? normalizeFaceTextures(entry.textures) : null;
    if (!normalized) {
      unresolved.add(name);
      continue;
    }
    faceKeysByBlock.set(name, normalized);
  }

  // Only fetch each distinct image once, even if many blocks share it.
  const pathByKey = new Map();
  for (const faces of faceKeysByBlock.values()) {
    for (const face of FACES) {
      const key = faces[face];
      if (!key || pathByKey.has(key)) continue;
      const path = resolveTextureKeyPath(terrainJson, key);
      if (path) pathByKey.set(key, path);
    }
  }

  const loader = new THREE.ImageLoader();
  loader.setCrossOrigin("anonymous");
  const entries = Array.from(pathByKey.entries());
  const loadedImages = await Promise.all(
    entries.map(
      ([key, path]) =>
        new Promise((resolve) => {
          loader.load(
            `${REPO_RAW}/${path}.png`,
            (img) => resolve({ key, img }),
            undefined,
            () => resolve({ key, img: null }) // one bad texture shouldn't break the atlas
          );
        })
    )
  );

  const loaded = loadedImages.filter((entry) => entry.img);
  const cell = 16; // vanilla block textures are 16x16
  const cols = Math.max(1, Math.ceil(Math.sqrt(loaded.length)));
  const rows = Math.max(1, Math.ceil(loaded.length / cols));

  const canvas = document.createElement("canvas");
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const uvRectByKey = new Map();
  loaded.forEach(({ key, img }, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    ctx.drawImage(img, col * cell, row * cell, cell, cell);
    const u0 = col / cols;
    const u1 = (col + 1) / cols;
    // Canvas Y grows downward, UV V grows upward - flip here so textures
    // aren't upside down once mapped onto geometry.
    const v0 = 1 - (row + 1) / rows;
    const v1 = 1 - row / rows;
    uvRectByKey.set(key, [u0, v0, u1, v1]);
  });

  const atlasTexture = new THREE.CanvasTexture(canvas);
  atlasTexture.magFilter = THREE.NearestFilter; // keep the pixel-art look
  atlasTexture.minFilter = THREE.NearestFilter;
  atlasTexture.generateMipmaps = false;
  atlasTexture.colorSpace = THREE.SRGBColorSpace;

  const faceUVByBlock = new Map();
  for (const [name, faces] of faceKeysByBlock.entries()) {
    const rects = {};
    let missing = false;
    for (const face of FACES) {
      const rect = uvRectByKey.get(faces[face]);
      if (!rect) {
        missing = true;
        break;
      }
      rects[face] = rect;
    }
    if (missing) {
      unresolved.add(name);
    } else {
      faceUVByBlock.set(name, rects);
    }
  }

  return { atlasTexture, faceUVByBlock, unresolved };
}

// three.js's BoxGeometry lays out a 1-segment box's 24 vertices in this face
// order: +X, -X, +Y, -Y, +Z, -Z, with 4 vertices per face.
const FACE_ORDER = ["east", "west", "up", "down", "south", "north"];

/** Builds a unit cube whose face UVs point into the given atlas rects. */
export function buildTexturedBoxGeometry(faceUVs) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const uvAttr = geometry.attributes.uv;

  FACE_ORDER.forEach((face, faceIndex) => {
    const [u0, v0, u1, v1] = faceUVs[face];
    const vertOffset = faceIndex * 4;
    uvAttr.setXY(vertOffset + 0, u0, v1);
    uvAttr.setXY(vertOffset + 1, u1, v1);
    uvAttr.setXY(vertOffset + 2, u0, v0);
    uvAttr.setXY(vertOffset + 3, u1, v0);
  });

  uvAttr.needsUpdate = true;
  return geometry;
}