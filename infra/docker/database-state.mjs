import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
try {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
  `);
  const tables = new Set(rows.map((row) => row.table_name));
  if (tables.size === 0) {
    process.stdout.write("empty");
  } else if (tables.has("_prisma_migrations")) {
    process.stdout.write("migrated");
  } else {
    process.stdout.write("unbaselined");
  }
} finally {
  await prisma.$disconnect();
}
