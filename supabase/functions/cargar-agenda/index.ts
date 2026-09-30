// supabase/functions/cargar-agenda/index.ts
//
// Recibe las cirugías programadas ya leídas del Excel (desde admin.html) y las
// guarda en `cirugias`. Solo puede usarla personal con sesión iniciada cuyo
// correo esté en `personal_autorizado`. Cada carga actualiza sin borrar lo
// anterior y elimina lo que lleve más de 7 días cargado.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "método no permitido" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Identificar a quien carga: el JWT debe ser de un usuario, no la anon key.
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(token);
  const email = u?.user?.email?.toLowerCase();
  if (!email) return json({ error: "Inicie sesión para cargar la agenda." }, 401);

  const { data: permitido } = await admin
    .from("personal_autorizado").select("email").eq("email", email).maybeSingle();
  if (!permitido) return json({ error: "Este correo no está autorizado para cargar la agenda." }, 403);

  // 2. Validar filas.
  let filas: any[] = [];
  try {
    const body = await req.json();
    filas = Array.isArray(body.filas) ? body.filas : [];
  } catch {
    return json({ error: "cuerpo inválido" }, 400);
  }
  if (filas.length === 0) return json({ error: "El archivo no trae filas." }, 400);
  if (filas.length > 5000) return json({ error: "Demasiadas filas (máximo 5000)." }, 400);

  const validas: any[] = [];
  let descartadas = 0;
  for (const f of filas) {
    const documento = String(f.documento ?? "").replace(/\D/g, "");
    const fecha = String(f.fecha ?? "");
    const hora = String(f.hora ?? "");
    const tipo = String(f.tipo_cirugia ?? "").trim().replace(/\s+/g, " ");
    const cirujano = String(f.cirujano ?? "").trim().replace(/\s+/g, " ");
    if (documento.length < 4 || !FECHA.test(fecha) || !HORA.test(hora) || !tipo || !cirujano) {
      descartadas++;
      continue;
    }
    validas.push({
      documento, fecha, hora, tipo_cirugia: tipo, cirujano,
      cups: String(f.cups ?? "").trim(),
      ...(f.sede ? { sede: String(f.sede).trim() } : {}),
      cargado_en: new Date().toISOString(),
    });
  }

  // Quitar duplicados dentro del mismo archivo (misma llave de la tabla).
  const unicas = [...new Map(validas.map((v) => [`${v.documento}|${v.fecha}|${v.hora}|${v.cups}`, v])).values()];

  for (let i = 0; i < unicas.length; i += 500) {
    const { error } = await admin.from("cirugias")
      .upsert(unicas.slice(i, i + 500), { onConflict: "documento,fecha,hora,cups" });
    if (error) return json({ error: "No se pudo guardar: " + error.message }, 500);
  }

  const { data: borradas } = await admin.rpc("purgar_cirugias_antiguas");

  return json({
    guardadas: unicas.length,
    duplicadas: validas.length - unicas.length,
    descartadas,
    borradasPorAntiguas: borradas ?? 0,
  });
});
