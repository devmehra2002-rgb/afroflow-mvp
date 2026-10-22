import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { parsePastedItems } from "@/lib/proforma/calc";

// POST /api/proforma/parse-items — turns rows pasted from Excel into invoice lines
// (Code | Description | Qty | Unit price). Nothing is saved here.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const b = await req.json().catch(() => null);
  if (typeof b?.text !== "string" || !b.text.trim()) return NextResponse.json({ error: "Paste some rows first." }, { status: 400 });
  if (b.text.length > 600_000) return NextResponse.json({ error: "That is too much text to import at once." }, { status: 413 });
  return NextResponse.json(parsePastedItems(b.text));
}
