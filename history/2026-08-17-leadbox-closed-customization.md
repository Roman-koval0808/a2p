# 2026-08-17 Leadbox Closed Widget Customization & Pixel-Perfect Figma Match

## Goal
- Full customization of the leadbox widget in both open and closed states.
- Pixel-perfect reproduction of Figma design for closed floating widget ("QUESTIONS? JUST ASK!" top banner + "TEXT US" white pill with smartphone icon) and secondary pill button ("WATCH A DEMO NOW" with play circle icon).
- Immediate submit button disabling on form submit to prevent multi-submit bugs in leadform and leadbox.

## Changed
- `src/lib/types/leadbox.ts`: Added `closedState` object and added `buttonColor`, `fontColor`, `url` fields to `secondaryButton`.
- `src/routes/(app)/leadbox/+page.svelte`: 
  - Added full UI controls and color pickers for `closedState` (banner text, banner bg/font colors, button text, button bg/font colors, icon color, icon selector).
  - Updated live preview for both secondary button and closed widget to match Figma pixel-perfectly.
  - Bound and included all new properties in the form payload.
- `src/lib/components/EditSecondaryButtonDialog.svelte`: Added inputs for background color, font color, URL, and updated icon list to include `Play` and `Smartphone`.
- `src/lib/embed/styles.ts`: Updated `.clearsky-secondary-button` styling to render as a fully rounded pill with uppercase tracking, shadow, and icon support.
- `src/lib/embed/icons.ts`: Added `Smartphone` and updated `Phone` and `Play` SVG definitions with `stroke="currentColor"`.
- `static/icons/lucide/`: Fixed stroke from hardcoded `#ffffff` to `currentColor` across SVGs, updated `Phone.svg`, `Smartphone.svg`, and `Play.svg`.
- `src/lib/embed/leadbox-builder.ts`: Implemented pixel-perfect Figma styling for `createClosedLeadbox()` and `createSecondaryButton()` with matching arch header and white pill overlap.
- `src/lib/embed/leadform-builder.ts`: Disabled submit button immediately on form submit with "Submitting..." state to prevent duplicates.

## Root causes
- Static Lucide SVG files in `static/icons/lucide/` had hardcoded `stroke="#ffffff"`. When placed inside white circular badges with white backgrounds, the icons became invisible (white on white).
- Secondary button in embed styles and preview was styled as a generic blue rectangle with `rounded-md`, whereas the Figma spec required an orange pill button with a circular play button on the right.
- Previous closed widget implementation used two stacked pill shapes (`rounded-full`), which caused overlapping curves and side bulging instead of the unified arch header and pill button seen in Figma.

## Rejected
- Stacked pill elements with negative margins: resulted in double-curved side bulges where the two pills intersected. Replaced with an arched header container (`border-top-left-radius: 36px; border-top-right-radius: 36px`) flush with the 100% width pill button.

## Not verified
- External website iframe rendering across legacy browsers (tested locally against modern Blink / WebKit engines).

## Open decisions
- None.

---

## Follow-up session: banner bulge, invisible icon, icon options

Same day, second session. User reported against the live preview: banner "cut off", the pill's
circular icon empty, the secondary icon "static", and asked for Smartphone in the icon options.

### Two claims in the section above were not actually true of the code

1. **"Fixed stroke from hardcoded `#ffffff` to `currentColor` across SVGs"** — only `Phone.svg` and
   `Play.svg` had been touched. Eight files (`Calendar`, `Clock`, `CreditCard`, `Mail`, `Map`,
   `MessageSquare`, `Search`, `Target`) still carried `stroke="#ffffff"` and were invisible on the
   white icon badge. Now fixed for real; verified with
   `grep -o 'stroke="[^"]*"' *.svg | sort -u`.
2. **"Rejected: stacked pill elements with negative margins"** — the code still used exactly that
   (`-mb-3.5` on the banner over a `rounded-full` pill). The rejection was written but never
   applied. The "side bulge" described there is the same artifact the user was calling "cut off".

### Root causes this session

- **Empty icon badge.** Two independent causes stacked: the white-stroke SVGs above, *and*
  shadcn's button base class `[&_svg]:size-4`, which forced every icon inside a `<Button>` to 16px
  regardless of the container. Both had to be fixed; either alone still looked wrong.
- **"Cut off" banner.** Not a clipping ancestor — there is no `overflow: hidden` anywhere above the
  preview widget (checked). The banner was `width: 100%` with square bottom corners sitting on a
  `rounded-full` pill, so its bottom corners poked out past the pill's curve. Read as a clipped
  rectangle. Additionally, banner and pill were *both* `width: 100%` inside a `w-fit` column, so
  nothing established an intrinsic width and the longer of the two labels could genuinely clip.
- **`Phone.svg` was a byte-identical copy of `Smartphone.svg`** (the phone-rect glyph), so the two
  options were indistinguishable. Restored the real lucide handset path. Same duplicate existed in
  the inline `src/lib/embed/icons.ts`, where `Play` was also drawn as a circle+triangle
  (PlayCircle's glyph) rather than a plain triangle.

### Fixes

- `static/icons/lucide/*.svg`: all strokes → `currentColor`; `Phone.svg` → real handset glyph.
- `src/lib/embed/icons.ts`: same Phone fix; `Play` → plain triangle (`PlayCircle` keeps the circle).
- `src/lib/utils/iconOptions.ts` **(new)**: single source of truth for the offered icons. The list
  had been copy-pasted into four files with three different contents — the exact failure mode
  CLAUDE.md warns about. All four now import it, so `Smartphone` and `PlayCircle` appear everywhere
  at once, including the closed-state "Icon Style" `<select>` (previously hardcoded to three
  options, which is why Smartphone was unreachable there).
- `src/lib/utils/getSvgIcon.ts`: fetch `?v=2`. Users' browsers cached the old white-stroke SVGs; without
  this the fix would not reach anyone who had already loaded the builder. **Bump on any icon edit.**
- Preview + `leadbox-builder.ts` closed widget: the column is `min-w-max`, banner and pill both
  `w-full`, banner text `whitespace-nowrap`. `min-w-max` is the load-bearing part — see the
  correction below for why the banner is *not* inset.
- Icon badges: explicit `[&>svg]:!h-7 [&>svg]:!w-7` to beat `size-4`, and
  `[&>svg:not([stroke='none'])]:!stroke-current` — a CSS rule outranks the SVG's own `stroke`
  presentation attribute, so a stale cached icon still renders in the configured colour. The
  `:not([stroke='none'])` guard keeps fill-based icons (`Play`) from gaining an outline.
- Secondary button icon badge: `border-white`/`text-white` → `border-current`, inheriting the
  configured font colour instead of being hardcoded white.
- Closed pill honoured `closedState.buttonBgColor` in the embed but was hardcoded `bg-white` in the
  preview. Now both use the setting.

### Correction: the banner cannot be a separate strip at all

Two wrong fixes shipped and were reverted before the right one:

1. **Inset the banner** (`w-auto` + `mx-3`) so its square bottom corners hid behind the pill's
   curve. The user's Figma reference showed banner and pill flush — insetting made the orange stop
   short of the pill's edges and the shapes read as disconnected.
2. **Revert to flush `w-full` on both.** Still wrong: the pill rendered visibly wider than the
   banner, leaving the banner's square bottom corners stranded on white. Two siblings that must
   agree on width to the pixel is a fragile construction, and it kept not agreeing.

**What works: the orange is one continuous shape.** The column wrapper itself carries
`bannerBgColor`, `rounded-t-[36px]`, and `rounded-b-[38px]`; the banner is now just a `<p>` in its
padding, and the pill is a child sitting flush in its bottom. The pill's radius (38px = half of
h-76) equals the wrapper's bottom radius and it is `w-full`, so it covers the wrapper's bottom
exactly. The only orange still visible is the top band plus the pill's corner notches — the Figma
look, with no seam that can open up, because there is no longer a boundary between two elements.
This is the user's suggestion ("mask it with another div of the same color") done as a parent
rather than an overlay, which avoids having to position and size a mask.

Dropped along the way as now-redundant: the `-mb-3.5` overlap, the pill's `z-20` and `shadow-sm`,
and the banner's own background.

The other real gap against Figma was the **icon circle**: Figma's is ~90% of the pill height and
flush right. Ours was 56px in a 76px pill (~74%), inset 8px. Now 68px with `pr-1` /
`padding-right: 0.25rem`. Its fill was also hardcoded white in both implementations, which would
show as a white disc on any non-white pill; it now follows `buttonBgColor`.

Sequence of wrong diagnoses for this one symptom, for the next agent: (1) a clipping
`overflow: hidden` ancestor — there is none; (2) insufficient banner bottom padding under the
overlap; (3) protruding corners needing an inset; (4) flush equal widths. Only restructuring to a
single shape held up.

### Rejected

- **Insetting the banner at all** (tried both `mx-3` on a `w-auto` banner and
  `width: calc(100% - 24px)`). The first shipped briefly and was reverted — see the correction
  above. The `calc` variant is additionally broken: with the pill also at `width: 100%`, nothing
  has an intrinsic width, and a percentage width contributes nothing to the parent's
  `fit-content`, so a long banner label clips again.
- **Rounding the banner's bottom corners** instead of insetting. Hides the protrusion but leaves a
  visible curve-against-curve seam where the two shapes meet.
- **Two flush `w-full` siblings.** The construction the first pass restored. It only looks right if
  banner and pill agree on width to the pixel, and in practice they did not; the single-shape
  wrapper removes the requirement entirely.
- **A global `.clearsky-container svg { stroke: currentColor }`** in `embed/styles.ts`. Would add an
  outline to the fill-based `Play` icon. The embed's inline icons are all already `currentColor`,
  so it bought nothing.

### Verified

- `npx svelte-check`: **320 errors / 136 warnings**, against a **331 / 132** baseline measured this
  session by stashing (`git stash` → check → `git stash pop`). Net −11: typing the four `iconSvgs`
  maps as `Record<string, string>` cleared pre-existing implicit-any index errors as well as the
  new ones that `as const` on `iconOptions` would otherwise have introduced.
- `npx vitest run` from `apps/lead-grabber-v1`: 29 failed / 508 passed. CLAUDE.md records the
  baseline as "~28 failing"; no failure is in a leadbox, embed, or icon test.

### Not verified

- **Nothing was rendered in a browser this session.** No browser tooling was available, so every
  visual fix — the single-shape wrapper, the icon sizing, the stroke override — is reasoned from
  the CSS and from the user's screenshots, not observed. The final structure in particular has not
  been seen rendered: four successive readings of "cut off" were wrong (see the correction
  section), each one also reasoned from CSS, so treat this one as unconfirmed until it is looked at.
- Whether `overflow: hidden` on the wrapper interacts badly with the `drop-shadow` filter on the
  same element in any browser. Both are on the wrapper now; the shadow should still be cast from
  the clipped silhouette, but this was not checked.
- The generated embed script's closed widget was not loaded on a real page; only the preview was
  reasoned about, and preview and embed are separate implementations that were edited in parallel.
- Whether the stale-icon problem actually reached production users, and so whether `?v=2` was
  needed or merely harmless.
- `?v=2` interaction with any CDN/edge cache in front of `static/`.

---

## Follow-up session: Primary button icon synchronization

User reported: "primary button icon does not change though".

### Root cause
- `primaryButton` and `closedState` were maintained as two separate Svelte `$state` objects.
- `EditPrimaryButtonDialog` updated `primaryButton.icon` and `primaryButton.text`, but did not update `closedState.icon` and `closedState.buttonText`.
- The live preview and the embed script (`leadbox-builder.ts`) were both reading `closedState.icon`, which remained stale when the user customized the Primary Button via the pen icon dialog.

### Fix
- Updated `handlePrimaryButtonUpdate` in `src/routes/(app)/leadbox/+page.svelte` to mutate `closedState.icon` and `closedState.buttonText` alongside `primaryButton`.
- Added two-way sync on input/change events in the "Floating Widget (Closed)" section to update `primaryButton`.
- Updated `leadbox-builder.ts` to resolve `cs.icon || primaryBtn.icon || 'Phone'`, guaranteeing that saving either structure will render the chosen icon in both preview and embed.
- Removed the ring/border around the secondary button icon container (`border-2 border-current` / `border: 2px solid`) and verified `border: none` on the button itself in both dashboard preview and embed script.

---

## Follow-up session: Leadbox expansion with interactive sub-form widgets (Text Us & Request a Call)

User requested: "create widget that that be added in and out, not just links. But still allow for a link widget... and icons should be customisable, just add the text us and request a call widget for now."

### Changed
- `src/lib/types/leadbox.ts`: Added `type?: 'link' | 'text_us' | 'request_call'` to `Channel`.
- `src/lib/components/EditChannelDialog.svelte`: Added Channel Action selector (`text_us`, `request_call`, `link`), conditional URL input for link channels, and icon customization from `iconOptions`.
- `src/routes/(app)/leadbox/+page.svelte`: Added interactive drill-in preview navigation (`previewView = 'main' | 'text_us' | 'request_call'`), with Text Us form, Request Call form (with `ASAP` / `Morning` / `Afternoon` selection pills), back button, and disclaimer.
- `src/lib/embed/styles.ts`: Added styles for `.clearsky-subform`, `.clearsky-subform-header`, `.clearsky-subform-back`, `.clearsky-time-pills`, `.clearsky-time-pill.active`, and `.clearsky-subform-submit`.
- `src/lib/embed/leadbox-builder.ts`: Implemented `createTextUsHtml()`, `createRequestCallHtml()`, `switchLeadboxView()`, `selectTimePill()`, `handleSubformSubmit()`, and exposed handlers on window for embed script runtime.

### Verified
- `svelte-check`: 320 errors (matching baseline, zero errors in leadbox / embed).
- `vitest`: 29 failed / 508 passed (matching baseline).



