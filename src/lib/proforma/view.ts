import type { ProformaData } from "./calc";

// What the API sends to the browser for a saved or fresh proforma.
export const proformaView = (p: { number: string; version: number; status: string; data: unknown; approvedBy: string | null; approvedAt: Date | null; updatedAt: Date }, saved: boolean) => ({
  saved, number: p.number, version: p.version, status: p.status, data: p.data as ProformaData, approvedBy: p.approvedBy, approvedAt: p.approvedAt, updatedAt: p.updatedAt,
});
