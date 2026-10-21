import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { labelToDocType, MAX_FILE_SIZE_BYTES, ACCEPTED_MIME_TYPES } from "@/lib/scanner/docTypes";

// GET /api/scan-documents?orderId=AA-2026-020
// Lists every scanned document on an order along with its latest scan status
// and how many of its discrepancies are still open — enough for the static
// page to render badges without re-fetching per document.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const orderId = req.nextUrl.searchParams.get("orderId");
  if (!orderId) return NextResponse.json({ error: "orderId is required" }, { status: 400 });

  const documents = await prisma.scannedDocument.findMany({
    where: { orderId },
    orderBy: { uploadedAt: "desc" },
    include: {
      scans: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { discrepancies: true },
      },
    },
  });

  const result = documents.map((doc) => {
    const latestScan = doc.scans[0] ?? null;
    const openCritical = latestScan?.discrepancies.filter((d) => d.severity === "CRITICAL" && d.status === "OPEN").length ?? 0;
    const openWarning = latestScan?.discrepancies.filter((d) => d.severity === "WARNING" && d.status === "OPEN").length ?? 0;
    return {
      id: doc.id,
      docType: doc.docType,
      fileName: doc.fileName,
      uploadedAt: doc.uploadedAt,
      blobUrl: doc.blobUrl,
      latestScan: latestScan
        ? {
            id: latestScan.id,
            status: latestScan.status,
            createdAt: latestScan.createdAt,
            errorMessage: latestScan.errorMessage,
            discrepancies: latestScan.discrepancies,
          }
        : null,
      openCritical,
      openWarning,
    };
  });

  return NextResponse.json(result);
}

// POST /api/scan-documents — multipart form: file, orderId, docType
// Stores the actual file bytes in Blob storage (unlike the rest of the app's
// documents, which are metadata-only) and records a ScannedDocument row.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const orderId = form.get("orderId") as string | null;
  const docTypeLabel = form.get("docType") as string | null;

  if (!file || !orderId || !docTypeLabel) {
    return NextResponse.json({ error: "Missing file, orderId, or docType" }, { status: 400 });
  }
  const docType = labelToDocType(docTypeLabel);
  if (!docType) return NextResponse.json({ error: `Unsupported document type: ${docTypeLabel}` }, { status: 400 });
  if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}. Use PDF, PNG, JPEG, or WebP.` }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: `File too large (${Math.round(file.size / 1024 / 1024)}MB) — limit is 15MB.` }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const blob = await put(`scan-documents/${orderId}/${Date.now()}-${file.name}`, buffer, {
    access: "public",
    contentType: file.type,
  });

  const document = await prisma.scannedDocument.create({
    data: {
      orderId,
      docType,
      fileName: file.name,
      mimeType: file.type,
      blobUrl: blob.url,
      fileSize: file.size,
      uploadedBy: session.user.email,
    },
  });

  return NextResponse.json(document, { status: 201 });
}
