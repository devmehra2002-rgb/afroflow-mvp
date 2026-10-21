// Clears everything the demo creates so you can start clean.
//   npx tsx scripts/reset-demo.ts            -> removes all inquiries + email notes on orders
//   CONFIRM=yes npx tsx scripts/reset-demo.ts --hard
//        -> ALSO deletes every order and customer, and restarts order numbers at 21.
//           Only use before the demo, with no real orders in the system.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const hard = process.argv.includes("--hard");
  if (hard && process.env.CONFIRM !== "yes") { console.log("Refusing: --hard deletes ALL orders and customers. Re-run with CONFIRM=yes"); process.exit(1); }
  console.log("activity notes removed:", (await prisma.orderActivity.deleteMany({})).count);
  console.log("inquiries removed:", (await prisma.inquiry.deleteMany({})).count);
  if (hard) {
    console.log("orders removed:", (await prisma.opsOrder.deleteMany({})).count);
    console.log("customers removed:", (await prisma.opsCustomer.deleteMany({})).count);
    await prisma.$executeRawUnsafe(`ALTER SEQUENCE "OpsOrderSeq" RESTART WITH 21`);
    console.log("order numbers restart at 21");
  }
}
main().finally(() => prisma.$disconnect());
