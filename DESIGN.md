# Orbit design rules

The galaxy is the universe. Everything around it is the workspace. Colour belongs to meaning (provider, live status, selection), not decoration.

Tokens live in `frontend/src/index.css` (`@theme`). `frontend/src/lib/theme.ts` reads the same values for the canvas.

## Audit (Phase 1, measured across `frontend/src/components`)

| Area | Finding | Rule that fixes it |
|---|---|---|
| Type | 12 different font sizes in use (10px to 22px), including 10.5, 11.5, 12.5, 13.5. Most are `text-[12px]` or `text-[11px]` written inline. | Five-step scale: `text-label` 11, `text-caption` 12, `text-body` 13, `text-title` 15, `text-display` 22. |
| Radius | `rounded`, `rounded-md`, `rounded-lg`, `rounded-xl` mixed with no rule. | See Radius below. |
| Surfaces | About 10 different `white/[0.0x]` fills for hover, selected and panel backgrounds. | Use the surface tokens. Do not add new white-alpha steps. |
| Controls | 53 `<Button>` uses, 39 raw `<button>` elements. `SettingsDialog`, `ProjectItem`, `Dialogs` and `ChatTab` carry the most raw buttons. | Every clickable control is a `Button`, an icon button, or a row. Raw buttons need a comment saying why. |
| Decoration | `Dialogs.tsx` has a warm radial gradient on a decorative orb. Chrome should not carry gradients. | Gradients only in the universe canvas. |
| Hex | Hex values outside tokens are limited to the terminal theme (`TerminalPanel.tsx`) and one SVG gradient in `TopBar.tsx`. Both are acceptable. | Terminal and SVG stops may keep literals. Everything else uses a token. |
| Focus | One focus ring is defined in `index.css` and applied to buttons, tabs, menu items and fields. Inputs add their own ring. | Keep one white focus ring. Do not add coloured glows. |
| Motion | `duration-150` is the standard. `duration-200` and `duration-100` appear rarely. | 150ms for controls, 180 to 220ms for panels and dialogs. Respect `prefers-reduced-motion`. |

## Type

- Use the scale tokens. Do not write new `text-[Npx]` values.
- Names and primary labels are `text-body` with `font-medium` or `font-semibold`.
- Secondary metadata is `text-caption` in `text-muted`. Tertiary text is `text-faint`.
- Monospace is for paths, ids, token counts and code only.
- Minimum readable size is `text-label` (11px). Never go smaller in the workspace.

## Colour and surfaces

- Canvas is `canvas`, panels are `sidebar`, cards and inputs are `surface`, floating layers are `popover`, hover is `hover`.
- List and navigation rows use `row-hover` and `row-active`, never ad-hoc white alpha.
- Prefer a surface step over a border. A border needs a job: separating two regions that have the same surface.
- Text: `ink` for primary, `muted` for secondary, `faint` for tertiary. Check contrast on the surface you place it on.
- Provider colours (`claude`, `codex`) appear only where a provider is identified.
- Status colours always appear with a shape or label. Colour alone never carries state.

## Radius

- `rounded-md` (6px): controls, buttons, inputs, menu items.
- `rounded-lg` (8px): cards, rows that hold content.
- `rounded-xl` (12px): dialogs and floating panels.
- `rounded-full`: avatars, status dots, pills.
- Plain `rounded` is not used.

## Spacing and size

- Use the Tailwind 4px scale. Avoid arbitrary pixel spacing.
- Control heights: `h-7` (sm, 28px), `h-8` (md, 32px). Icon buttons are `h-7 w-7` by default.
- Panel padding is `px-3` or `px-4`. Row height in lists is `h-8` or `h-9`.

## Interaction states

- Hover: one step up the surface scale, with `transition-colors duration-150`.
- Selected: a stronger surface plus `text-ink`. Do not rely on a coloured bar alone.
- Focus: the shared white ring, `outline-offset: 2px`.
- Disabled: `opacity-40` with `pointer-events-none`.
- Loading: a `Spinner` in place of the icon, and the label stays put so the layout does not shift.
- Errors: toasts from `actions.ts`, never thrown into components.

## Motion

- Easing tokens live in `index.css`: `--ease-out-expo` for arrivals (dialogs, panels, rows, toasts), `--ease-in-standard` for departures, `--ease-spring` for small pops, and `--ease-standard` for general transitions.
- Entrances use the `animate-*` utilities (`animate-menu-in`, `animate-rise-in`, `animate-float-in`, `animate-slide-in-left`, `animate-toast-in`). Exits that need the element kept mounted use the `Dialogs` retained-dialog pattern (`data-closing`), not a timer in each component.
- Lists animate on mount only, so rows that stay in place never replay their entrance.
- Animations must never delay an interaction. The state changes immediately and motion follows.
- Don't put `fill-mode: both` entrance animations on an element that also needs a hover or transform state: the final keyframe pins `transform` and overrides it.
- Reduced motion: decorative animation stops. State changes remain instant. The global block at the end of `index.css` covers the OS setting and the in-app "Reduce motion" choice, so new animations need no extra handling.

## Galaxy

- Inactive orbits are hairlines (0.75px, low alpha). The selected orbit is the clearest line.
- Planet labels carry a thin dark outline so they read over the nebula.
- Status text is truncated (34 characters) and the full detail is shown on hover or selection.
- Agent state is a shape first, colour second:
  - Thinking: solid ring, pulsing alpha.
  - Writing: solid ring with a soft glow.
  - Reading: marching dashes on the ring, slowed to static under reduced motion.
  - Waiting: dotted ring.
  - Completed: solid ring, green breathing glow, tick badge.
  - Failed: solid ring, expanding red ring, cross badge.
  - Stopped: sparse dashes at reduced strength.
  - Idle: hairline ring.
- Focusing an agent frames its whole orbit around the sun, with zoom held between 0.9 and 1.6.

## Status

- Phase 1 (audit and rules): done. This document.
- Phase 2 (shell): sidebar rows, top bar, status bar and the project-icon preview are on the tokens.
- Phase 3 (galaxy): orbit hairlines, label outlines, state shapes, and agent focus framing the whole orbit.
- Phase 4 (workspace): the launch dialog uses a searchable, grouped `ModelPicker`. Overview metrics are a divided grid. Chat tool-call runs and the Changes tab's staged and unstaged grouping were already in place.
- Phase 5 (consistency): every `text-[Npx]` maps to the type scale. Remaining: about 39 raw `<button>` elements, and about 60 ad-hoc white-alpha fills.
- Phase 6 (validation): typecheck, 184 frontend tests and Go tests pass, and a production build succeeds. A live visual pass in the running app has not been done.
