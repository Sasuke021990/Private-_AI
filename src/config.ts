import dotenv from 'dotenv';

dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

function required(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProd) {
    throw new Error(`FATAL: ${name} must be set when NODE_ENV=production`);
  }
  console.warn(`⚠️ WARNING: ${name} is not set in .env. Using insecure dev fallback.`);
  return devFallback;
}

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  jwtSecret: required('JWT_SECRET', 'fallback_secret'),
  adminUsername: required('ADMIN_USERNAME', 'admin'),
  adminPassword: required('ADMIN_PASSWORD', 'admin'),
};
