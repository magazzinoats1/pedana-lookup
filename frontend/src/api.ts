import { storage } from "@/src/utils/storage";

const BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;
export const TOKEN_KEY = "ufficio_session_token";

export type Stato = "attesa" | "parziale" | "completo";

export type Pedana = {
  id: string;
  numeroOrdine: string;
  agenzia: string;
  mittente: string;
  dataConsegna: string;
  note: string;
  codice: string;
  destinazione: string;
  numeroColli: string;
  merce: string;
  createdAt: string;
  ultimaRettifica: string | null;
  statoArrivo: Stato;
  arrivoParzialeAt: string | null;
  arrivoCompletoAt: string | null;
  noteParziale: string;
};

export type OrdineForm = {
  numeroOrdine: string;
  agenzia: string;
  mittente: string;
  dataConsegna: string;
  note: string;
};

export type PedanaRow = { codice: string; destinazione: string; numeroColli: string; mittente: string; merce: string };

export type ImportResult = OrdineForm & { pedane: PedanaRow[] };

export class ApiError extends Error {
  status: number;
  constructor(msg: string, status: number) {
    super(msg);
    this.status = status;
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const t = await storage.secureGet(TOKEN_KEY, null);
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = await authHeader();
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method: opts.method ?? "GET", headers, body });
  } catch {
    throw new ApiError("Connessione assente. Controlla la rete.", 0);
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    const detail = typeof j.detail === "string" ? j.detail : "Errore del server";
    throw new ApiError(detail, res.status);
  }
  return res.json() as Promise<T>;
}

export function formatDate(s: string) {
  if (!s) return "—";
  const [y, m, g] = s.split("-");
  if (!g) return s;
  return `${g}/${m}/${y}`;
}

export function formatDateTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("it-IT") +
    " alle " +
    d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
  );
}
