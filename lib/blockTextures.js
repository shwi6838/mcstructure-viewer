import * as THREE from "three";
import { TGALoader } from "three/examples/jsm/loaders/TGALoader.js";

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

function loadPngImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

// TGALoader decodes into a DataTexture with raw pixel bytes rather than an
// HTMLImageElement, so we convert it into a small canvas here - that way
// the atlas-drawing code below can treat every loaded image the same way
// (via drawImage) regardless of which format it came from.
function loadTgaAsCanvas(url) {
  return new Promise((resolve, reject) => {
    const loader = new TGALoader();
    loader.load(
      url,
      (texture) => {
        const { data, width, height } = texture.image;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        const imageData = ctx.createImageData(width, height);
        imageData.data.set(data);
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas);
      },
      undefined,
      () => reject(new Error(`Failed to load ${url}`))
    );
  });
}

// Most vanilla block textures are PNG, but a handful - notably grass and
// leaves - ship as TGA in Mojang's source files. Try PNG first, since it's
// the common case, and fall back to TGA before giving up entirely.
async function loadTextureImage(basePath) {
  try {
    return await loadPngImage(`${REPO_RAW}/${basePath}.png`);
  } catch {
    try {
      return await loadTgaAsCanvas(`${REPO_RAW}/${basePath}.tga`);
    } catch {
      return null;
    }
  }
}
function resolveTextureKeyPath(terrainJson, key) {
  const entry = terrainJson.texture_data?.[key];
  if (!entry) return null;
  let tex = Array.isArray(entry.textures) ? entry.textures[0] : entry.textures;
  // Biome-tinted textures (grass, etc.) store {path, overlay_color} objects
  // instead of a plain string - we ignore the tint and use the base image.
  if (tex && typeof tex === "object" && typeof tex.path === "string") {
    tex = tex.path;
  }
  return typeof tex === "string" ? tex : null; // e.g. "textures/blocks/dirt"
}

// Some legacy Bedrock blocks pack several visually distinct materials
// under one block name, picked by a state - e.g. "stone_slab" with
// stone_slab_type="sandstone" is a sandstone slab, not a generic "stone"
// one. blocks.json only keys on block name, so a naive lookup by name
// alone gives every variant of these blocks the same (wrong) texture.
// Values are Microsoft's documented state values for these blocks.
const LEGACY_BLOCK_FAMILIES = {
  stone_slab: {
    stateKey: "stone_slab_type",
    trySlabSuffix: true,
    map: {
      smooth_stone: "smooth_stone",
      sandstone: "sandstone",
      wood: "oak_planks",
      cobblestone: "cobblestone",
      brick: "brick_block",
      stone_brick: "stonebrick",
      quartz: "quartz_block",
      nether_brick: "nether_brick",
    },
  },
  stone_slab2: {
    stateKey: "stone_slab_type_2",
    trySlabSuffix: true,
    map: {
      red_sandstone: "red_sandstone",
      purpur: "purpur_block",
      prismarine_rough: "prismarine",
      prismarine_dark: "dark_prismarine",
      prismarine_brick: "prismarine_bricks",
      mossy_cobblestone: "mossy_cobblestone",
      smooth_sandstone: "sandstone",
      red_nether_brick: "red_nether_brick",
    },
  },
  stone_slab3: {
    stateKey: "stone_slab_type_3",
    trySlabSuffix: true,
    map: {
      end_stone_brick: "end_bricks",
      smooth_red_sandstone: "red_sandstone",
      polished_andesite: "polished_andesite",
      andesite: "andesite",
      diorite: "diorite",
      polished_diorite: "polished_diorite",
      granite: "granite",
      polished_granite: "polished_granite",
    },
  },
  stone_slab4: {
    stateKey: "stone_slab_type_4",
    trySlabSuffix: true,
    map: {
      mossy_stone_brick: "mossy_stone_brick",
      smooth_quartz: "quartz_block",
      stone: "stone",
      cut_sandstone: "cut_sandstone",
      cut_red_sandstone: "cut_red_sandstone",
    },
  },
  // Legacy multi-species leaves: the species is a state, not the name.
  leaves: {
    stateKey: "old_leaf_type",
    map: {
      oak: "oak_leaves",
      spruce: "spruce_leaves",
      birch: "birch_leaves",
      jungle: "jungle_leaves",
    },
  },
  leaves2: {
    stateKey: "new_leaf_type",
    map: {
      acacia: "acacia_leaves",
      dark_oak: "dark_oak_leaves",
    },
  },
};
// The full-height legacy versions of the slab blocks share the same states.
LEGACY_BLOCK_FAMILIES.double_stone_slab = LEGACY_BLOCK_FAMILIES.stone_slab;
LEGACY_BLOCK_FAMILIES.double_stone_slab2 = LEGACY_BLOCK_FAMILIES.stone_slab2;
LEGACY_BLOCK_FAMILIES.double_stone_slab3 = LEGACY_BLOCK_FAMILIES.stone_slab3;
LEGACY_BLOCK_FAMILIES.double_stone_slab4 = LEGACY_BLOCK_FAMILIES.stone_slab4;

/**
 * Given the list of blocks in a parsed structure, fetches only the
 * textures actually needed and returns:
 *   - atlasTexture: a single THREE.Texture containing every needed image
 *   - getFaceUVs(block): returns { up, down, north, south, east, west }
 *       UV rects into the atlas for that block, or null if unresolved
 *       (caller should fall back to a flat color)
 */
export async function loadBlockTextureAtlas(blocks) {
  const [blocksJson, terrainJson] = await Promise.all([
    getBlocksJson(),
    getTerrainJson(),
  ]);

  function resolveLookupKey(block) {
    const short = block.name.replace("minecraft:", "");
    const family = LEGACY_BLOCK_FAMILIES[short];
    if (!family) return short;
    const mapped = family.map[block.states?.[family.stateKey]];
    if (!mapped) return short;
    // Slabs may have a dedicated "<material>_slab" entry that differs
    // slightly from the full block; other families map directly.
    if (family.trySlabSuffix && blocksJson[`${mapped}_slab`]) {
      return `${mapped}_slab`;
    }
    return mapped;
  }

  const faceKeysByLookupKey = new Map();
  const seenLookupKeys = new Set();

  for (const block of blocks) {
    const lookupKey = resolveLookupKey(block);
    if (seenLookupKeys.has(lookupKey)) continue;
    seenLookupKeys.add(lookupKey);

    const entry = blocksJson[lookupKey];
    const normalized = entry ? normalizeFaceTextures(entry.textures) : null;
    if (normalized) {
      faceKeysByLookupKey.set(lookupKey, normalized);
    }
  }

  // Only fetch each distinct image once, even if many blocks share it.
  const pathByKey = new Map();
  for (const faces of faceKeysByLookupKey.values()) {
    for (const face of FACES) {
      const key = faces[face];
      if (!key || pathByKey.has(key)) continue;
      const path = resolveTextureKeyPath(terrainJson, key);
      if (path) pathByKey.set(key, path);
    }
  }

  const entries = Array.from(pathByKey.entries());
  const loadedImages = await Promise.all(
    entries.map(async ([key, path]) => ({
      key,
      img: await loadTextureImage(path),
    }))
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
    const v0 = 1 - (row + 1) / rows;
    const v1 = 1 - row / rows;
    uvRectByKey.set(key, [u0, v0, u1, v1]);
  });

  const atlasTexture = new THREE.CanvasTexture(canvas);
  atlasTexture.magFilter = THREE.NearestFilter;
  atlasTexture.minFilter = THREE.NearestFilter;
  atlasTexture.generateMipmaps = false;
  atlasTexture.colorSpace = THREE.SRGBColorSpace;

  const faceUVByLookupKey = new Map();
  for (const [lookupKey, faces] of faceKeysByLookupKey.entries()) {
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
    if (!missing) {
      faceUVByLookupKey.set(lookupKey, rects);
    }
  }

  return {
    atlasTexture,
    getFaceUVs(block) {
      return faceUVByLookupKey.get(resolveLookupKey(block)) || null;
    },
  };
}

// three.js's BoxGeometry (1 segment) lays out its 24 vertices in this face
// order: +X, -X, +Y, -Y, +Z, -Z, 4 vertices per face.
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