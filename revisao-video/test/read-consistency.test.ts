import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.ts";
import { approveDelivery, createCampaign, createDelivery, decideVersion, getCampaign, getDelivery, getVersion, submitVersion, addComment } from "../src/store.ts";

const dir = mkdtempSync(join(tmpdir(), "video-leitura-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const now = () => new Date("2026-06-01T12:00:00.000Z");

/** Entrega com a única peça exigida (vídeo) aprovada e a entrega aprovada: o ponto de partida da corrida. */
function approvedDelivery(name: string) {
  const path = join(dir, `${name}.db`);
  const reader = openDatabase(path);
  const writer = openDatabase(path);
  createCampaign(writer, { id: "c", required: ["video"] }, now);
  createDelivery(writer, { id: "d", campaignId: "c" }, now);
  submitVersion(writer, { deliveryId: "d", piece: "video", url: "https://x/v1", durationSeconds: 60 }, now);
  decideVersion(writer, { deliveryId: "d", piece: "video", number: 1, action: "approve" }, now);
  approveDelivery(writer, { id: "d" }, now);
  return { reader, writer };
}

/** Depois da primeira leitura que casa com `needle`, executa `then` pela outra conexão (a escrita de outro processo, no meio do GET). */
function interleave(db: ReturnType<typeof openDatabase>, needle: string, method: "get" | "all", then: () => void) {
  const original = db.prepare.bind(db);
  let fired = false;
  db.prepare = ((sql: string) => {
    const statement = original(sql);
    if (!fired && sql.includes(needle)) {
      const read = statement[method].bind(statement) as (...a: unknown[]) => unknown;
      (statement as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
        const out = read(...args);
        fired = true;
        then();
        return out;
      };
    }
    return statement;
  }) as typeof db.prepare;
  return () => fired;
}

describe("as leituras compostas usam um retrato só do banco", () => {
  it("GET da entrega: uma versão nova no meio da leitura não deixa 'approved' com a versão atual pendente", () => {
    const { reader, writer } = approvedDelivery("entrega");
    const fired = interleave(reader, "SELECT v.* FROM piece_versions v", "all", () =>
      submitVersion(writer, { deliveryId: "d", piece: "video", url: "https://x/v2", durationSeconds: 60 }, now),
    );
    const out = getDelivery(reader, "d");
    expect(fired()).toBe(true);
    if (!out.ok) throw new Error("not_found");
    const piece = out.view.pieces.video;
    // coerente com o retrato anterior (aprovada, v1 aprovada) ou com o posterior (em revisão, v2 pendente), nunca misturado
    const before = out.view.status === "approved" && out.view.pending.length === 0 && piece.current_version === 1 && piece.current_state === "approved";
    const after = out.view.status === "in_review" && out.view.pending.length > 0 && piece.current_version === 2 && piece.current_state === "pending";
    expect(before || after).toBe(true);
    reader.close();
    writer.close();
  });

  it("GET da versão: o contador, a marca de substituída e os comentários vêm do mesmo retrato", () => {
    const { reader, writer } = approvedDelivery("versao");
    addComment(writer, { deliveryId: "d", piece: "video", number: 1, second: 3, text: "ok", author: null }, now);
    const fired = interleave(reader, "SELECT * FROM comments WHERE version_id", "all", () =>
      submitVersion(writer, { deliveryId: "d", piece: "video", url: "https://x/v2", durationSeconds: 60 }, now),
    );
    const out = getVersion(reader, "d", "video", 1);
    expect(fired()).toBe(true);
    if (!out.ok) throw new Error("not_found");
    // a v2 nasceu depois do retrato: a v1 ainda é a atual, não aparece como substituída por uma versão que a leitura não viu
    expect(out.version.superseded).toBe(false);
    expect(out.version.comments_count).toBe(out.version.comments.length);
    reader.close();
    writer.close();
  });

  it("GET da campanha lê as peças exigidas no mesmo retrato que o id", () => {
    const path = join(dir, "campanha.db");
    const reader = openDatabase(path);
    const writer = openDatabase(path);
    createCampaign(writer, { id: "c", required: ["video"] }, now);
    expect(getCampaign(reader, "c")).toEqual({ id: "c", required_pieces: ["video"] });
    expect(getCampaign(reader, "ausente")).toBeNull();
    reader.close();
    writer.close();
  });
});
