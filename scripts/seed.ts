// Seeds the 3 demo customers and one earlier order for the brake-shoes
// customer ("same brake shoes as last order" needs a last order to point at).
// Safe to run more than once. Run: npx tsx scripts/seed.ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const CUSTOMERS = [
  // Sender A: the demo "existing customer". Emails from this address are matched to it.
  { name: "Mombasa Auto Parts Ltd", country: "Kenya", email: "dev_mehra@forge27.mesaschool.co" },
  { name: "Karachi Chem Traders", country: "Pakistan", email: "buyer@karachichem.example" },
  { name: "Dubai Petrochem Trading", country: "UAE", email: "procurement@dubaipetrochem.example" },
];

async function main() {
  for (const c of CUSTOMERS) {
    const cust =
      (await prisma.opsCustomer.findFirst({ where: { name: { equals: c.name, mode: "insensitive" } } })) ??
      (await prisma.opsCustomer.create({ data: { name: c.name, country: c.country } }));
    await prisma.opsCustomerEmail.upsert({ where: { email: c.email }, update: { customerId: cust.id }, create: { email: c.email, customerId: cust.id } });
    console.log("customer:", cust.name, "<" + c.email + ">");
  }

  const a = (await prisma.opsCustomer.findFirst({ where: { name: "Mombasa Auto Parts Ltd" } }))!;
  const earlier = await prisma.opsOrder.findFirst({ where: { customerId: a.id, product: "Motorcycle Brake Shoes" } });
  if (!earlier) {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`SELECT nextval('"OpsOrderSeq"') AS n`;
    const id = `AA-${new Date().getFullYear()}-${String(Number(rows[0].n)).padStart(3, "0")}`;
    const ship = new Date(); ship.setDate(ship.getDate() + 40);
    const created = new Date(); created.setDate(created.getDate() - 20);
    await prisma.opsOrder.create({
      data: {
        id, customerId: a.id, customerName: a.name, country: a.country, product: "Motorcycle Brake Shoes",
        containerType: "40ft", containerCount: 1, value: 18500, terms: "LC", shipDate: ship, inquiryDate: created, createdAt: created,
        doneCount: 6, docSteps: [], data: {},
      },
    });
    console.log("earlier order:", id, "(Motorcycle Brake Shoes, still open)");
  } else console.log("earlier order already there:", earlier.id);
}
main().finally(() => prisma.$disconnect());
