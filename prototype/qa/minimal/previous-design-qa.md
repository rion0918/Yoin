# Yoin — refined lyric memories prototype

final result: passed

**Findings**

No actionable P0/P1/P2 findings remain in the reviewed frontend scope. The prototype preserves trip date, time and place alongside each lyric, opens the originating conversation in a phone-scoped sheet, and retains one playback state between the screen and sheet.

- [P3, accepted] Generated artwork is a new photograph with the same subject and direction rather than the identical reference photograph. Three friends, a Kyoto hillside street, warm sunset and the pagoda remain clear. The image is sharp at the intended size and is reused in player, library and sharing states.
- [P3, expected] The reference depicts a pause icon at 0:42. The captured implementation is paused at 0:42 and displays a play icon. Playback starts only after an explicit action.
- [P3, accepted] The generated reference has no font metadata. System Japanese typography approximates the observed weights and hierarchy. Small interface copy is darker than the source for readability. The Android share icon follows the selected Pixel device.

**Evidence and normalization**

- Source visual truth: `design/reference.png` (853 × 1844 pixels), the revised mock based on the selected third concept.
- Source normalized once to `qa/reference-normalized.png` (390 × 843 pixels), maintaining aspect ratio with rounded output height.
- Implementation: `http://127.0.0.1:4173/`, frontend-only local preview.
- Browser layout viewport for fidelity capture: 1200 × 1200 CSS pixels. Pixel device screen verified at 427 × 952 CSS pixels and captured at 427 × 952 raster pixels: `qa/android-main-final.jpg`. Effective capture density: one image pixel per CSS pixel.
- App comparison crop: centered 390 × 840 pixels, removing protected status and Android navigation regions (64 pixels top, 48 pixels bottom): `qa/android-content-final.jpg`. The source contains only app content, so device chrome is excluded from comparison. The three-pixel height difference is retained, not stretched.
- Same state: Kyoto trip, white theme, first lyric moment, scroll at start, player at 0:42. Reference playing / implementation paused is the expected control-state difference described above.
- Full-view source and implementation examined together: `qa/comparison-final.png`.
- Focused lyric timeline and player examined together: `qa/lyrics-comparison-final.png` (source and implementation crop x=0..390, y=475..830).
- Conversation sheet: `qa/android-conversation.jpg`, 427 × 952 pixels, first scene, date/time/place and original dialogue visible. Native tap preserved device-screen scrollTop=0 before capture.
- Alternate preset: `qa/iphone-final.jpg`, 393 × 852 CSS/raster pixels at density 1. Smaller protected safe-area geometry is expected to change the hero height and require scrolling for the last scene action. The persistent player stays inside the screen, and final content can scroll above it.
- iPhone width repair evidence: `qa/iphone-width-comparison.png` shows before and after at the same device size.
- User-facing two-screen preview: `qa/preview.png`, composed from actual browser screen captures.

**Required fidelity surfaces**

1. Fonts and typography: reviewed full view and readable focused crop. The 34px/800 trip title, 20px/750 lyric type, compact 14px context and 12–13px player text maintain the reference hierarchy. The two-line first lyric and single-line second lyric wrap as intended. Player title truncation is available for overflow. Exact raster glyph/antialiasing parity is not possible with an image-generated source of unknown font; remaining differences are P3.
2. Spacing and layout rhythm: primary content max-width 390px with 16px inner padding, 230px Pixel artwork, compact section gaps, 44px conversation hit areas and 74px persistent player. Both lyric moments and their action text appear above the player in the primary comparison. Smaller iPhone content remains full width; bottom padding supports scrolling the final action clear of the player.
3. Colors and tokens: white surface, ink #132f51, secondary #5d718b, coral #ff745f, rule #e4e9ef. Secondary text is approximately 5:1 against white. Coral marks and timeline strokes are decorative; readable date/place and playback value carry the information. Visible focus outlines, opaque alternatives and reduced-motion styles are present. Actual OS accessibility preference modes were not exercised.
4. Image quality: the independent 1561 × 1007 PNG is a photographic asset, not a recreated CSS illustration. Correct three-person subject, clear Kyoto setting, clean crop and rounded mask, no broken images, no halos. Thumbnail reuse is coherent and sufficiently sharp. Standard interface symbols use the installed Radix icon library.
5. Copy and content: Japanese trip name, sample members, trip dates, song title, both original time/place pairs, dialogue excerpts and resulting lyrics match the intended journey. Song offsets 0:42 / 1:48 remain distinct from trip times 17:23 / 18:40. No AI implementation copy is exposed in the main experience.

**Comparison history**

- Iteration 1, blocked: `qa/comparison-1.png` / `qa/lyrics-comparison-1.png` exposed excessive timeline height, too-light secondary text and a smaller-screen action crowded by the player (P2). Reduced section/verse/quote gaps, retained 44px button hit areas using compact visual margins, and changed secondary text to #5d718b.
- Capture attempt 2 was invalid: generic scroll/locator automation moved the protected device shell. `qa/comparison-2.png` and `qa/lyrics-comparison-2.png` are excluded from acceptance evidence; they do not represent the normal rendered state.
- Iteration 3, blocked: `qa/comparison-3.png` / `qa/lyrics-comparison-3.png` still showed a weak trip-title hierarchy and the second scene action behind the player (P2). Increased title to 34px/800 and tightened app-owned top, metadata, artwork and inter-scene spacing.
- Iteration 4: `qa/comparison-4.png` / `qa/lyrics-comparison-4.png` showed both scene actions above the player, with title hierarchy restored. A normal tap verified shell position. Close-button focus uses preventScroll. Only the handle can re-grab an exiting sheet, fixing repeat-close reopening.
- Alternate-size review, blocked: `qa/iphone-before-width-fix.jpg` revealed intrinsic image sizing narrowing the entire main content (P2). Added width:100% to `.yoin-content`. `qa/iphone-width-comparison.png` and `qa/iphone-final.jpg` verify the artwork is now 358px wide and the persistent player remains in bounds.
- Final comparison after all changes: `qa/comparison-final.png` / `qa/lyrics-comparison-final.png`, reopened and judged together. No actionable P0/P1/P2 drift remains. Android screen shell is unscrolled, controls remain visible, and all images load.

**Interaction verification**

Manual browser evidence is recorded in `qa/interaction-checks.json`.

- RED: initial template had no lyric-memory screen. GREEN: both lyric moments and their trip context render.
- Correct conversation details open for each place; playback state persists after complete dismissal.
- Play/pause, continuous pointer seeking, keyboard Home/End, song boundary stopping, and current-scene selection were checked. Corrected native-range checks read input.value rather than a nonexistent aria-valuenow attribute.
- Downward handle dismissal, repeat close after interrupted exit, listen-to-scene at 1:48, library return, share preview and local-link copy passed.
- Native tap at the normal preview size preserved device-screen scrollTop=0. Enlarged-viewport locator scrolling is documented as a verification-tool artifact, not accepted as a rendered screenshot state.
- Final actual range values were 204 at End and 0 at Home, selecting the correct scene each time.
- Browser warning/error logs: none on the verified tab.
- `npm run check:runtime`: passed, all 28 protected files intact.
- `npm run build`: passed after final changes (TypeScript + Vite).
- The template's automated runtime test suite was not run; these are manual in-app-browser interaction checks.

**Open questions and limits**

No unresolved design choice blocks this refinement. Audio, recorded conversations, real location provenance, generation/payment/backend services and a hosted recipient page are outside this frontend prototype. Playback advances a simulated clock and produces no sound. Link copying uses the local preview URL. Physical-device performance, screen-reader traversal and OS preference changes remain unverified.

**Implementation checklist**

- [x] Keep date/time/place adjacent to each lyric moment.
- [x] Connect each lyric to its original sample conversation through a reversible sheet.
- [x] Preserve playback position and expose scene seeking.
- [x] Fix P2 composition, contrast and alternate-device width findings.
- [x] Re-capture and compare full view plus focused region after repairs.
- [x] Verify runtime integrity, build, key interactions and console logs.
- [x] Leave the verified local preview open; no deployment performed.

**Follow-up polish**

Tune real-audio synchronization and word highlighting when a song asset is available. Check voice-over navigation and actual reduced-motion preferences on a physical device before treating this as production UX.
