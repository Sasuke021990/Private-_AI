import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  jwtSecret: process.env.JWT_SECRET || 'fallback_secret',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin',
  routesFilePath: path.resolve(__dirname, '../../routes.json'),
};

if (!process.env.JWT_SECRET) {
  console.warn('⚠️ WARNING: JWT_SECRET is not set in .env. Using fallback secret.');
}
