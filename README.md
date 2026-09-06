# mcstructure viewer (starter)

A minimal Next.js app that parses and renders Bedrock `.mcstructure` files
in the browser, using flat colors as a stand-in for real block textures.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:3000/viewer and drop in a `.mcstructure` file
(export one from a Structure Block in-game, on Windows — Bedrock only
supports structure export on Windows).

## What's implemented

- Parses the NBT structure (little-endian, per Bedrock's format)
- Reads `size`, the block palette, and the primary block-index layer
- Renders every non-air block as one instance in a single `InstancedMesh`
  (needed for performance — a mesh-per-block approach chokes past a few
  thousand blocks)
- Orbit camera via `@react-three/drei`'s `OrbitControls`

## Known limitations (next steps)

- **Colors, not textures.** `lib/blockColors.js` maps block name substrings
  to flat hex colors. Swapping in real textures from
  [Mojang/bedrock-samples](https://github.com/Mojang/bedrock-samples)
  (`resource_pack/textures/blocks/`) is the natural next step — you'd load
  each PNG, build a `THREE.Texture`, and apply it per-face instead of a
  flat `meshStandardMaterial` color.
- **Layer 0 only.** `.mcstructure` files store two block layers (the second
  is almost always waterlogging data). We only read layer 0 right now.
- **No block entities.** Chests, signs, and similar blocks store extra data
  in `block_position_data` that isn't read yet.
- **No auto-framing.** The camera starts at a fixed position rather than
  fitting itself to the structure's bounding box — fine for medium builds,
  awkward for very large or very small ones.
- **Version/blockstate nuance.** The palette's `version` field reflects
  which game version encoded the block states. Different versions can use
  different state names for the same block — worth checking against a
  known-simple structure if you see anything looking obviously wrong.
