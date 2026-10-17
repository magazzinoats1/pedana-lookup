import { Platform } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

import { formatDate, Pedana } from "@/src/api";

const esc = (s: string | null | undefined) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const ora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "";

const STATO = { attesa: "In attesa", parziale: "Parziale", completo: "Scaricato" } as const;

export function groupOrders(list: Pedana[]) {
  const map = new Map<string, Pedana[]>();
  for (const p of list) {
    const k = p.numeroOrdine || "—";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(p);
  }
  return [...map.entries()].map(([numero, items]) => ({ numero, items }));
}

function buildHtml(dataIso: string, list: Pedana[], cooperativa: string) {
  const done = list.filter((p) => p.statoArrivo === "completo").length;
  const parz = list.filter((p) => p.statoArrivo === "parziale").length;
  const groups = groupOrders(list);
  const rows = groups
    .map((g) => {
      const d = g.items.filter((p) => p.statoArrivo === "completo").length;
      const body = g.items
        .map((p) => {
          const when = p.statoArrivo === "completo" ? p.arrivoCompletoAt : p.statoArrivo === "parziale" ? p.arrivoParzialeAt : null;
          const who = p.statoArrivo === "completo" ? p.arrivoCompletoDa : p.statoArrivo === "parziale" ? p.arrivoParzialeDa : "";
          return `<tr class="${p.statoArrivo}">
            <td><b>${esc(p.codice)}</b></td><td>${esc(p.mittente)}</td><td>${esc(p.merce)}</td>
            <td class="num">${esc(p.numeroPedane)}</td><td class="num">${esc(p.numeroColli)}</td><td>${esc(p.destinazione)}</td>
            <td><span class="pill ${p.statoArrivo}">${STATO[p.statoArrivo]}</span></td>
            <td>${esc(ora(when))}</td><td>${esc(who)}</td><td>${esc(p.noteParziale)}</td></tr>`;
        })
        .join("");
      return `<h2>Ordine ${esc(g.numero)} <small>${esc(g.items[0].agenzia)} · scaricate ${d}/${g.items.length}</small></h2>
        <table><thead><tr><th>Posizione</th><th>Mittente</th><th>Merce</th><th>Pedane</th><th>Colli</th><th>Destinazione</th><th>Stato</th><th>Ora</th><th>Operatore</th><th>Note</th></tr></thead><tbody>${body}</tbody></table>`;
    })
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Report scarichi ${esc(formatDate(dataIso))}</title>
  <style>
    body{font-family:Helvetica,Arial,sans-serif;color:#0F172A;padding:24px;font-size:11px}
    h1{color:#1A3A6B;margin:0;font-size:22px} .sub{color:#64748B;margin:4px 0 16px}
    .stats{display:flex;gap:10px;margin-bottom:16px} .stat{border:1px solid #E2E8F0;border-radius:8px;padding:8px 12px}
    .stat b{display:block;font-size:18px;color:#1A3A6B}
    h2{font-size:14px;color:#1A3A6B;margin:18px 0 6px} h2 small{color:#64748B;font-weight:normal;font-size:11px}
    table{width:100%;border-collapse:collapse} th{background:#1A3A6B;color:#fff;text-align:left;padding:5px}
    td{border-bottom:1px solid #E2E8F0;padding:5px;vertical-align:top} .num{text-align:right}
    .pill{padding:2px 6px;border-radius:8px;font-weight:bold} .pill.completo{background:#F0FDF4;color:#15803D}
    .pill.parziale{background:#FFFBEB;color:#92400E} .pill.attesa{background:#EFF6FF;color:#1D4ED8}
    .foot{margin-top:20px;color:#64748B}
  </style></head><body>
  <h1>Report scarichi — ${esc(formatDate(dataIso))}</h1>
  <div class="sub">Antolini Trasporti e Spedizioni${cooperativa ? ` · Cooperativa ${esc(cooperativa)}` : ""}</div>
  <div class="stats">
    <div class="stat"><b>${groups.length}</b>Camion/ordini</div><div class="stat"><b>${list.length}</b>Pedane</div>
    <div class="stat"><b>${done}</b>Scaricate</div><div class="stat"><b>${parz}</b>Parziali</div>
    <div class="stat"><b>${list.length - done - parz}</b>In attesa</div>
  </div>
  ${rows || "<p>Nessuna pedana per questa data.</p>"}
  <div class="foot">Generato il ${esc(new Date().toLocaleString("it-IT"))}</div>
  </body></html>`;
}

export async function condividiReport(dataIso: string, list: Pedana[], cooperativa: string) {
  const html = buildHtml(dataIso, list, cooperativa);
  if (Platform.OS === "web") {
    await Print.printAsync({ html });
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: `Report scarichi ${formatDate(dataIso)}`, UTI: "com.adobe.pdf" });
  } else {
    await Print.printAsync({ uri });
  }
}
