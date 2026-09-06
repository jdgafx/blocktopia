# Editable village characters and production GLBs

Four original Blocktopia characters: Mara (hearth apron), Ivo (scholar book), Neri (mountain pack and scarf), and Sol (keeper lantern). No paid generation service is used.

## Edit and build

Open https://web.blockbench.net/ and choose **Open Model**, then select a `.bbmodel` here. Sources retain their complete cube geometry, named joint pivots, UVs and embedded 64×64 painted palette. Adjacent PNGs are painting copies: import an edited PNG into Blockbench and save the model to replace the embedded palette.

Run `npm ci`, then `npm run build`. The build automatically runs `scripts/characters/export.mjs` before Vite, including on Netlify. To regenerate just the four GLBs, run `npm run build:assets`. This uses the installed Three.js GLTFExporter and pinned native gltfpack v1.2, requiring Node, Linux x64 and `unzip` (available in the Netlify Linux build image). No desktop DCC or paid service is required. `native-gltfpack.mjs` downloads the official Ubuntu release, checks its published archive SHA256, verifies the extracted executable SHA256, and validates that executable again on every cached use. The cache is under ignored `node_modules/.cache/`. A failed download, unsupported platform or checksum mismatch stops the build. Export failure stops the production build. Temporary intermediates are removed.

The converter supports the existing Generic Model cubes, nested groups, element/group rotations and face UV rotations. It retains named head/arm pivots and separates the existing boot/trouser cubes into two hip, knee and ankle chains without changing their geometry. The existing idle motion is baked into the `idle` quaternion animation. Keep the current head/arm and boot/trouser names. Unsupported mesh elements, multiple textures or authored Blockbench animation clips fail explicitly instead of being silently discarded. For future fully articulated rigs, author and export glTF animations from Blender and extend this build deliberately.

`gltfpack -c -ce ext -kn -vpf -tc -tu -tq 10 -tj 1` compresses and optimizes geometry/animations while preserving runtime joint names. The browser uses GLTFLoader with MeshoptDecoder, KTX2Loader and AnimationMixer; it never parses Blockbench documents. Four GLBs total approximately 80 KB, including textures and animations. Each character has ten mesh draws; splitting each trouser at the knee adds one cube worth of triangles. `runtime-diagnostics.json` records source/output hashes, byte sizes, triangle counts, joint names and animation channels.

The actual shipped GLBs contain Basis UASTC KTX2 textures (`KHR_texture_basisu`). They preserve the 64px palette and include mipmaps. This adds modest download overhead for such tiny textures, but exercises the same compressed GPU texture pipeline as larger future assets. `configureCharacterRenderer(actualWebGLRenderer)` must run before loading any character; KTX2Loader detects that renderer's supported target formats rather than assuming GPU hardware. A single transcoder worker bounds CPU competition. Matching Three.js transcoder JS/WASM are copied from the locked installed package into self-hosted `/decoders/basis/` on every build, with license notices retained.

Material roughness is uniformly 0.85 and metalness 0; constant material factors avoid a redundant ORM bitmap. For future spatially varying PBR textures, export AO in R, roughness in G, metalness in B of one non-color ORM texture.

### Native build platform and provenance

The npm gltfpack WASM build was tested with `-tc` and fails: it is compiled without BasisU. It is deliberately not used by production builds. The automatic pipeline supports Linux x64. Windows developers can run it in WSL2 Ubuntu; macOS developers can use an x86-64 Linux container. Other native release binaries can be downloaded manually from the same official release and used with the documented command, but are not silently substituted by the reproducible build.

Pinned official release: https://github.com/zeux/meshoptimizer/releases/tag/v1.2

- Ubuntu archive: `https://github.com/zeux/meshoptimizer/releases/download/v1.2/gltfpack-ubuntu.zip`
- Archive SHA256: `ebc236f5f6c08c7e5c5750476a187d24805d44d8c680449c4b7369c333f817b1` (matches GitHub release asset digest).
- Extracted executable SHA256: `7e0dc08489835df804a83ca111c2cac6f8431f5a7b0e5453d94d6749a988b32f`.

## Grounding and checks

NPC boots and moving ambient animal feet each sample their own short vertical voxel column, including placed/mined blocks. NPCs use an analytic two-bone hip/knee solver after idle animation, with ankle counter-rotation to keep boot soles level. Targets are smoothed and clamped to each leg’s reachable length. Story roots stay anchored; upper-body animation remains independent. Moving ambient animals retain their existing rigid limbs with vertical ground constraints. The independent interactive creature simulation is separate.

Run `npx vitest run tests/character-assets.test.js tests/character-grounding.test.js` for source geometry/UVs, GLB compression/rig/animation integrity and per-foot edited-ground checks. `node scripts/characters/verify-runtime.mjs` uses a running local Vite server and installed Playwright to verify real browser Meshopt decode, embedded image decode and AnimationMixer output with actual GPU capability detection and KTX2 transcoding, without running a heavy render loop.

Recreate the initial sources with `python scripts/characters/generate.py` only when intentionally replacing model edits. `python scripts/characters/verify-blockbench.py` verifies the editable sources inside the actual free Blockbench editor (Python Playwright, Chrome and internet required).

## Free authoring boundaries

- Blockbench: the actual editor for these shipped editable voxel characters: https://www.blockbench.net/
- Blender: GPL free software for articulated rigging, animation and glTF export: https://www.blender.org/about/license/
- Goxel: free/open-source voxel modeling; use for new voxel objects, not a requirement for loading existing models: https://goxel.xyz/
- Material Maker: free/open-source procedural PBR authoring; the repository already contains actual generated log-end materials and editable graphs: https://www.materialmaker.org/
- ArmorPaint: open-source texture painting with paid official prebuilt downloads; building from source is the free route. No paid binary was installed or required: https://armorpaint.org/
- Meshoptimizer/gltfpack compression options and runtime decoder requirements: https://github.com/zeux/meshoptimizer/tree/master/gltf

## Runtime browser policy

The pinned r163 Emscripten decoder uses generated JavaScript bindings (`new Function`) as well as WebAssembly. The production CSP therefore permits `unsafe-eval` for this trusted, self-hosted dependency; it continues to block inline scripts and external script origins. Embedded GLB textures also require `blob:` in `connect-src`. Vite preview reads the same policy from netlify.toml for acceptance.
