import type { Meta, StoryObj } from '@storybook/react';

// ── Typography Reference Sheet ────────────────────────────────────────────────
// Shows every type ramp + font family in use.
// Edit the @theme inline block in globals.css to see changes here instantly.

const meta: Meta = {
  title: 'Design System / Typography',
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj;

export const TypeRamp: Story = {
  render: () => (
    <div className="space-y-6 p-6">
      <div>
        <p className="mb-1 font-mono text-[10px] text-gray-400">text-4xl / font-bold</p>
        <p className="text-4xl font-bold">Hero headline — ORAN</p>
      </div>
      <div>
        <p className="mb-1 font-mono text-[10px] text-gray-400">text-3xl / font-bold</p>
        <p className="text-3xl font-bold">Page title</p>
      </div>
      <div>
        <p className="mb-1 font-mono text-[10px] text-gray-400">text-2xl / font-semibold</p>
        <p className="text-2xl font-semibold">Section heading</p>
      </div>
      <div>
        <p className="mb-1 font-mono text-[10px] text-gray-400">text-xl / font-semibold</p>
        <p className="text-xl font-semibold">Card title</p>
      </div>
      <div>
        <p className="mb-1 font-mono text-[10px] text-gray-400">text-base / font-normal</p>
        <p className="text-base">Body text — Find verified government, nonprofit, and community services near you.</p>
      </div>
      <div>
        <p className="mb-1 font-mono text-[10px] text-gray-400">text-sm / font-normal</p>
        <p className="text-sm">Small body — Service details, phone numbers, addresses, eligibility notes.</p>
      </div>
      <div>
        <p className="mb-1 font-mono text-[10px] text-gray-400">text-xs / uppercase / tracking-widest</p>
        <p className="text-xs uppercase tracking-widest text-gray-400">Category label</p>
      </div>
    </div>
  ),
};

export const FontFamilies: Story = {
  render: () => (
    <div className="space-y-6 p-6">
      <div>
        <p className="mb-1 font-mono text-[10px] text-gray-400">font-sans (Patrick Hand — UI body)</p>
        <p className="font-sans text-2xl">The quick brown fox jumps over the lazy dog — 0123456789</p>
        <p className="font-sans text-base mt-1 text-gray-500">Find verified government, nonprofit, and community services near you.</p>
      </div>
      <div>
        <p className="mb-1 font-mono text-[10px] text-gray-400">font-display (Caveat — headings / display accents)</p>
        <p className="font-display text-4xl font-bold">ORAN — Open Resource Access Network</p>
        <p className="font-display text-2xl mt-1">Find help. Instantly. Verified.</p>
      </div>
      <div>
        <p className="mb-1 font-mono text-[10px] text-gray-400">font-mono</p>
        <p className="font-mono text-xl">--color-action-base: #6E6A67;</p>
      </div>
    </div>
  ),
};
