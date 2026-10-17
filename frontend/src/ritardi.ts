import { Pedana } from "@/src/api";

// After this hour, pallets due today and still waiting count as late.
export const ORA_RITARDO = 14;

const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function inRitardo(p: Pedana, now = new Date()) {
  if (p.statoArrivo !== "attesa" || !p.dataConsegna) return false;
  // Only pallets due TODAY are highlighted (past days are not)
  return p.dataConsegna === isoLocal(now) && now.getHours() >= ORA_RITARDO;
}
