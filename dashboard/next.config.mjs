import { dirname } from 'path';
import { fileURLToPath } from 'url';

const dashboardRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: dashboardRoot
  }
};

export default nextConfig;
