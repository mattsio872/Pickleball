/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The PayMongo webhook needs the raw request body to verify its signature,
  // so nothing in the request pipeline may parse or rewrite it.
  serverExternalPackages: ['@prisma/client'],
};

export default nextConfig;
