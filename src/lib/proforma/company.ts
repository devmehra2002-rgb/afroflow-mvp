// Who the invoice is from. Read from environment variables so the company's
// address, tax numbers and BANK DETAILS never sit in the (public) code.
// Anything left empty is simply left off the PDF.
export interface Company {
  name: string;
  address: string[];
  email: string;
  iec: string;
  gstin: string;
  bank: string[];
}

const lines = (v: string | undefined) => (v ?? "").split(/\\n|\n/).map((s) => s.trim()).filter(Boolean);

export function loadCompany(env: Record<string, string | undefined> = process.env): Company {
  return {
    name: env.COMPANY_NAME?.trim() || "Afro Asiatic Exporters",
    address: lines(env.COMPANY_ADDRESS),
    email: env.COMPANY_EMAIL?.trim() || "",
    iec: env.COMPANY_IEC?.trim() || "",
    gstin: env.COMPANY_GSTIN?.trim() || "",
    bank: lines(env.COMPANY_BANK),
  };
}
