import { PrismaClient } from "@prisma/client";

function createClient() {
  return new PrismaClient();
}

if (process.env.NODE_ENV !== "production") {
  // If the singleton exists but is missing the waiverSubmission model
  // (stale instance from before `prisma generate` ran), drop it and recreate.
  if (global.prismaGlobal && !global.prismaGlobal.waiverSubmission) {
    global.prismaGlobal.$disconnect().catch(() => {});
    global.prismaGlobal = null;
  }
  if (!global.prismaGlobal) {
    global.prismaGlobal = createClient();
  }
}

const prisma = global.prismaGlobal ?? createClient();

export default prisma;
