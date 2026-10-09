import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";

export type Piece = "script" | "video" | "cover" | "caption";
export const ALL_PIECES: Piece[] = ["script", "video", "cover", "caption"];

export function setup(start = "2026-06-01T12:00:00.000Z") {
  const clock = { current: new Date(start) };
  const db = openDatabase(":memory:");
  const app = createApp({ db, now: () => new Date(clock.current) });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  const version = (delivery: string, piece: Piece, n: number) => `/deliveries/${delivery}/pieces/${piece}/versions/${n}`;
  return {
    app,
    db,
    call,
    set: (iso: string) => void (clock.current = new Date(iso)),
    campaign: async (required: Piece[] = ALL_PIECES) => (await call("POST", "/campaigns", { required_pieces: required })).body.id as string,
    delivery: async (campaignId: string) => (await call("POST", "/deliveries", { campaign_id: campaignId })).body.id as string,
    /** Campanha + entrega numa chamada só. */
    newDelivery: async (required: Piece[] = ALL_PIECES) => {
      const campaign = (await call("POST", "/campaigns", { required_pieces: required })).body.id as string;
      return (await call("POST", "/deliveries", { campaign_id: campaign })).body.id as string;
    },
    submit: (delivery: string, piece: Piece, body: Record<string, unknown> = {}) =>
      call("POST", `/deliveries/${delivery}/pieces/${piece}/versions`, { url: `https://arquivos.example/${piece}.bin`, ...body }),
    approveVersion: (delivery: string, piece: Piece, n: number) => call("POST", `${version(delivery, piece, n)}/approve`),
    requestChanges: (delivery: string, piece: Piece, n: number, reason = "Ajustar") => call("POST", `${version(delivery, piece, n)}/request-changes`, { reason }),
    comment: (delivery: string, piece: Piece, n: number, body: Record<string, unknown>) => call("POST", `${version(delivery, piece, n)}/comments`, body),
    getVersion: (delivery: string, piece: Piece, n: number) => call("GET", version(delivery, piece, n)),
    approve: (delivery: string) => call("POST", `/deliveries/${delivery}/approve`),
    get: (delivery: string) => call("GET", `/deliveries/${delivery}`),
    /** Envia e aprova a versão atual de uma peça. */
    submitAndApprove: async function (this: { submit: Function; approveVersion: Function }, delivery: string, piece: Piece) {
      const sent = await this.submit(delivery, piece);
      await this.approveVersion(delivery, piece, sent.body.version.number);
      return sent.body.version.number as number;
    },
  };
}
