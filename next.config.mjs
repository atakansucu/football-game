/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export so the app can be bundled into the Capacitor iOS shell.
  output: "export",
  // next/image optimization needs a server; disable for the static build.
  images: { unoptimized: true },
  // Emit per-route folders (index.html) which load reliably from the local
  // Capacitor web server.
  trailingSlash: true,
};

export default nextConfig;
