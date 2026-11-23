// The 15-step order workflow, as plain data on the server. This mirrors STEPS in public/afroflow.html:
// if you change one, change the other. Due dates use the same formula as the page.
export const STEPS = [
  { label: "Enquiry Received", role: "Sales", external: false },
  { label: "Respond to Enquiry", role: "Sales", external: false },
  { label: "Negotiation", role: "Sales", external: true },
  { label: "Issue Proforma Invoice", role: "Sales", external: false },
  { label: "Payment / LC Confirmation", role: "Finance", external: true },
  { label: "Release Purchase Orders", role: "Procurement", external: false },
  { label: "Await Supplies", role: "Procurement", external: true },
  { label: "Cargo Ready", role: "Procurement", external: false },
  { label: "Arrange Container", role: "Logistics", external: false },
  { label: "Customs Clearance", role: "Logistics", external: true },
  { label: "Shipment & Bill of Lading", role: "Logistics", external: false },
  { label: "Prepare Documentation", role: "Docs", external: false },
  { label: "Submit Documents to Bank", role: "Finance", external: false },
  { label: "Payment Realisation", role: "Finance", external: true },
  { label: "eBRC & Closure", role: "Finance", external: false },
] as const;

const DAY = 86400000;
const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
export const daysBetween = (a: Date, b: Date) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);

// Step i is due on (inquiry date + round(i * interval)); the interval spreads 14 gaps over the time to the ship date (at least 14 days).
export function stepDueDates(inquiryOrCreated: Date, shipDate: Date): Date[] {
  const span = Math.max(daysBetween(inquiryOrCreated, shipDate), 14);
  const interval = span / 14;
  const base = startOfDay(inquiryOrCreated);
  return STEPS.map((_, i) => new Date(i === 0 ? base : base + Math.round(i * interval) * DAY));
}

export type FlowOrder = { id: string; customerName: string; product: string; doneCount: number; shipDate: Date; inquiryDate: Date | null; createdAt: Date };
export type FlowState = { complete: boolean; activeIndex: number; active: (typeof STEPS)[number] | null; dueDate: Date | null; overdueDays: number; daysToShip: number };

export function flowState(o: FlowOrder, now = new Date()): FlowState {
  const complete = o.doneCount >= STEPS.length;
  const activeIndex = Math.min(o.doneCount, STEPS.length - 1);
  const due = stepDueDates(o.inquiryDate ?? o.createdAt, o.shipDate);
  const dueDate = complete ? null : due[activeIndex];
  const overdueDays = dueDate ? Math.max(0, daysBetween(dueDate, now)) : 0;
  return { complete, activeIndex, active: complete ? null : STEPS[activeIndex], dueDate, overdueDays, daysToShip: daysBetween(now, o.shipDate) };
}
