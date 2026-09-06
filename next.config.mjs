import webpack from "webpack";

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // prismarine-nbt was written for Node, so the browser bundle needs a
    // Buffer polyfill. Without this, parsing fails silently in the browser
    // even though it works fine in a Node script.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      buffer: "buffer",
    };
    config.plugins.push(
      new webpack.ProvidePlugin({
        Buffer: ["buffer", "Buffer"],
      })
    );
    return config;
  },
};

export default nextConfig;
