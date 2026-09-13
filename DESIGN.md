---
name: QueuePilot flight desk
description: A black operational frame surrounding a warm-paper YouTube release ledger.
sources:
  editorial_polarity: design-sources/sanity/DESIGN.md
  asymmetric_emphasis: design-sources/airtable/DESIGN.md
  technical_density: design-sources/linear/DESIGN.md
  product_artifacts: design-sources/cal/DESIGN.md
mode: black-frame-paper-ledger
fonts:
  sans: Instrument Sans Variable
  mono: IBM Plex Mono
colors:
  frame: "#0a0a09"
  frame_soft: "#121311"
  frame_raised: "#191a17"
  frame_line: "#292a26"
  paper: "#ecebe4"
  paper_raised: "#f5f4ed"
  paper_soft: "#e1e0d8"
  paper_line: "#cecdc4"
  ink: "#151612"
  ink_soft: "#4f514a"
  night_text: "#f4f3ec"
  night_muted: "#96978f"
  signal: "#ff795d"
  signal_hover: "#ff8a70"
radii:
  app: 5px
  control: 7px
  panel: 12px
  capsule: 9999px
spacing: [4px, 8px, 12px, 16px, 20px, 24px, 32px, 40px, 48px, 64px]
---

# Product idea

QueuePilot is a release flight desk. The dark frame holds navigation, channel
identity, and controls. The working records live on a warm-paper ledger that
feels closer to a production rundown sheet than a social-media dashboard.

The interface must answer:

1. What is still being prepared?
2. What is moving through the upload pipeline?
3. What has YouTube actually confirmed as scheduled?
4. What failed, and what can be recovered?

# Source synthesis

- Sanity contributes hard dark/light polarity, editorial headlines, sharp
  application radii, and IBM Plex Mono as a labelling system.
- Airtable contributes sober editorial rhythm, asymmetric emphasis, and
  confidence through surface blocks rather than decoration.
- Linear contributes compact technical controls, hairline hierarchy, and a
  restrained surface ladder.
- Cal contributes the principle that real product artifacts and records—not
  illustrations—should carry visual interest.

QueuePilot does not inherit any source product's navigation map, trademark,
accent color, or exact component composition.

# Signature composition

## Flight frame

The full page is near-black. A 64px horizontal masthead holds the custom runway
mark, product name, workspace/channel context, account control, and the single
coral `New upload` action. There is no permanent social-media-style sidebar.

## Release header

The page opens with a mono eyebrow and a 40px editorial title, followed by a
compact factual sentence. The active channel and display timezone appear as
operational metadata, not cards.

## Stage rail

Publishing states form a horizontal five-stage rail:

1. Drafts
2. Pipeline (`queued`, `uploading`, `processing`)
3. Scheduled
4. Published
5. Issues (`failed`, `cancelled`)

Each stage is a numbered text control with a real count. Active state uses a
coral rule and ink contrast—never a green pill or filled social-style tab.

## Release ledger

The primary working surface is warm paper. It has one large panel radius, a
dark-ink toolbar, and rule-separated records. Rows are not individual cards.
Real thumbnails or deterministic technical placeholders provide the visual
rhythm. Search, channel, tag, and list/calendar controls are embedded into the
ledger header.

## Control column

A narrow dark column sits beside the ledger on large screens. It holds real
channel authorization state and a factual release snapshot derived from the
same records. On smaller screens it stacks above the ledger.

# Color rules

- Black is the structural frame, not a card fill repeated everywhere.
- Warm paper is reserved for the content ledger and form reading surfaces.
- Coral `signal` appears once per viewport as the creation action, then only as
  a 2px active rule, focus ring, progress mark, or attention dot.
- YouTube red belongs only to YouTube identity.
- Semantic green, blue, ochre, and red appear only with explicit status text.
- No gradients, glows, blur, glass, or decorative pastel tiles.

# Typography

- Release title: 40px / 500 / 1.05 / -1.2px
- Ledger section: 20px / 500 / 1.2 / -0.3px
- Row title: 15px / 550 / 1.35
- Body: 14px / 400 / 1.5
- Control: 13px / 500 / 1.35
- Caption: 12px / 400 / 1.45
- Mono label: 10px / 400 / 1.4 / 0.08em

Instrument Sans carries all reading text. IBM Plex Mono is restricted to stage
numbers, times, file size, progress, timezone, IDs, and technical eyebrows.

# Shape and depth

- Application controls use 5–7px corners.
- The ledger and large control surfaces use 12px corners.
- The coral creation action may use a capsule shape; ordinary controls may not.
- Rows are divided with hairlines rather than enclosed in cards.
- Dark hierarchy uses surface stepping and borders; paper hierarchy uses rules.
- Shadows are limited to the paper ledger and modal dialogs.

# Composer

The composer continues the same polarity: black outer frame, warm-paper editor,
and a dark inspection column. It is a release manifest, not a social post box.

- Paper pane: media, title, description, audience, visibility, schedule.
- Dark pane: channel identity, YouTube preview, validation, storage transfer.
- Footer: Save draft, Upload now, Next available, Set date and time.
- Progress is always based on acknowledged bytes.

# Truth protocol

- Every channel, count, tag, record, date, and status comes from InsForge or a
  confirmed YouTube response.
- `publish_at` on a draft or pipeline record is labelled Target.
- Only `status = scheduled` may be labelled Scheduled.
- Existing YouTube Studio history is never implied to be imported.
- Unimplemented destinations and actions do not appear in navigation.
- All async surfaces define loading, empty, recoverable error, terminal error,
  and reauthorization-required states.

# Responsive behavior

- At 1200px and above, the ledger/control-column split is approximately 3:1.
- Below 1200px, the control column becomes a compact strip above the ledger.
- Below 768px, masthead controls collapse, the stage rail scrolls horizontally,
  toolbar controls wrap, and ledger rows stack without losing status or time.
- Touch targets are at least 44px; focus is always visible.

# Anti-template rules

- No left social-product navigation rail.
- No green primary CTA.
- No `All Channels` clone header.
- No Buffer-style Queue/Drafts/Approvals/Sent tab strip.
- No equal KPI cards, fake metrics, decorative charts, or sample releases.
- No icon on every text line and no nested rounded-card stacks.
- No huge empty-state illustration.

# Implementation discipline

- This file is the source of truth for new tokens and layout decisions.
- Tailwind names describe roles instead of raw colors.
- Preserve authentication, InsForge queries/RLS, storage ownership, and YouTube
  OAuth behavior during visual changes.
- Review at 1440px, 1024px, 768px, 390px, and 320px before release.
