import { dataArrivoEff, Pedana } from "@/src/api";

// After this hour, pallets due today and still waiting count as late.
export const ORA_RITARDO = 14;

const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function inRitardo(p: Pedana, now = new Date()) {
  if (p.statoArrivo !== "attesa" || !dataArrivoEff(p)) return false;
  // Only pallets due TODAY are highlighted (past days are not)
  if (dataArrivoEff(p) !== isoLocal(now)) return false;
  // Late after 14:00, or after the expected arrival time if that is later
  const m = /^(\d{1,2}):(\d{2})$/.exec(p.oraArrivo ?? "");
  const atteso = m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  const soglia = Math.max(ORA_RITARDO * 60, atteso);
  return now.getHours() * 60 + now.getMinutes() >= soglia;
}
