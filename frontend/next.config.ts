import type { NextConfig } from 'next';

// Security headers sent on every response.
// connect-src is permissive (http:/https:/ws:/wss:) because the frontend
// calls the backend on a different port (:3001) whose address is dynamic at runtime.
const securityHeaders = [
  { key: 'X-Frame-Options',        value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy',        value: 'strict-origin-when-cross-origin' },
  { key: 'X-XSS-Protection',       value: '1; mode=block' },
  { key: 'Permissions-Policy',     value: 'camera=(), microphone=(), geolocation=()' },
  {
    key:   'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self' http: https: ws: wss:",
      "frame-ancestors 'self'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  // Reduce bundle size
  experimental: {
    optimizePackageImports: ['react', 'react-dom'],
  },

  // Skip type/lint checks during build (run separately)
  typescript:  { ignoreBuildErrors: false },
  eslint:      { ignoreDuringBuilds: true },

  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },

  // Proxy /api/* → backend (SSR fallback only — client calls backend directly)
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:3001';
    return [
      { source: '/api/:path*', destination: `${backendUrl}/api/:path*` },
    ];
  },
};

export default nextConfig;
