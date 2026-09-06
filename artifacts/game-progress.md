# Blocktopia specification implementation

Source: https://docs.google.com/document/d/1VF8qWFoYCIqWzyJCvOuntSkGlmkHlMnAq2FF7Y9YwhY/edit?tab=t.0
User approved full implementation, then added Netlify/Supabase hosting and automatic performance tuning.

Preserve existing multiplayer expedition loop, saved worlds, authored NPC identities, FOSS-only asset tools, and high-contrast graphical menus. Existing world chunk dimensions remain compatible with saves; the spec's 32-cube snippet is an example storage layout, not a save-format migration requirement.

Required acceptance: dynamic scattering/ACES; full material channels and wetness; vertex contact AO; depth-based refractive water/foam; worker greedy meshing and generation; responsive kinematic movement; grounded feet; textured directional impacts/cracks; real optimized GLBs; Netlify isolation/build headers; binary chunk saves with RLS; authenticated realtime edits; automatic adaptive quality with manual override.

Owners: root terrain/renderer/worker scheduling/auto-quality/headers/integration; movement_feedback player/physics/first-person; foss_characters GLB authoring/runtime/IK/build optimization; hosted_persistence saves/binary chunks/Realtime/migrations.

Existing baseline: scattering Sky + ACES already present, native kinematic collision, CPU face-culling mesher, PBR color/normal/roughness, synchronous startup/remesh. Runtime NPC source parsing and JSON snapshot persistence being replaced compatibly.

Implemented: worker generation/greedy meshing and shared/transferable snapshots; full terrain material channels/contact AO/wetness; depth water/refraction/foam/fog; buffered/coyote movement and immediate impact feedback; GLB/Meshopt/KTX2 NPCs and peer avatars with grounding; adaptive graphics with manual override; isolation/build configuration; atomic binary cloud saves and authenticated voxel Broadcast.

Local production-build acceptance: native signup/create, Mara quest, place/mine, late peer join, guest edit, real GLB avatars, save/leave/reopen with exact terrain and quest progress; desktop/mobile graphics controls and native shoreline traversal. 168 tests pass; two opt-in hosted integration tests were exercised separately against local Supabase. Hosted migrations applied and actual saved bytea payload verified.

Measured local warmed edits: worker meshing 3.4–3.8 ms and end-to-end 7.9–8.5 ms. Cold jobs reached 98 ms under competing machine load; the 16 ms target is not a worst-case guarantee. Hardware-accelerated shoreline play measured 60 FPS; two simultaneous clients on the busy machine sometimes fell below 20 FPS. All texture/character features remain enabled in Auto/Performance modes.

Release procedure: build and native browser acceptance before pushing feature/core-engine; verify the matching Netlify deploy, response headers, decoder loading and hosted gameplay. Per-run captures and JSON receipts are in ignored output/playwright; production receipt is retained locally with the final report.
