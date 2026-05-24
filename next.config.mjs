/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      // Google faviconV2 — default logo source after Clearbit's API shutdown
      { protocol: 'https', hostname: 't1.gstatic.com' },
      // Optional upgrade: set NEXT_PUBLIC_LOGO_DEV_TOKEN to use logo.dev
      { protocol: 'https', hostname: 'img.logo.dev' },
    ],
  },
  // three.js ships ESM; transpiling sidesteps a few edge cases in webpack
  transpilePackages: ['three'],
};

export default nextConfig;
