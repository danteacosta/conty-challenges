import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.ts";
import { getOrder, ingestOrder, ingestRefund, registerCreator } from "../src/store.ts";

const dir = mkdtempSync(join(tmpdir(), "vendas-leitura-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const clock = () => "2026-06-01T12:00:00.000Z";
const pendingOrder = (totalCents: number) => ({ id: "o1", totalCents, currency: "BRL", financialStatus: "pending", createdAt: null, signals: { couponCodes: ["ANA10"], utmHandle: null } });
const paidOrder = (totalCents: number) => ({ ...pendingOrder(totalCents), financialStatus: "paid" });

/** A mesma conexão, mas com um gancho que roda DEPOIS de uma consulta ser preparada: é onde uma escrita de outra conexão cai no meio da leitura. */
function withHook(db: DatabaseSync, hook: (sql: string) => void): DatabaseSync {
  return new Proxy(db, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property === "prepare") {
        return (sql: string) => {
          const statement = target.prepare(sql);
          hook(sql);
          return statement;
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("a leitura de um pedido enxerga um estado só, mesmo com outra conexão escrevendo no meio", () => {
  it("pendente → pago entre a consulta do pedido e a dos estornos: nunca total 100, estornado 140 e líquido −40", () => {
    const path = join(dir, "leitura.db");
    const reader = openDatabase(path);
    const writer = openDatabase(path);
    registerCreator(writer, { id: "crt_ana", couponCode: "ANA10", utmHandle: "ana" });
    ingestOrder(writer, pendingOrder(10000), clock);
    ingestRefund(writer, { id: "r1", orderId: "o1", amountCents: 14000 }, clock); // pendente: o pedido ainda não foi creditado

    let fired = false;
    const spied = withHook(reader, (sql) => {
      if (fired || !/FROM refunds/.test(sql)) return;
      fired = true; // roda depois de o pedido ter sido lido e antes de os estornos serem lidos
      ingestOrder(writer, paidOrder(15000), clock); // o crédito nasce com 150,00 e aplica o estorno de 140,00
    });

    const seen = getOrder(spied, "o1")!;
    expect(fired).toBe(true);
    expect(seen.refunded_cents).toBeLessThanOrEqual(seen.total_cents);
    expect(seen.net_cents).toBeGreaterThanOrEqual(0);
    expect({ total: seen.total_cents, refunded: seen.refunded_cents }).toEqual({ total: 10000, refunded: 0 }); // o estado anterior inteiro

    const after = getOrder(reader, "o1")!; // a leitura seguinte vê o estado novo inteiro
    expect({ total: after.total_cents, refunded: after.refunded_cents, net: after.net_cents }).toEqual({ total: 15000, refunded: 14000, net: 1000 });
    reader.close();
    writer.close();
  });

  it("não deixa transação aberta, e a leitura de um pedido que não existe continua devolvendo null", () => {
    const db = openDatabase(":memory:");
    expect(getOrder(db, "nao-existe")).toBeNull();
    db.exec("BEGIN");
    db.exec("ROLLBACK"); // só funciona se não houver transação aberta
    ingestOrder(db, paidOrder(100), clock);
    getOrder(db, "o1");
    db.exec("BEGIN");
    db.exec("ROLLBACK");
  });
});
