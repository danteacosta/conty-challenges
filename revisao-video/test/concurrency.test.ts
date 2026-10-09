import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.ts";
import { approveDelivery, createCampaign, createDelivery, decideVersion, getDelivery, submitVersion } from "../src/store.ts";
import { tsWorker } from "./spawn-worker.ts";

const dir = mkdtempSync(join(tmpdir(), "video-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const now = () => new Date("2026-06-01T12:00:00.000Z");

type Result = { delivery: string; ok: boolean; code?: string; number?: number };
type Job = { role: string; deliveries: string[]; times?: number; number?: number };

/** Um worker por trabalho; todos esperam na barreira e largam juntos. Se um worker morrer antes da barreira, o teste falha na hora, com o erro. */
async function race(path: string, jobs: Job[]): Promise<Result[][]> {
  const barrier = new SharedArrayBuffer(8);
  const flags = new Int32Array(barrier);
  let failure: Error | null = null;
  const done = jobs.map(
    (job) =>
      new Promise<Result[]>((resolve, reject) => {
        const worker = tsWorker(new URL("./race-worker.ts", import.meta.url), { path, job, barrier });
        worker.once("message", resolve);
        worker.once("error", (error) => {
          failure = error;
          reject(error);
        });
      }),
  );
  done.forEach((promise) => promise.catch(() => {}));
  while (Atomics.load(flags, 1) < jobs.length) {
    if (failure) throw failure;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  Atomics.store(flags, 0, 1);
  Atomics.notify(flags, 0);
  return Promise.all(done);
}

function seed(name: string, deliveries: number, prepare: (db: ReturnType<typeof openDatabase>, id: string) => void) {
  const path = join(dir, name);
  const db = openDatabase(path);
  createCampaign(db, { id: "cmp_1", required: ["video"] }, now);
  const ids: string[] = [];
  for (let i = 0; i < deliveries; i += 1) {
    const id = `dlv_${i}`;
    createDelivery(db, { id, campaignId: "cmp_1" }, now);
    prepare(db, id);
    ids.push(id);
  }
  db.close();
  return { path, ids };
}

describe("concorrência, com as conexões largando juntas", () => {
  it("quatro conexões enviando versões do mesmo vídeo: a numeração é única, sem lacunas, e só a última é a atual", async () => {
    for (let round = 0; round < 4; round += 1) {
      const { path, ids } = seed(`numeracao-${round}.sqlite`, 1, () => {});
      const outputs = await race(path, [0, 1, 2, 3].map(() => ({ role: "submit_video", deliveries: ids, times: 50 })));

      const numbers = outputs.flat().map((r) => r.number!).sort((a, b) => a - b);
      expect(numbers, `rodada ${round}`).toEqual(Array.from({ length: 200 }, (_, i) => i + 1)); // 1..200, cada número uma vez
      const db = openDatabase(path);
      const piece = getDelivery(db, ids[0]!);
      db.close();
      if (!piece.ok) throw new Error("entrega sumiu");
      const versions = piece.view.pieces.video.versions;
      expect(versions).toHaveLength(200);
      expect(versions.filter((v) => !v.superseded).map((v) => v.number)).toEqual([200]);
    }
  }, 90_000);

  it("aprovar a entrega e mandar versão nova ao mesmo tempo, em 120 entregas: nunca fica aprovada com a versão atual pendente, e o log bate com o que aconteceu", async () => {
    const DELIVERIES = 120;
    for (let round = 0; round < 3; round += 1) {
      const { path, ids } = seed(`aprova-vs-versao-${round}.sqlite`, DELIVERIES, (db, id) => {
        submitVersion(db, { deliveryId: id, piece: "video", url: "https://arquivos.example/v1.mp4", durationSeconds: null }, now);
        decideVersion(db, { deliveryId: id, piece: "video", number: 1, action: "approve" }, now);
      });
      const jobs: Job[] = [
        { role: "approve_delivery", deliveries: ids },
        { role: "submit_video", deliveries: ids, times: 1 },
        { role: "approve_delivery", deliveries: ids },
        { role: "submit_video", deliveries: ids, times: 1 },
      ];
      const outputs = await race(path, jobs);

      const db = openDatabase(path);
      for (const id of ids) {
        const out = getDelivery(db, id);
        if (!out.ok) throw new Error("entrega sumiu");
        const view = out.view;
        const label = `rodada ${round}, ${id}`;
        // duas versões novas sempre entram: 1, 2 e 3, e a atual (a 3) está pendente
        expect(view.pieces.video.versions.map((v) => v.number), label).toEqual([1, 2, 3]);
        expect(view.pieces.video.current_state, label).toBe("pending");
        // com a versão atual pendente a entrega NUNCA pode estar aprovada
        expect(view.status, label).not.toBe("approved");

        const approvedAtLeastOnce = outputs.some((worker, index) => jobs[index]!.role === "approve_delivery" && worker.some((r) => r.delivery === id && r.ok));
        const kinds = view.events.map((e) => e.kind);
        if (approvedAtLeastOnce) {
          expect(kinds, label).toEqual(["approved", "invalidated"]); // aprovada e logo desfeita pela versão nova, uma vez cada
          expect(view.status, label).toBe("in_review");
        } else {
          expect(kinds, label).toEqual([]);
          expect(view.status, label).toBe("in_production");
        }
      }
      db.close();
    }
  }, 120_000);

  it("aprovar a versão 1 e mandar versão nova ao mesmo tempo: a versão 1 só fica aprovada se a aprovação ganhou, e nunca a atual", async () => {
    const DELIVERIES = 120;
    const { path, ids } = seed("aprova-versao.sqlite", DELIVERIES, (db, id) => {
      submitVersion(db, { deliveryId: id, piece: "video", url: "https://arquivos.example/v1.mp4", durationSeconds: null }, now);
    });
    const jobs: Job[] = [
      { role: "approve_version", deliveries: ids, number: 1 },
      { role: "submit_video", deliveries: ids, times: 1 },
      { role: "approve_version", deliveries: ids, number: 1 },
      { role: "submit_video", deliveries: ids, times: 1 },
    ];
    const outputs = await race(path, jobs);

    const db = openDatabase(path);
    for (const id of ids) {
      const out = getDelivery(db, id);
      if (!out.ok) throw new Error("entrega sumiu");
      const versions = out.view.pieces.video.versions;
      expect(versions.map((v) => v.number), id).toEqual([1, 2, 3]);
      const approvedByAnyone = outputs.some((worker, index) => jobs[index]!.role === "approve_version" && worker.some((r) => r.delivery === id && r.ok));
      expect(versions[0]!.state, id).toBe(approvedByAnyone ? "approved" : "pending");
      expect(versions[2]!.state, id).toBe("pending"); // a atual nunca é aprovada por uma aprovação da versão 1
      expect(out.view.status, id).toBe("in_production");
    }
    db.close();
  }, 120_000);
});
