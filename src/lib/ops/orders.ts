import type { OpsOrder } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// The shape afroflow.html already uses for an order (its "raw" order config),
// plus the saved progress/state that used to live in localStorage.
export interface ClientOrder {
  id: string;
  customerId: string | null;
  customer: string;
  country: string | null;
  product: string;
  qty: string | null;
  containerType: string | null;
  containerCount: number | null;
  value: number;
  terms: string | null;
  ship: string;
  inquiryDate: string | null;
  createdAt: string;
  doneCount: number;
  docSteps: number[];
  data: Record<string, unknown>;
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function toClientOrder(o: OpsOrder): ClientOrder {
  return {
    id: o.id,
    customerId: o.customerId,
    customer: o.customerName,
    country: o.country,
    product: o.product,
    qty: o.qty,
    containerType: o.containerType,
    containerCount: o.containerCount,
    value: o.value,
    terms: o.terms,
    ship: day(o.shipDate)!,
    inquiryDate: day(o.inquiryDate),
    createdAt: o.createdAt.toISOString(),
    doneCount: o.doneCount,
    docSteps: o.docSteps,
    data: (o.data ?? {}) as Record<string, unknown>,
  };
}

// Customers are matched by name, case-insensitively — the same way the app's
// Customers page has always grouped orders.
export async function findOrCreateCustomer(name: string, country?: string | null) {
  const clean = name.trim();
  const existing = await prisma.opsCustomer.findFirst({
    where: { name: { equals: clean, mode: "insensitive" } },
  });
  if (existing) return existing;
  return prisma.opsCustomer.create({ data: { name: clean, country: country ?? null } });
}

export async function nextOrderId(): Promise<string> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`SELECT nextval('"OpsOrderSeq"') AS n`;
  const n = Number(rows[0].n);
  return `AA-${new Date().getFullYear()}-${String(n).padStart(3, "0")}`;
}

export function parseDay(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}
