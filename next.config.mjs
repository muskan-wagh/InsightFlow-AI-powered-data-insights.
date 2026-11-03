/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Linting is handled by tests and code review; keep builds fast on low-RAM machines.
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    // DuckDB-Wasm ships low-quality Wasm that must not be re-processed by webpack
    config.module.rules.push({
      test: /\.wasm$/,
      type: "asset/resource",
    });
    // Workers inside duckdb-wasm need to stay plain JS
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".js"],
    };
    return config;
  },
  async headers() {
    return [
      {
        source: "/duckdb-wasm/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, immutable" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
