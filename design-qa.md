# Yoin Expo / React Native UI QA

final result: passed

## Comparison target

The accepted three-screen journey is implemented at the repository root with Expo and React Native. The source is the previously approved Product Design implementation, captured in `prototype/qa/flow/home-final.png`, `record-empty-final.png`, and `music-final.png`. The original design board is `prototype/design/library-recording-flow.png`; the approved Kyoto photo and muted seasonal background are retained.

Implementation preview: http://localhost:8081/

This acceptance covers the screens and their sample-data interactions. Real recording, audio playback, location, transcription, generation, persistence, and public playback URLs are outside this implementation.

## Normalization and evidence

- Source captures: 390 × 840 pixels. They are the centered app content crop of the prototype's unscaled 427 × 952 Pixel screen, excluding its 64px status bar and 48px bottom navigation region.
- Expo React Native Web captures: 390 × 840 pixels, CSS viewport 390 × 840, device pixel ratio 1. No image stretching or device bezel is used. Native safe areas belong to the OS.
- Matched states: library with the original Kyoto album; new recorder with microphone off, zero clips and disabled finish; original Kyoto song paused at 0:42.
- Final implementation captures: `qa/expo/home-final.jpg`, `record-empty-final.jpg`, `music-final.jpg`.
- Full comparisons containing source and implementation together: `qa/expo/comparison-home.png`, `comparison-record.png`, `comparison-music.png`.
- Focused comparisons: `qa/expo/comparison-home-top.png`, `comparison-record-top.png`, `comparison-record-detail.png`, `comparison-music-top.png`, `comparison-music-detail.png`.
- Other verified states: `record-paused.jpg`, `finish-review.jpg`, `completed-new-song.jpg`, `memory-source-final.jpg`, `seek-keyboard.jpg` in `qa/expo/`.
- Final three-screen overview: `qa/expo/final-flow.png`.

Full and focused comparisons were opened and inspected together. An independent subagent reviewed both sets. The source background was rendered across the original phone including its OS regions, whereas the Web comparison viewport contains only the app. The remaining cover-crop offset is expected; the image is proportionally scaled and its muted amber/stone texture is preserved.

## Findings and iteration history

No actionable P0/P1/P2 visual findings remain.

1. **[P2, fixed] Library cover stretched vertically on Web.** An image with only width and aspect ratio rendered at its intrinsic height. The album now receives explicit equal width and height. `qa/expo/home-first.jpg` shows the first pass; `home-final.jpg` and `comparison-home.png` show the square crop after correction.
2. **[P2, fixed] Music background lost its approved texture.** React Native Web's ImageBackground rendered an intrinsic 1844px image despite an 840px parent. Explicit window width and height now bound the image to the screen. The previous comparison is `comparison-music-first.png`; revised full and focused comparisons show the amber/stone treatment restored.
3. **[P2, fixed] Focusing the Web seek control shifted the entire music screen.** The same oversized background expanded the scrollable area. Explicit image dimensions and a clipped screen surface prevent this. After ArrowRight/ArrowLeft, the slider remains at y=769 with a 44px interaction area and every ancestor's scrollTop equal to zero. Evidence: `seek-keyboard.jpg`.
4. **[P2, fixed] Web seek control lacked usable range metadata.** A Web-specific standard range input exposes min/max/current/time to assistive technology and supports arrow keys and pointer dragging. Native platforms retain the native slider. ArrowRight changed 0:42 to 0:43; pointer dragging changed the position to 2:28; playback then continued after release.
5. **[P1, fixed in code review] A closing sheet could be reopened by a late drag release.** The card rejects new input during dismissal. Grant, Move, Release and Terminate also check the current open state, so an already-acquired responder cannot interrupt the close animation. The independent reviewer confirmed the guard. Web scene selection closes the sheet and resumes the associated position. Concurrent Android back/drag has not been exercised on a device.

## Required fidelity surfaces

- **Fonts and typography:** Japanese platform system sans, 38px library heading, 32px record/memory headings, 40px tabular timer, 22px lyrics. Weights, tracking, line heights, wrapping, date text and small labels were inspected in focused comparisons. Platform antialiasing differences are acceptable.
- **Spacing and layout rhythm:** Two-column square album grid, 16px page insets, 112px microphone state, 144px recording control, 52px source controls and persistent player. Start/stop/resume keep the recording control in the same position as conversations accumulate. Music content has bottom padding based on the measured player height. Sheet content scrolls and keyboard avoidance is implemented.
- **Colors and tokens:** Library and recorder remain white. Only the finished memory uses the approved amber/stone raster background, brown primary text and muted source controls. Disabled finish and explicit microphone states remain distinguishable. The player uses a more opaque native surface for legibility; exact backdrop blur is an accepted platform difference.
- **Image quality and assets:** The exact approved Kyoto artwork and seasonal PNG are reused. Square library crop and responsive landscape music crop preserve aspect ratio. No screenshot is embedded as functional UI. Feather library icons supply microphone, speech bubble, playback and sharing affordances.
- **Copy and content:** No title entry is required before recording. Start/stop/resume labels reflect the state. Finish reviews every clip and names the new memory. Lyrics lead; date/time/place remain secondary; conversation text appears in a sheet opened by a labelled speech-bubble button. New song content uses its own recorded dates and edited name.

## Interaction evidence

The primary journey was exercised through the in-app browser using ordinary UI input against the same React Native screens:

- Plus opens an empty date-based recording with the microphone off and finish disabled.
- Stop and resume preserve the draft, saved duration and independent conversation clips. Returning during recording finalizes the current clip once.
- Returning from a never-recorded draft removes it; saved drafts remain available for resuming.
- Finishing during recording includes the final clip. A three-clip run reviewed and retained all three conversations.
- Blank names disable creation. Editing the name to `秋の京都、三人旅。` creates a separate completed memory, preserving every clip's date/time/place.
- Original albums remain available. A finished memory is added to the library; home and recording return to white.
- Source buttons open the corresponding dialogue. Selecting a scene seeks to its lyric position and starts sample playback without leaving a sheet visible.
- Play/pause, arrow-key seeking and pointer seeking work. Web range accessibility exposes 0–204 seconds, the current second and a formatted spoken time.

The session reducer and date/source mapping were developed with meaningful RED → GREEN tests. Eighteen tests cover atomic stopping, duplicate actions, resuming, draft separation, finishing all clips, blank titles and date boundaries.

## Checks and limits

- `npm run format`: passed, 21 files, no pending formatting changes.
- `npm run lint` and `npm run check`: passed with Biome's recommended preset, 21 files.
- `npm run typecheck`: passed.
- `npm test`: 18/18 passed.
- `npm run export`: iOS, Android and Web bundles exported successfully. This is bundle validation, not a signed native binary build.
- `npm --prefix prototype run check:runtime`: passed, all 28 protected files intact.
- `git diff --check`: passed.
- The latest Web run produced no console errors. React Native Web emits compatibility deprecation warnings for native shadow properties and pointerEvents. Earlier native-driver/Web warnings were corrected by choosing the driver per platform; the historical Metro disconnect occurred during preview restart.
- Expo loaded and rendered the native library in the iPhone 17 Pro Max / iOS 26.5 simulator. `qa/expo/ios-home-final.png` includes Expo Go's first-run developer-menu overlay. The available native UI control timed out, so native navigation gestures, keyboard behavior and OS accessibility settings were not fully exercised. Android validation was limited to bundle export. Browser checks do not establish those native OS behaviors.
- Midnight and year-boundary behavior passed domain tests; it was not simulated by advancing the live browser clock.
- OS sharing passes song information to the share sheet. No message was sent; recipient delivery and a playback link are not implemented.

## Follow-up polish

- [P3, accepted] Standard native slider and Feather glyphs differ slightly from the reference's Web glyphs.
- [P3, accepted] OS-safe-area inclusion changes the seasonal image's exact cover crop without changing its art direction.
- [P3, accepted] React Native Web compatibility deprecation warnings remain; they do not block the verified journey.

## Implementation checklist

- [x] Expo / React Native foundation and accepted Expo/Biome ADRs.
- [x] White library and dedicated recorder, colored completed memory.
- [x] Stable recording toggle, independent drafts and all source clips retained.
- [x] Lyrics, per-conversation date/time/place and source sheet.
- [x] Full and focused fidelity comparisons after fixes.
- [x] Biome, type checking, 18 domain tests and three-platform bundle export.
- [x] Native testing limitations recorded explicitly.
