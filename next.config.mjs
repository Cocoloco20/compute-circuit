/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'logo.clearbit.com' },
      { protocol: 'https', hostname: 'cdn.brandfetch.io' },
    ],
  },
  // three.js ships ESM; transpiling sidesteps a few edge cases in webpack
  transpilePackages: ['three'],
};

export default nextConfig;
