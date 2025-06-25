import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: process.env.SUPABASE_STORAGE_IP || '127.0.0.1',
        port: '54321',
        pathname: '/storage/v1/object/sign/gh-vehicle-photos/**',
      },
      {
        protocol: 'https',
        hostname: process.env.SUPABASE_STORAGE_IP || 'localhost',
        pathname: '/storage/v1/object/sign/gh-vehicle-photos/**',
      }
    ],
  },
};

export default nextConfig;
