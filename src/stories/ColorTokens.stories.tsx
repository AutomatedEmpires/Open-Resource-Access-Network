import type { Meta, StoryObj } from '@storybook/react';

// ── Design Token Reference Sheet ─────────────────────────────────────────────
// A visual inventory of every semantic color token in globals.css.
// Edit globals.css @theme inline block to see changes here instantly.

const meta: Meta = {
  title: 'Design System / Color Tokens',
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj;

const Swatch = ({ label, cssVar, hex }: { label: string; cssVar: string; hex?: string }) => (
  <div className="flex items-center gap-3">
    <div
      className="h-10 w-16 rounded-md border border-black/10 shadow-sm"
      style={{ background: `var(${cssVar}, ${hex ?? '#ccc'})` }}
    />
    <div>
      <p className="text-xs font-semibold text-gray-800">{label}</p>
      <p className="font-mono text-[10px] text-gray-400">{cssVar}</p>
    </div>
  </div>
);

export const PageSurfaces: Story = {
  render: () => (
    <div className="space-y-3 p-6">
      <h2 className="mb-4 font-semibold text-gray-700">Page Surfaces</h2>
      <Swatch label="Background"  cssVar="--background" />
      <Swatch label="Foreground"  cssVar="--foreground" />
      <Swatch label="Page bg"     cssVar="--bg-page" />
      <Swatch label="Surface bg"  cssVar="--bg-surface" />
      <Swatch label="Border"      cssVar="--border" />
    </div>
  ),
};

export const Text: Story = {
  render: () => (
    <div className="space-y-3 p-6">
      <h2 className="mb-4 font-semibold text-gray-700">Text Colors</h2>
      <Swatch label="Primary text"   cssVar="--text-primary" />
      <Swatch label="Secondary text" cssVar="--text-secondary" />
      <Swatch label="Muted text"     cssVar="--text-muted" />
    </div>
  ),
};

export const ActionScale: Story = {
  render: () => (
    <div className="space-y-3 p-6">
      <h2 className="mb-4 font-semibold text-gray-700">Action / Brand Scale</h2>
      <Swatch label="action subtle"  cssVar="--color-info-subtle" />
      <Swatch label="action muted"   cssVar="--color-info-muted" />
      <Swatch label="action soft"    cssVar="--color-action-soft" />
      <Swatch label="action pale"    cssVar="--color-action-pale" />
      <Swatch label="action"         cssVar="--color-action" />
      <Swatch label="action-base"    cssVar="--color-action-base" />
      <Swatch label="action-strong"  cssVar="--color-action-strong" />
      <Swatch label="action-deep"    cssVar="--color-action-deep" />
      <Swatch label="action-max"     cssVar="--color-action-max" />
    </div>
  ),
};

export const ErrorScale: Story = {
  render: () => (
    <div className="space-y-3 p-6">
      <h2 className="mb-4 font-semibold text-gray-700">Error / Danger Scale</h2>
      <Swatch label="error subtle"  cssVar="--color-error-subtle" />
      <Swatch label="error muted"   cssVar="--color-error-muted" />
      <Swatch label="error soft"    cssVar="--color-error-soft" />
      <Swatch label="error accent"  cssVar="--color-error-accent" />
      <Swatch label="error pale"    cssVar="--color-error-pale" />
      <Swatch label="error light"   cssVar="--color-error-light" />
      <Swatch label="error base"    cssVar="--color-error-base" />
      <Swatch label="error strong"  cssVar="--color-error-strong" />
      <Swatch label="error deep"    cssVar="--color-error-deep" />
    </div>
  ),
};
