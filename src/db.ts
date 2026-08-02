import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:password@127.0.0.1:5432/auth_proxy';

const adapter = new PrismaPg({ connectionString });
export const prisma = new PrismaClient({ adapter });
