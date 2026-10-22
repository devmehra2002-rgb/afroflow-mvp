// Clears everything the demo creates so you can start clean.
//   npx tsx scripts/reset-demo.ts            -> removes all inquiries, email notes on orders, and proforma invoices
//                                               (plus the proforma document each approval logged on its order)
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
  console.log("proformas removed:", (await prisma.orderProforma.deleteMany({})).count);
  // approving a proforma logs "PI-….pdf" as the order's Proforma Invoice document: take those back out
  let cleaned = 0;
  for (const o of await prisma.opsOrder.findMany({ select: { id: true, data: true } })) {
    const data = (o.data ?? {}) as { documents?: { docType: string; fileName: string }[] };
    const keep = (data.documents ?? []).filter((d) => !(d.docType === "Proforma Invoice" && /^PI-\d{4}-\d{3}(-R\d+)?\.pdf$/.test(d.fileName)));
    if (keep.length !== (data.documents ?? []).length) {
      await prisma.opsOrder.update({ where: { id: o.id }, data: { data: { ...data, documents: keep } } });
      cleaned++;
    }
  }
  console.log("orders with a logged proforma document cleaned:", cleaned);
  if (hard) {
    console.log("orders removed:", (await prisma.opsOrder.deleteMany({})).count);
    console.log("customers removed:", (await prisma.opsCustomer.deleteMany({})).count);
    await prisma.$executeRawUnsafe(`ALTER SEQUENCE "OpsOrderSeq" RESTART WITH 21`);
    console.log("order numbers restart at 21");
  }
}
main().finally(() => prisma.$disconnect());
