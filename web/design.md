# CapitalCall — Design System (lock file)

**Tone sentence:** *"Institutional private-wealth vault terminal — a controlled
fund-operations console that feels precise, trustworthy and calmly expensive."*
For: fund managers (GP), their limited partners (LP), and the auditor. Dark,
editorial, exact — money-moving UI must look like it can be trusted.

**Memorable trait:** the **atomic-settlement ring** — every shared mint is
visualized as a single animated arc that snaps LP escrow and GP share together
in one beat. Privacy shows as a hard "you see only your slice" divider.

## Color tokens (unique identity — never reused)
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#0B0D0C` | page ink (near-black, green-grey) |
| `--panel` | `#141817` | cards / surfaces |
| `--panel2` | `#1B201E` | raised surfaces |
| `--line` | `#262C2A` | borders / dividers |
| `--txt` | `#E9EFEC` | primary text |
| `--mut` | `#96A29D` | secondary text |
| `--acc` (signature) | **`#2FD9A2`** | veridine green — "settled/atomic", CTAs, active states |
| `--brass` | `#C8A25A` | capital-under-management, governed-treasury gold |
| `--warn` | `#E0705C` | overdue / declined / errors |
| `--cream` | `#F1EAE1` | a single light accent block (trust break) |

Signature accent = **Veridine Green `#2FD9A2`** (money "settled" green, fresh vs
prior magentas/ambers/purples). Brass `#C8A25A` signals the governed treasury.

## Typography (fresh pair — Sora/Inter/Clash all banned here)
- **Display / headings & numbers:** *Gambetta* (Fontshare, editorial serif) —
  headlines + the atomic-settlement figures. Weight 500/600.
- **Body / UI:** *Satoshi* (Fontshare) — 400/500/700.
- **Mono / on-ledger readouts, addresses, amounts-micro:** *JetBrains Mono*.
Loaded via Fontshare CSS API + Google Fonts mono, `<link>` tags (zero build).

## Theme
Dark (default). One cream `--cream` band mid-page for editorial trust rhythm.

## Hero architecture
Center-aligned editorial vault: Kickmark pill (Live Canton ledger) → serif
headline "Capital calls land atomically." → plain-language sub → two CTAs
(Treasury / LP console) → below, the product's OWN animated **atomic-settlement
panel** (LP escrow ring + GP share ring snapping together → minted LPShare —
the product's real output, CSS/JS-drawn). Real stock photo scrimmed into the
panel backdrop (private cap-table / fund office).

## Section lineup (landing `/`, order)
1. Hero (atomic-settlement panel, the signature image)
2. **What it solves** — 3 plain-value cards (Missed calls / counterparty gap / single-GP treasury)
3. **How it works** — 3-step (GP issues → LP pays + GP mints, one tx → auditor immutable)
4. Privacy divider — "Each LP sees only its own obligation" (real Canton disclosure)
5. Governed treasury — the gold "brass" band: threshold quorum, no single-GP moves
6. CTA band → `/app` product console
7. Footer

## Product console (`/app`, auth-gated)
- Header: brand, role badge (GP/LP/AUDITOR), connect/auth pill, nav (Dashboard / Calls / Treasury / Audit)
- GP: create fund → issue call → settle (atomic ring anim) → manage treasury
- LP: see ONLY own obligations, pay/settle view
- Auditor: full obligation + immutability view
- Mobile: sticky header → hamburger ≤900px; form rows flex-wrap; buttons full-width ≤560px

## Motion (CSS + IntersectionObserver, transform/opacity only)
- Settle ring: `settle-arc` keyframe (~900ms) — the signature interaction.
- Entrances: spring-pop `opacity 0 → 1, translateY(14px)`, stagger 80ms, cap 450ms.
- Hover: cards lift `-3px`, button press `scale(.97)`.
- One bounded ambient glow behind hero copy (≤ .45 opacity). Reduced-motion honored.

## Images
Real subject-matched stock (private fund operations / cap table / vault),
downloaded to `public/images/`, served from `/static/images/*`. Hero panel
overlaid on a real fund-office photo with a scrim. (see pexels-stock-search)