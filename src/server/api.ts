export interface Env {
  DB: any;
  ASSETS_BUCKET: any;
  R2_PUBLIC_URL: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Save Extracted Dino Parts & Gold to Cloudflare D1 SQL Database
    if (url.pathname === "/api/extract" && request.method === "POST") {
      const body = await request.json() as { playerId: string; username: string; cargoItems: Array<{ itemId: string; valueGold: number }> };
      const totalGold = body.cargoItems.reduce((sum, item) => sum + item.valueGold, 0);

      if (env.DB) {
        await env.DB.prepare(
          `INSERT INTO players (id, username, gold) VALUES (?1, ?2, ?3)
           ON CONFLICT(id) DO UPDATE SET gold = gold + ?3`
        ).bind(body.playerId, body.username, totalGold).run();

        for (const item of body.cargoItems) {
          await env.DB.prepare(
            `INSERT INTO inventory (player_id, item_id, quantity, quality_tier) VALUES (?1, ?2, 1, 2)
             ON CONFLICT(player_id, item_id, quality_tier) DO UPDATE SET quantity = quantity + 1`
          ).bind(body.playerId, item.itemId).run();
        }
      }

      return new Response(JSON.stringify({ ok: true, goldEarned: totalGold }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ status: "Blocktopia Next Fable Cloudflare Worker Active" }), { headers: corsHeaders });
  }
};
