import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Reduce bundle size
  experimental: {
    optimizePackageImports: ['react', 'react-dom'],
  },

  // Skip type/lint checks during build (run separately)
  typescript:  { ignoreBuildErrors: false },
  eslint:      { ignoreDuringBuilds: true },

  // Proxy /api/* → backend (SSR fallback only — client calls backend directly)
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:3001';
    return [
      { source: '/api/:path*', destination: `${backendUrl}/api/:path*` },
    ];
  },
};

export default nextConfig;
