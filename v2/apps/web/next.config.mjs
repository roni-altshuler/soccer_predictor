/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.fotpredict.com' },
      { protocol: 'https', hostname: '*.r2.dev' },
    ],
  },
  experimental: {
    serverActions: { allowedOrigins: ['fotpredict.com', '*.fotpredict.com'] },
  },
};

export default nextConfig;
