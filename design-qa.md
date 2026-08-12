# Design QA — Граф знаний

- Source visual truth: `/Users/dmytrolishchyna/Desktop/graph.png`
- Source dimensions: 1672 × 941 px; normalized comparison copy: `design-qa-reference-1280.png`, 1280 × 720 px
- Implementation screenshot: `/Users/dmytrolishchyna/Desktop/ORBIT CRM/design-qa-implementation.png`
- Side-by-side comparison: `/Users/dmytrolishchyna/Desktop/ORBIT CRM/design-qa-comparison.png`
- Browser/CSS viewport: 1280 × 720 CSS px (Codex in-app browser)
- Implementation pixels: 1280 × 720 px
- Browser device scale factor: 2; the browser screenshot API returned a CSS-pixel-normalized 1280 × 720 image
- Density normalization: the 1672 × 941 source was proportionally downsampled to 1280 × 720; both compared artifacts therefore have identical pixel dimensions and aspect ratio
- State: dark theme, project selected, first-level real relations expanded, details panel open

## Full-view comparison evidence

The implementation preserves the reference composition: the existing Orbit navigation and header, a large dark constellation canvas, point-based nodes connected by fine curved lines, a persistent right-side details rail, a minimap at bottom-left, a compact legend, and fit/zoom controls at bottom-right. The teal active state, dimmed unrelated state, dotted reuse/secondary relations, border density, radii, and restrained typography all match the reference design language.

The graph topology intentionally follows accessible CRM data instead of recreating the reference's illustrative categories. Tasks, people, files, comments, checklist items, finances, leads, and project reuse therefore produce different branch labels while retaining the same visual hierarchy.

## Focused-region comparison evidence

No separate crop was required: the native 1280 × 720 implementation capture keeps the toolbar, node labels, minimap, zoom controls, and full right rail readable. The right rail was additionally verified through the browser DOM in project and task states, including progress, direct-type counts, reuse, recent materials, dependencies, and the inline relation composer.

## Required fidelity surfaces

- Fonts and typography: Uses Orbit's existing Montserrat/Open Sans stack, weight hierarchy, compact panel labels, and small graph annotations. Selected and direct node labels remain high-contrast; secondary labels appear only when zoom or selection makes them useful.
- Spacing and layout rhythm: Canvas, rail, minimap, legend, and controls remain in stable regions. The current Orbit shell is wider than the shell pictured in the normalized reference, an intentional constraint because the task requires preserving existing CRM navigation rather than redesigning it.
- Colors and tokens: Dark blue-black surfaces, turquoise active links, blue people, green tasks, violet materials, and amber generated/financial material map to the reference palette and existing Orbit tokens.
- Image quality and assets: The target contains no raster content assets beyond the existing Orbit brand mark. The implementation reuses the existing brand asset and the project's established icon library; no placeholder imagery or custom SVG illustration substitutes were introduced.
- Copy and content: Static Russian copy matches the requested workflow. Entity names, counts, progress, materials, and relations are computed from real CRM data in production; the screenshot uses a development-only preview snapshot kept outside production data loading.
- Responsiveness and accessibility: At the captured desktop breakpoint, controls remain reachable, the details rail scrolls independently, buttons have accessible names, form fields have visible labels/placeholders, and filtering/searching do not remove the selected context unexpectedly.

## Interaction and runtime verification

- Search found a task by title and selecting the result moved the details rail to that entity.
- Depth 3 exposed its image, document, assignee, and downstream project context.
- The Materials filter removed and restored document/image nodes.
- The relation composer opened inline, exposed all required relation types, found a second entity, and enabled creation after target selection.
- Node dragging changed the persisted graph position in the active session.
- Zoom-in changed the XYFlow viewport scale; fit-to-screen and minimap controls were present.
- Fresh-load browser console errors checked: none.
- Production build passed.
- Focused ESLint run passed with no errors; one pre-existing Fast Refresh warning remains in `crm-store.tsx`.

## Comparison history

### Iteration 1 — blocked

- [P1] The initial canvas remained full-width under the details rail, hiding a project and compressing relationships behind the panel.
- [P2] Direct task and person labels overlapped because all children shared a single narrow row.
- [P2] Reverse `related_to` rows were counted as separate project relations.
- [P2] The graph-only screen inherited the assistant bubble, which overlapped the primary relation action.
- [P2] Recent materials were absent for selected projects because only direct one-hop material nodes were considered.

Fixes made: reserved an actual rail-width canvas track, added automatic fit after lazy expansion, changed the task layout to a multi-row constellation, widened people spacing, deduplicated symmetric project relations, hid the assistant only on `/graph`, and sourced project materials from the visible multi-hop neighborhood.

### Iteration 2 — passed

Post-fix evidence is the current `design-qa-implementation.png` and `design-qa-comparison.png`. All projects fit inside the active canvas, labels no longer collide at the intended desktop state, project counts are correct, panel actions remain unobstructed, and recent material rows are present. No actionable P0/P1/P2 difference remains.

## Follow-up polish

- [P3] At smaller desktop widths, the existing 256 px Orbit sidebar and 338 px graph rail leave less canvas than the proportionally scaled reference. The graph remains usable through fit, zoom, pan, collapse, and rail close controls; changing the global shell was intentionally out of scope.
- [P3] Real project data may produce less visually balanced clusters than the curated reference. Saved manual positions and lazy expansion provide the intended correction path without inventing production records.

final result: passed
