import { Pedana, Stato } from "@/src/api";

export type Posizione = { key: string; items: Pedana[]; rep: Pedana };

const sum = (list: Pedana[], f: (p: Pedana) => string | undefined) =>
  list.reduce((n, p) => n + (parseInt(f(p) ?? "", 10) || 0), 0);

// Same order + same position = one physical place to unload, even with different goods.
export function mergePositions(items: Pedana[]): Posizione[] {
  const map = new Map<string, Pedana[]>();
  for (const p of items) {
    const k = `${p.numeroOrdine}|${p.codice.trim().toLowerCase()}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(p);
  }
  return [...map.entries()].map(([key, list]) => {
    if (list.length === 1) return { key, items: list, rep: list[0] };
    const stati = new Set(list.map((p) => p.statoArrivo));
    const stato: Stato = stati.size === 1 ? list[0].statoArrivo : "parziale";
    const first = <K extends keyof Pedana>(k: K) => list.find((p) => p[k])?.[k] ?? list[0][k];
    const colli = sum(list, (p) => p.numeroColli);
    const pal = sum(list, (p) => p.numeroPedane);
    const rep: Pedana = {
      ...list[0],
      merce: [...new Set(list.map((p) => p.merce).filter(Boolean))].join(" + "),
      mittente: [...new Set(list.map((p) => p.mittente).filter(Boolean))].join(" + "),
      numeroColli: colli ? String(colli) : "",
      numeroPedane: pal ? String(pal) : "",
      statoArrivo: stato,
      arrivoCompletoAt: stato === "completo" ? first("arrivoCompletoAt") : null,
      arrivoCompletoDa: stato === "completo" ? first("arrivoCompletoDa") : "",
      arrivoParzialeAt: first("arrivoParzialeAt"),
      arrivoParzialeDa: first("arrivoParzialeDa"),
      noteParziale: first("noteParziale") ?? "",
    };
    return { key, items: list, rep };
  });
}
