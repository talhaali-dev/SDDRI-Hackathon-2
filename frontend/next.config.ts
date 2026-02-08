import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    typescript: {
        ignoreBuildErrors: true,
    },
    async rewrites() {
        const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

        return [
            // API endpoints to proxy to backend (all except /api/auth/*)
            // Next.js API routes (/api/auth/*) take precedence over rewrites
            {
                source: '/api/tasks/:path*',
                destination: `${backendUrl}/api/tasks/:path*`,
            },
            {
                source: '/api/users/:path*',
                destination: `${backendUrl}/api/users/:path*`,
            },
            {
                source: '/api/chatkit',
                destination: `${backendUrl}/api/chatkit`,
            },
        ];
    },
};

export default nextConfig;
