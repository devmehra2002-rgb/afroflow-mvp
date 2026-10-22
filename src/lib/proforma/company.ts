// Who the invoice is from. Read from environment variables so the company's
// address, tax numbers and BANK DETAILS never sit in the (public) code.
// Anything left empty is simply left off the PDF.
export interface Company {
  name: string;
  address: string[];
  phone: string;
  fax: string;
  email: string;
  iec: string;
  gstin: string;
  bank: string[];
  signatory: string;
  numberPrefix: string; // invoice numbers look like PREFIX/2026-27/101
}

const lines = (v: string | undefined) => (v ?? "").split(/\\n|\n/).map((s) => s.trim()).filter(Boolean);

export function loadCompany(env: Record<string, string | undefined> = process.env): Company {
  return {
    name: env.COMPANY_NAME?.trim() || "Afro Asiatic Exporters",
    address: lines(env.COMPANY_ADDRESS),
    phone: env.COMPANY_PHONE?.trim() || "",
    fax: env.COMPANY_FAX?.trim() || "",
    email: env.COMPANY_EMAIL?.trim() || "",
    iec: env.COMPANY_IEC?.trim() || "",
    gstin: env.COMPANY_GSTIN?.trim() || "",
    bank: lines(env.COMPANY_BANK),
    signatory: env.COMPANY_SIGNATORY?.trim() || "",
    numberPrefix: (env.COMPANY_PROFORMA_PREFIX?.trim() || "PI").replace(/[^A-Za-z0-9-]/g, ""),
  };
}
