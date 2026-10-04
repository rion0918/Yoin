# Yoin library → recording → completed memory QA

final result: passed

Source visual truth: `design/library-recording-flow.png` (1501 × 1048), generated after the user's latest decision: library first, plus to record, white library/recorder, color only for completed music. The previously approved `design/seasonal-reference.png`, `public/assets/yoin/kyoto-artwork.png`, and `public/assets/yoin/season-background.png` remain the completed-song visual/asset references.

Implementation: http://127.0.0.1:4173/

## Comparison setup and evidence

- Browser viewport for captures: 1200 × 1200. Pixel screen measured exactly 427 × 952 CSS px, so the phone was unscaled. App-only comparisons use the centered 390 × 840 content area below the 64px status bar, excluding Android's protected bottom navigation region. Captured PNG pixels equal logical CSS pixels (1:1); no density stretching.
- Source content crops were proportionally downsampled to 390px width: home 390 × 844, recorder 390 × 843, music 390 × 839. The 1–4px height difference is from the generated board's panel proportions, not an app layout discrepancy.
- State: home with the original Kyoto album; new recorder, microphone off, zero clips/time; original completed Kyoto song paused at 0:42. The source's enabled finish button at zero clips is intentionally corrected to disabled.
- Final implementation captures: `qa/flow/home-final.png`, `qa/flow/record-empty-final.png`, `qa/flow/music-final.png`.
- Full-view comparison containing both source and implementation: `qa/flow/comparison-full-final.png`.
- Focused comparison of library hierarchy/card, microphone state/control, and lyrics/context/source buttons: `qa/flow/comparison-focused-final.png`.
- Other states: `record-active.png`, `record-paused.png`, `finish-review.png`, `completed-new-song.png`, `memory-source.png`, `library-with-new-song.png` in `qa/flow/`.
- iPhone captures: `qa/flow/iphone-record.png`, `qa/flow/iphone-music.png`, 390 × 798 app crops from an unscaled 393 × 852 screen; the iOS home indicator remains protected runtime chrome. Shorter screen compacts recording whitespace and album height without hiding the main controls.

## Comparison history and fixes

1. **[P1] Previous home painted beneath the recorder.** `qa/flow/comparison-iteration1.png` shows home text and artwork leaking into the pushed recorder. Added opaque white page surfaces. Inactive content is now inert and hidden from assistive technology while the protected FlowStack owns navigation. Post-fix evidence: `comparison-record.png`, then `comparison-full-final.png`.
2. **[P2] Recording control hierarchy was too small.** The first pass used a 120px primary circle and a small unframed state icon. Matched the 144px primary control, 112px state circle, and 32px provisional title. Post-fix evidence: `comparison-record-final.png` and the final focused comparison.
3. **[P2] Saved clip rows could shift the record button.** Removed flexible centering that changed with list length. The control remains fixed in the content column while added conversations extend below. Native browser checks confirmed identical button bounds after each of three stop/resume cycles and on iPhone; see `interaction-green.json`.
4. **[P2] Library metadata/hierarchy were undersized and duplicated.** Increased the heading and date sizes and removed the redundant song subtitle and extra section count. Earlier comparison: `comparison-home-final.png`; post-fix evidence: `comparison-full-final.png` and `home-final.png`.
5. **[P2] The music background restarted below its header.** The first completed native preview showed a horizontal color seam. Aligned the scene's raster background over the full app height instead of independently cropping the content area. Post-fix evidence: `music-final.png` and `iphone-music.png`.
6. **[P2] Finish initially kept only two conversations.** Read-only code review caught truncation. All captured clips now remain available as lyric/source moments. A three-clip browser regression confirmed three retained moments after finishing, with correct timestamps; see `interaction-green.json`.
7. **[P2] Back gestures could leave recording/playback active.** Added page-exit state handling in app-owned components, alongside the explicit stop-and-return recording label. Header return and recording resume were verified in the browser; touch edge-swipe recognition itself remains owned by the unchanged runtime.
8. **[P2] Multi-day clips used the session's first date.** Each clip now carries its own recording date, and completed lyric/source details use it; finished album dates form a range when required. Today's date and per-clip datetime values were verified. Crossing midnight was not simulated in the browser.

The final combined full and focused comparisons were opened and inspected after the fixes. A second read-only design review found no remaining P0/P1/P2 visual findings.

## Required fidelity surfaces

- **Fonts/typography:** Japanese system sans throughout; 38px library title, 32px recording and memory titles, 40px timer, 22px main lyrics. Optical weights, tight heading tracking, tabular time, wrapping and metadata were checked in the combined comparisons. Standard library microphone icons intentionally use an outline style rather than reproducing the generated image's filled glyph.
- **Spacing/layout rhythm:** Two-column cover grid, sparse fixed recording column, separate finish action, single-column music with persistent player. Album squares, page insets, circles, source controls, list placement and both device safe areas were checked. Empty and populated lists are scrollable without moving the primary recording control as clips are added.
- **Colors/tokens:** Library and recording are white. Only the music page uses the approved muted amber/stone raster background. The original subdued background and photo are intentionally retained instead of replacing them with the board's newly generated brighter artwork. Solid-color contrast checks: primary text on white 15.07:1, secondary on white 5.11:1, active amber on white 5.23:1, recording button text/icon 11.54:1; see `contrast-tokens.json`. These are token ratios, not a pixel-level contrast claim for every photographic background point.
- **Image quality/assets:** Existing high-resolution Kyoto PNG and seasonal raster were reused without distortion. Album grid uses a square object-fit crop; the completed page adapts its landscape image height per device. No generated screen is embedded as fake functional UI, and no CSS/SVG drawing replaces photography. Icons come from Radix and Lucide.
- **Copy/content:** Library/recorder/finish roles are distinct. No title input before recording; explicit microphone state and start/stop/resume labels. Source conversations remain behind accessible speech-bubble controls. New completed memory uses the edited name and captured dates/times, rather than the original album's dates.

## Interaction verification

Manual native in-app-browser input; no injected app state or synthetic DOM events.

- RED before implementation: library/new-recording/recorder controls absent, documented in `qa/flow/red.json`.
- Plus opens an untitled date-based recording with microphone off, zero time/clips, finish disabled.
- Start, stop and resume preserve the same draft and increase its saved clips/time; the timer stops while microphone is off.
- A new recording receives a different identity and does not mix earlier saved conversations.
- Stop-and-return keeps saved conversations for resuming; leaving without recording removes the empty draft.
- Finish reviews all saved conversations, supports title editing through the protected keyboard-aware field, dismisses the keyboard, replaces the recorder with the completed memory, and adds it to the library.
- Generated lyric moments retain conversation date/time/place. Three conversations remain available after finish.
- The completed source-conversation sheet opens; its scene action seeks to the associated lyric and starts mock playback.
- Original albums remain available; returning home restores white background.
- iPhone start/stop uses identical button bounds; stored clip details open from the recorder. Recording controls and persistent music player remain clear of the home indicator.
- Outer device-screen scroll stayed at 0 during the verified flows.

## Checks and boundaries

- `npm run check:runtime`: passed, all 28 protected runtime files intact.
- `npm run build`: passed (TypeScript and Vite).
- Browser console final clean-load check is recorded in `qa/flow/console-final.json`.
- This is a local frontend prototype. Recording, source dialogue, locations, artwork/music selection, and playback are simulated. There is no microphone/location permission request, real audio capture, transcription, music synthesis, backend or persistent storage. Reload resets the in-memory session.
- Native keyboard editing and both device layouts were verified. Real touch edge swipes, OS reduced-motion/transparency settings, and a midnight-spanning recording were not separately exercised in this run. Existing protected gesture runtime and app CSS alternatives are preserved.

## Follow-up polish

- [P3, accepted] Generated board proportions differ from the real mobile viewport by a few pixels; the app follows the calibrated runtime and safe areas.
- [P3, accepted] Keep the user's previously approved muted background/photo and platform-standard share/microphone icons rather than mimicking small image-generation variations.

## Implementation checklist

- [x] White album library with top-right plus.
- [x] Dedicated title-free recorder with stable on/off control and saved clips.
- [x] Separate finish/review and completed colored memory.
- [x] All captured source conversations and dates retained.
- [x] Source/implementation compared together, full and focused, after fixes.
- [x] Both calibrated devices verified; protected runtime and build passed.
