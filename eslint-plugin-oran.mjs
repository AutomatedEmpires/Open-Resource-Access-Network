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
  'min-h-[28px]', 'min-h-[32px]', 'min-h-[36px]', 'min-h-[60px]', 'min-h-[80px]',
  'min-w-[14px]', 'min-w-[16px]', 'min-w-[24px]', 'min-w-[28px]', 'min-w-[36px]',
  'min-w-[160px]', 'min-w-[200px]',

  // ── Viewport / content-well heights ─────────────────────────────────────
  'h-[60vh]', 'h-[50vh]', 'min-h-[60vh]',
  'max-h-[85vh]', 'max-h-[80vh]',
  'h-[calc(100dvh-13rem)]', 'h-[calc(100vh-16rem)]', 'max-h-[calc(100vh-16rem)]',

  // ── Truncation constraints ────────────────────────────────────────────────
  'max-w-[120px]', 'max-w-[180px]', 'max-w-[200px]', 'max-w-[220px]', 'max-w-[18rem]', 'max-w-[85%]',
    'max-h-[120px]', 'max-h-[160px]', 'max-h-[420px]',

  // ── Grid template columns ─────────────────────────────────────────────────
  'grid-cols-[1fr,auto,auto]', 'grid-cols-[1fr_380px]', 'grid-cols-[1fr_auto]',

  // ── Sub-xs font sizes for badges / metadata labels ────────────────────────
  'text-[9px]', 'text-[10px]', 'text-[11px]',

  // ── Positioning ───────────────────────────────────────────────────────────
  'bottom-[4.5rem]', 'top-[20%]',

  // ── Animation delays (inline chat loading dots) ───────────────────────────
  '[animation-delay:-0.3s]', '[animation-delay:-0.15s]',

  // ── Page transition animation ─────────────────────────────────────────────
  'animate-[page-enter_var(--transition-standard)_both]',
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
