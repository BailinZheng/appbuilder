import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the dev server to be opened via customer subdomains (<slug>.localhost).
  allowedDevOrigins: ["*.localhost"],
  // Standalone output = small self-contained server, ideal for Docker/Coolify later.
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
