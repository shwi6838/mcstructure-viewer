import { Buffer } from "buffer";
import * as nbt from "prismarine-nbt";

// prismarine-nbt expects Node's global Buffer to exist. In the browser it
// doesn't by default, so we provide it ourselves.
if (typeof window !== "undefined" && !window.Buffer) {
  window.Buffer = Buffer;
}

/**
 * Parses a Bedrock .mcstructure file (uncompressed, little-endian NBT)
 * into a flat list of { x, y, z, name } blocks plus the structure's size.
 *
 * Format reference: https://wiki.bedrock.dev/nbt/mcstructure
 */
export async function parseMcstructureFile(arrayBuffer) {
  const buffer = Buffer.from(arrayBuffer);
  const { parsed } = await nbt.parse(buffer, "little");
  const root = nbt.simplify(parsed);

  const [sizeX, sizeY, sizeZ] = root.size;

  const layers = root.structure.block_indices;
  const primaryLayer = layers[0]; // layer 1 is almost always waterlogging data
  const paletteEntries = root.structure.palette.default.block_palette;

  const blocks = [];

  for (let i = 0; i < primaryLayer.length; i++) {
    const paletteIndex = primaryLayer[i];
    if (paletteIndex === -1) continue; // structure void, no block here

    const blockName = paletteEntries[paletteIndex]?.name;
    if (!blockName || blockName === "minecraft:air") continue;

    // Bedrock's index formula: i = sizeZ*sizeY*x + sizeZ*y + z
    const x = Math.floor(i / (sizeY * sizeZ));
    const remainder = i % (sizeY * sizeZ);
    const y = Math.floor(remainder / sizeZ);
    const z = remainder % sizeZ;

    blocks.push({ x, y, z, name: blockName });
  }

  return {
    size: { x: sizeX, y: sizeY, z: sizeZ },
    blocks,
  };
}
