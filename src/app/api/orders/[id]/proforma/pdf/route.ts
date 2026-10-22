import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { fileSafe, sanitizeProforma } from "@/lib/proforma/calc";
import { loadCompany } from "@/lib/proforma/company";
import { buildProformaPdf } from "@/lib/proforma/pdf";

// GET /api/orders/:id/proforma/pdf — the saved proforma as a PDF. Watermarked
// DRAFT until a person has approved it.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const p = await prisma.orderProforma.findUnique({ where: { orderId: id } });
  if (!p) return NextResponse.json({ error: "Save the draft first." }, { status: 404 });
  const { data, errors } = sanitizeProforma(p.data);
  if (!data) return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
  const bytes = await buildProformaPdf({ number: p.number, orderId: id, data, company: loadCompany(), approved: p.status === "APPROVED" });
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${fileSafe(p.number)}.pdf"`, "Cache-Control": "no-store" },
  });
}
