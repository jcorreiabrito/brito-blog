import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // We can add integrations or markdown configurations here if needed.
  markdown: {
    // Shiki syntax highlighting settings can go here
    shikiConfig: {
      theme: 'css-variables', // Allows CSS variables for styling syntax highlighters based on active dark/light mode
    },
  },
});
