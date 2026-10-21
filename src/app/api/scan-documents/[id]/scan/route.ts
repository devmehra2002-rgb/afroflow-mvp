import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { extractDocument, DEFAULT_MODEL } from "@/lib/scanner/extract";
import {
  compareDocumentToOrder,
  compareDocuments,
  checkLineItemMath,
  checkDateOrder,
  lowConfidenceWarnings,
  worstSeverity,
  type Discrepancy,
  type OrderRecord,
} from "@/lib/scanner/compare";
import { DOC_TYPE_LABELS, DOC_TYPE_SEQUENCE, type SupportedDocType } from "@/lib/scanner/docTypes";
import type { ExtractedDocument } from "@/lib/scanner/schema";

// POST /api/scan-documents/:id/scan
// Body: { order: OrderRecord }
// Triggered only by the Scan button — never automatically — per the brief's
// cost-control constraint. Extraction (AI) and comparison (plain code) are
// kept strictly separate: the AI only ever produces the structured
// extraction; every discrepancy is computed deterministically afterward.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await params;
  const document = await prisma.scannedDocument.findUnique({ where: { id } });
  if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const order = body?.order as OrderRecord | undefined;
  if (!order) return NextResponse.json({ error: "order is required in the request body" }, { status: 400 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server — scanning is unavailable until it's set." },
      { status: 503 }
    );
  }

  // Fetch the actual file bytes from Blob storage to send to the model.
  const fileRes = await fetch(document.blobUrl);
  if (!fileRes.ok) {
    return NextResponse.json({ error: "Could not retrieve the stored file for scanning." }, { status: 502 });
  }
  const fileBuffer = Buffer.from(await fileRes.arrayBuffer());
  const base64 = fileBuffer.toString("base64");

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const extraction = await extractDocument({
    client,
    model: DEFAULT_MODEL,
    docType: DOC_TYPE_LABELS[document.docType as SupportedDocType],
    base64,
    mediaType: document.mimeType,
  });

  if (!extraction.success || !extraction.data) {
    const scan = await prisma.docScan.create({
      data: {
        documentId: document.id,
        status: "FAILED",
        model: DEFAULT_MODEL,
        errorMessage: extraction.error ?? "Extraction failed for an unknown reason.",
      },
      include: { discrepancies: true },
    });
    // A failed scan must never block upload or other app features — it just
    // reports as failed so the user can retry.
    return NextResponse.json(scan, { status: 200 });
  }

  const extracted = extraction.data;
  const docLabel = DOC_TYPE_LABELS[document.docType as SupportedDocType];

  // Pull the other already-scanned documents on this order for doc-vs-doc
  // comparison and date-order checking.
  const otherDocuments = await prisma.scannedDocument.findMany({
    where: { orderId: document.orderId, id: { not: document.id } },
    include: { scans: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const otherExtracted = otherDocuments
    .map((d) => {
      const latest = d.scans[0];
      if (!latest || latest.status === "FAILED" || !latest.extractedJson) return null;
      return {
        label: DOC_TYPE_LABELS[d.docType as SupportedDocType],
        extracted: latest.extractedJson as unknown as ExtractedDocument,
        docType: d.docType as SupportedDocType,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const discrepancies: Discrepancy[] = [
    ...compareDocumentToOrder(extracted, docLabel, order),
    ...compareDocuments([
      { label: docLabel, extracted },
      ...otherExtracted.map((d) => ({ label: d.label, extracted: d.extracted })),
    ]),
    ...checkLineItemMath(extracted.lineItems?.value ?? null, docLabel, extracted.totalValue?.value ?? null),
    ...checkDateOrder([
      { label: docLabel, date: extracted.documentDate?.value ?? null, order: DOC_TYPE_SEQUENCE[document.docType as SupportedDocType] },
      ...otherExtracted.map((d) => ({
        label: d.label,
        date: d.extracted.documentDate?.value ?? null,
        order: DOC_TYPE_SEQUENCE[d.docType],
      })),
    ]),
    ...lowConfidenceWarnings(extracted, docLabel),
  ];

  const worst = worstSeverity(discrepancies);
  const status = worst === "CRITICAL" ? "CRITICAL" : worst === "WARNING" ? "WARNINGS" : "CLEAN";

  const scan = await prisma.docScan.create({
    data: {
      documentId: document.id,
      status,
      model: DEFAULT_MODEL,
      extractedJson: extracted as object,
      discrepancies: {
        create: discrepancies.map((d) => ({
          field: d.field,
          severity: d.severity,
          foundValue: d.foundValue,
          foundSource: d.foundSource,
          expectedValue: d.expectedValue,
          expectedSource: d.expectedSource,
        })),
      },
    },
    include: { discrepancies: true },
  });

  return NextResponse.json(scan, { status: 200 });
}
