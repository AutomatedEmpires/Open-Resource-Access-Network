import type { Preview } from '@storybook/react';
import '../src/app/globals.css';

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light',  value: '#F7F4EF' },
        { name: 'white',  value: '#FFFFFF' },
        { name: 'dark',   value: '#1A1A1A' },
      ],
    },
    viewport: {
      viewports: {
        mobile:  { name: 'Mobile 375', styles: { width: '375px', height: '812px' } },
        tablet:  { name: 'Tablet 768', styles: { width: '768px', height: '1024px' } },
        desktop: { name: 'Desktop 1280', styles: { width: '1280px', height: '900px' } },
        wide:    { name: 'Wide 1440', styles: { width: '1440px', height: '900px' } },
      },
    },
  },
};

export default preview;
