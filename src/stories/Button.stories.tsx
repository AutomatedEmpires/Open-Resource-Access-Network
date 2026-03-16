import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '@/components/ui/button';

const meta: Meta<typeof Button> = {
  title: 'UI / Button',
  component: Button,
  tags: ['autodocs'],
  args: { children: 'Button' },
};
export default meta;

type Story = StoryObj<typeof Button>;

export const Primary: Story = { args: { variant: 'default', children: 'Find services' } };
export const Outline: Story = { args: { variant: 'outline', children: 'Learn more' } };
export const Secondary: Story = { args: { variant: 'secondary', children: 'Secondary' } };
export const Ghost: Story = { args: { variant: 'ghost', children: 'Ghost' } };
export const Destructive: Story = { args: { variant: 'destructive', children: 'Delete' } };
export const Crisis: Story = { args: { variant: 'crisis', children: 'Crisis Support' } };
export const Link: Story = { args: { variant: 'link', children: 'Back to home' } };
export const Small: Story = { args: { size: 'sm', children: 'Small' } };
export const Large: Story = { args: { size: 'lg', children: 'Large' } };
export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3 p-4">
      <Button variant="default">Primary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="crisis">Crisis</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
};
