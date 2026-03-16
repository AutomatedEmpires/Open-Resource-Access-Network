import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from '@/components/ui/badge';

const meta: Meta<typeof Badge> = {
  title: 'UI / Badge',
  component: Badge,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof Badge>;

export const High: Story    = { args: { band: 'HIGH' } };
export const Likely: Story  = { args: { band: 'LIKELY' } };
export const Possible: Story = { args: { band: 'POSSIBLE' } };
export const Default: Story = { args: { children: 'Custom label' } };
export const AllBands: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3 p-4">
      <Badge band="HIGH" />
      <Badge band="LIKELY" />
      <Badge band="POSSIBLE" />
      <Badge>Default</Badge>
    </div>
  ),
};
