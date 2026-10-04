# Yoin seasonal lyric memories refinement

final result: passed

No actionable P0/P1/P2 findings remain in the reviewed visual and interaction scope. The generated lyrics are primary, each verse retains its trip time and place, and a speech-bubble icon opens the original sample conversation. The user requested a muted palette related to the song, season and artwork; this Kyoto sample uses amber, stone and dark wood.

## Evidence

- Visual source: `design/seasonal-reference.png`, 853 x 1844. The earlier white direction is archived in `design/reference.png`.
- Source normalization: `qa/minimal/reference-normalized.png`, 390 x 843, proportional resize.
- Local implementation: http://127.0.0.1:4173/.
- Primary capture: `qa/minimal/final-screen.jpg`, Pixel 10 at 427 x 952 CSS/raster pixels. For source comparison, `qa/minimal/final-content.jpg` crops the centered 390 x 840 app content, excluding protected status/navigation chrome (64px top, 48px bottom).
- Same comparison state: Kyoto trip, initial scroll, first lyric current, paused at 0:42. The 3px source height difference is preserved without stretching.
- The source and implementation were inspected together in `qa/minimal/comparison.png`, and together at larger readable scale in `qa/minimal/comparison-lyrics.png` (content y=500..834).
- Alternate device: `qa/minimal/iphone-screen.jpg`, 393 x 852 CSS/raster pixels. The smaller preset uses 160px artwork instead of 230px. Both verses, metadata and 52px conversation controls remain above the player; metadata-to-player clearance is 15.64px.
- Conversation evidence: `qa/minimal/conversation-sheet.jpg`. This is a normal-size browser capture, including the phone frame and complete first conversation.
- Fidelity captures used a temporary 1200 x 1200 layout viewport to compare at density 1. The viewport override was reset before handoff.

## Five fidelity surfaces

| Surface | Result |
| --- | --- |
| Fonts and typography | System Japanese sans; trip title 32px/750, song title 26px/720, lyrics 22px/700, provenance 13px. First verse stays two lines; second stays one line in both presets. Exact generated glyph rasterization is unknown (P3). |
| Spacing and hierarchy | 390px content width, 16px inset, large cover, quiet section label, isolated current-verse bar, no connected timeline or quote preview. Primary cover y=202.18, first verse y=552.27, second verse y=660.16, player y=736. All visible controls clear the player. |
| Colors and materials | Static photographic background, ink #332317, secondary #544033, one amber accent #9c5d2e. Translucent player and conversation controls follow the same palette. Opaque and reduced-motion alternatives are defined. Conservative secondary-text/background checks are at least 4.67:1 across reviewed regions in both presets; CTA contrast is 11.54:1. See `qa/minimal/contrast-final.json`. |
| Imagery and icons | Existing 1561 x 1007 Kyoto photograph reused in cover and thumbnails; independent 853 x 1844 background raster. No CSS illustration or screenshot used as the app. Installed Radix speech-bubble/share/player symbols remain consistent. |
| Copy and provenance | Lyrics are primary. Dates and places remain visible below each verse. No duplicate speaker quote or visible conversation CTA text appears on the main screen. Actual dialogue stays in the sheet. Song offsets 0:42 and 1:48 are distinct from trip times 17:23 and 18:40. Visible date separators use plain hyphens. |

## Findings and repairs

- Baseline RED: `qa/minimal/red.json` and `before-content.jpg` showed two repeated conversation excerpts and a visible text conversation button.
- GREEN: `qa/minimal/green.json` verifies zero main-screen quote excerpts, empty icon-button text, place-specific accessible names and 52 x 52px logical targets.
- Iteration 1: the combined full/lyric comparisons showed the selected composition and calmer hierarchy. The header initially introduced a visible rectangular blur boundary; removing its redundant filter restored a continuous background.
- Contrast review found a P2: secondary #665143 could drop to 3.57:1 over the trip-date background, and to 4.10:1 for the iPhone section label. Secondary text was darkened to #544033. Before evidence is retained under `qa/minimal/iteration-1-*` and `contrast-before.json`.
- Final source/implementation comparisons and both device captures were reopened after the repair. The same regions now exceed 4.5:1 in the static background calculation; no P0/P1/P2 drift remains.
- Accepted P3: standardized Radix bubble shape and 52px circle differ slightly from the generated 56px bubble. The original cover asset is retained rather than recreating the mock's minor photographic variations. Generated background light patches differ locally while retaining the same palette and density. Darker secondary text is an intentional readability adjustment.

## Interaction and build checks

- Native tap opens the correct full conversation for 清水坂 at 17:23 and 鴨川 at 18:40, including the resulting lyrics.
- Closing the first conversation retains position 0:42. Opening the second conversation also retains 0:42; selecting its scene-listen action moves to 1:48 and starts the simulated clock.
- Pause succeeds. Pointer drag changes the range from 142 to 47 seconds and updates the current-verse marker back to 清水坂. Screen-shell scrollTop stays 0 throughout these native interaction checks.
- The image-to-code interaction harness is manual in-app-browser checking. Existing library/share actions and protected sheet mechanics are preserved; their earlier verification is archived in `qa/minimal/previous-design-qa.md` rather than claimed as newly repeated tests.
- A locator-driven click caused the hidden device shell to scroll in a separate verification tab; that capture was excluded. Native touch-style input on the accepted tab did not reproduce it.
- Browser logs on the accepted tab contain no warnings or errors.
- Final `npm run build`: passed (TypeScript, Vite, build preparation).
- Final build precheck `npm run check:runtime`: passed; all 28 protected runtime files remain intact.
- The automated runtime suite was not run.

## Design-taste preflight

The design read is a quiet private travel-song journal. Dials: DESIGN_VARIANCE 4, MOTION_INTENSITY 4, VISUAL_DENSITY 2. This is a refinement of the existing single-column mobile experience, not a marketing-page redesign. One seasonal theme and one accent apply throughout; the neutral warm palette is explicitly requested by the user. Shape radii follow component role (cover/sheet/player/circular icon), copy has no em dashes, and real assets replace decorative illustration. Motion provides press feedback, sheet state/depth and seeking feedback; the backdrop stays still. No extra navigation, sections, labels or routes were introduced. Marketing-page checks for marquees, bento grids, logo walls, split heroes, section alternation and desktop CTAs are not applicable.

## Limits

This is a local frontend prototype with mock dialogue and a silent playback clock. Seasonal color is designed for this sample; automatic extraction from real recordings, dates or songs is not implemented. Recording, real provenance, audio generation, backend services and hosted recipient playback remain outside scope. OS accessibility preferences, physical-device performance and screen-reader traversal were not exercised. Static raster contrast sampling is conservative geometry-based checking, not physical-display certification.
