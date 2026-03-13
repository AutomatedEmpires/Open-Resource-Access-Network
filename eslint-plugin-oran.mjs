/**
 * eslint-plugin-oran — local ESLint rules for the ORAN design system.
 *
 * Rule: no-unapproved-arbitrary
 *   Warns when a Tailwind arbitrary value (e.g. `min-h-[37px]`) is used that
 *   is NOT on the approved list in docs/ui/UI_UX_TOKENS.md §11.
 *
 *   CSS-variable references (`z-[var(--z-nav)]`) and Radix data-attribute
 *   selectors (`data-[state=open]`) are unconditionally approved.
 */

/**
 * Every arbitrary Tailwind value that is explicitly approved.
 * Source of truth: docs/ui/UI_UX_TOKENS.md §11
 */
const APPROVED_ARBITRARY = new Set([
  // ── a11y minimum touch targets ──────────────────────────────────────────
  'min-h-[44px]', 'min-w-[44px]',

  // ── Accessibility icon / badge sizes (inside labeled containers) ─────────
  'min-h-[28px]', 'min-h-[32px]', 'min-h-[36px]', 'min-h-[38px]', 'min-h-[40px]', 'min-h-[46px]', 'min-h-[48px]',
  'min-h-[54px]', 'min-h-[60px]', 'min-h-[80px]',
  'min-w-[14px]', 'min-w-[16px]', 'min-w-[24px]', 'min-w-[28px]', 'min-w-[36px]',
  'min-w-[48px]', 'min-w-[120px]', 'min-w-[160px]', 'min-w-[200px]',

  // ── Viewport / content-well heights ─────────────────────────────────────
  'h-[60vh]', 'h-[50vh]', 'min-h-[60vh]',
  'max-h-[85vh]', 'max-h-[80vh]',
  'h-[calc(100dvh-13rem)]', 'h-[calc(100vh-16rem)]', 'max-h-[calc(100vh-16rem)]',

  // ── Truncation constraints ────────────────────────────────────────────────
  'max-w-[120px]', 'max-w-[180px]', 'max-w-[200px]', 'max-w-[220px]',
  'max-w-[18rem]', 'max-w-[22rem]', 'max-w-[85%]', 'max-w-[88%]',
  'max-h-[120px]', 'max-h-[160px]', 'max-h-[420px]',

  // ── Grid template columns ─────────────────────────────────────────────────
  'grid-cols-[1fr,auto,auto]', 'grid-cols-[1fr_380px]', 'grid-cols-[1fr_auto]',
  'grid-cols-[minmax(0,1fr)_280px]',

  // ── Sub-xs font sizes for badges / metadata labels ────────────────────────
  'text-[9px]', 'text-[10px]', 'text-[11px]', 'text-[15px]', 'text-[2rem]', 'text-[15px]', 'text-[2rem]',

  // ── Positioning ───────────────────────────────────────────────────────────
  'bottom-[4.5rem]', 'top-[20%]',

  // ── Animation delays (inline chat loading dots) ───────────────────────────
  '[animation-delay:-0.3s]', '[animation-delay:-0.15s]',

  // ── Page transition animation ─────────────────────────────────────────────
  'animate-[page-enter_var(--transition-standard)_both]',

  // ── Letter spacing ────────────────────────────────────────────────────────
  'tracking-[0.22em]', 'tracking-[0.24em]', 'tracking-[0.24em]',

  // ── Border radius (chat & card surfaces) ──────────────────────────────────
  'rounded-[18px]', 'rounded-[22px]', 'rounded-[24px]', 'rounded-[26px]',
  'rounded-[28px]', 'rounded-[30px]',

  // ── Surface gradients (chat, seeker cards, panels) ────────────────────────
  'bg-[linear-gradient(145deg,_rgba(236,253,245,0.92),_rgba(255,255,255,0.96))]',
  'bg-[linear-gradient(145deg,_rgba(236,253,245,0.96),_rgba(255,255,255,0.95))]',
  'bg-[linear-gradient(145deg,_rgba(239,246,255,0.96),_rgba(255,255,255,0.95))]',
  'bg-[linear-gradient(145deg,_rgba(239,246,255,0.96),_rgba(255,255,255,0.96))]',
  'bg-[linear-gradient(145deg,_rgba(255,255,255,0.97),_rgba(240,249,255,0.88))]',
  'bg-[linear-gradient(180deg,_rgba(248,250,252,0.95),_rgba(255,255,255,0.92))]',
  'bg-[linear-gradient(180deg,_rgba(255,251,235,0.95),_rgba(255,247,ed,0.95))]',
  'bg-[linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(248,250,252,0.98))]',
  'bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.28),_transparent_65%)]',
  'bg-[radial-gradient(circle_at_top,_rgba(226,232,240,0.45),_transparent_36%),linear-gradient(180deg,_rgba(248,250,252,0.72),_rgba(241,245,249,0.52))]',
  'bg-[radial-gradient(circle_at_top_left,_rgba(191,219,254,0.45),_transparent_28%),linear-gradient(180deg,_#f8fbff_0%,_#f5f7fb_55%,_#eef4f7_100%)]',
  'bg-[radial-gradient(circle_at_top_left,_rgba(191,219,254,0.45),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(167,243,208,0.28),_transparent_24%),linear-gradient(180deg,_#f8fbff_0%,_#f5f7fb_55%,_#eef4f7_100%)]',

  // ── Additional surface gradients (directory, map, seeker panels) ────────
  'bg-[linear-gradient(145deg,_rgba(255,255,255,0.98),_rgba(239,246,255,0.82))]',
  'bg-[linear-gradient(145deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.92))]',
  'bg-[linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.94))]',
  'bg-[linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96))]',
  'bg-[radial-gradient(circle_at_top,_rgba(186,230,253,0.32),_transparent_26%),linear-gradient(180deg,_#f7fafc_0%,_#f8fbfd_48%,_#f2f7fb_100%)]',
  'bg-[radial-gradient(circle_at_top_left,_rgba(191,219,254,0.42),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(167,243,208,0.2),_transparent_24%),linear-gradient(180deg,_#f8fbff_0%,_#f5f7fb_55%,_#eef4f7_100%)]',

  // ── Additional border radius ──────────────────────────────────────────────
  'rounded-[20px]',

  // ── Box shadows (chat & card surfaces) ────────────────────────────────────
  'shadow-[0_8px_24px_rgba(15,23,42,0.04)]',
  'shadow-[0_8px_24px_rgba(234,88,12,0.04)]',
  'shadow-[0_10px_30px_rgba(15,23,42,0.04)]',
  'shadow-[0_10px_30px_rgba(16,185,129,0.08)]',
  'shadow-[0_10px_30px_rgba(120,53,15,0.08)]',
  'shadow-[0_10px_30px_rgba(180,83,9,0.08)]',
  'shadow-[0_10px_30px_rgba(234,88,12,0.04)]',
  'shadow-[0_12px_32px_rgba(15,23,42,0.08)]',
  'shadow-[0_12px_32px_rgba(127,29,29,0.08)]',
  'shadow-[0_12px_32px_rgba(234,88,12,0.06)]',
  'shadow-[0_12px_32px_rgba(234,88,12,0.08)]',
  'shadow-[0_12px_40px_rgba(14,116,144,0.08)]',
  'shadow-[0_12px_40px_rgba(16,185,129,0.08)]',
  'shadow-[0_12px_40px_rgba(16,185,129,0.10)]',
  'shadow-[0_12px_40px_rgba(251,113,133,0.10)]',
  'shadow-[0_18px_50px_rgba(15,23,42,0.06)]',
  'shadow-[0_18px_50px_rgba(234,88,12,0.06)]',
  'shadow-[0_18px_55px_rgba(15,23,42,0.10)]',
  'shadow-[0_18px_55px_rgba(234,88,12,0.12)]',
  'shadow-[0_12px_28px_rgba(15,23,42,0.06)]',
  'shadow-[0_18px_40px_rgba(15,23,42,0.08)]',
  'shadow-[0_24px_80px_rgba(15,23,42,0.08)]',
  'shadow-[0_24px_80px_rgba(234,88,12,0.10)]',
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]',
]);

/** CSS custom-property references: always approved (`z-[var(--z-nav)]` etc.). */
const CSS_VAR_RE = /\[var\(/;

/** Radix data-attribute selectors: always approved (`data-[state=open]` etc.). */
const DATA_ATTR_RE = /^data-\[/;

/** Matches any Tailwind arbitrary-value class: `something-[value]`. */
const ARBITRARY_RE = /\b[\w-]+-\[[^\]\s]+\]/g;

function isApproved(cls) {
  if (CSS_VAR_RE.test(cls)) return true;
  if (DATA_ATTR_RE.test(cls)) return true;
  return APPROVED_ARBITRARY.has(cls);
}

function checkString(context, node, str) {
  const matches = str.match(ARBITRARY_RE) ?? [];
  for (const cls of matches) {
    if (!isApproved(cls)) {
      context.report({
        node,
        message: `Unapproved Tailwind arbitrary value "{{cls}}". Add it to the approved list in docs/ui/UI_UX_TOKENS.md §11 or use a design token instead.`,
        data: { cls },
      });
    }
  }
}

const noUnapprovedArbitrary = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow unapproved Tailwind arbitrary values',
      url: 'docs/ui/UI_UX_TOKENS.md',
    },
    schema: [],
    messages: {},
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name?.name !== 'className') return;
        if (!node.value) return;

        // className="static string"
        if (node.value.type === 'Literal') {
          checkString(context, node, String(node.value.value));
          return;
        }

        // className={...}
        if (node.value.type === 'JSXExpressionContainer') {
          const expr = node.value.expression;

          // className={"static string"}
          if (expr.type === 'Literal') {
            checkString(context, node, String(expr.value));
            return;
          }

          // className={`template ${x}`} — check static quasis only
          if (expr.type === 'TemplateLiteral') {
            for (const quasi of expr.quasis) {
              checkString(context, node, quasi.value.raw);
            }
          }
        }
      },
    };
  },
};

const plugin = {
  meta: { name: 'eslint-plugin-oran' },
  rules: {
    'no-unapproved-arbitrary': noUnapprovedArbitrary,
  },
};

export default plugin;
