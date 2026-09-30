// supabase/functions/consulta-cita/index.ts
//
// Recibe { cedula } desde el kiosco y responde con la cirugía programada:
// confirmación de la cédula, fecha, hora, tipo de cirugía, cirujano y sede.
// Todo sale de la tabla `cirugias` (service role, nunca expuesta al navegador).
// El mensaje se arma con una plantilla fija: ningún dato pasa por un modelo de lenguaje.

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

// "2026-09-30" -> "miércoles 30 de septiembre de 2026"
function fechaLarga(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(iso + "T12:00:00Z"));
}

// "14:05" -> "2:05 de la tarde"
function horaHablada(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const franja = h < 12 ? "de la mañana" : h < 19 ? "de la tarde" : "de la noche";
  return `${h12}:${String(m).padStart(2, "0")} ${franja}`;
}

function nombreCorto(s: string): string {
  return s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "método no permitido" }, 405);

  let cedula = "";
  try {
    const body = await req.json();
    cedula = String(body.cedula || "").replace(/\D/g, "");
  } catch {
    return json({ error: "cuerpo inválido" }, 400);
  }
  if (cedula.length < 4) return json({ error: "cédula inválida" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: filas, error } = await supabase
    .from("cirugias")
    .select("documento, fecha, hora, tipo_cirugia, cirujano, sede")
    .eq("documento", cedula)
    .order("fecha", { ascending: true })
    .order("hora", { ascending: true });

  if (error) return json({ error: "error de base de datos" }, 500);

  // Auditoría sin datos personales: solo si se encontró o no.
  supabase.from("consultas_kiosco").insert({ encontrada: !!(filas && filas.length) })
    .then(() => {}, () => {});

  if (!filas || filas.length === 0) {
    return json({
      encontrada: false,
      mensaje: "No encontramos una cirugía programada con ese número de cédula. Revise el número, o acérquese al mostrador de admisiones para que lo ayuden.",
      datos: null,
    });
  }

  // Se muestra la próxima cirugía (hora de Colombia, UTC-5); si todas ya pasaron, la más reciente.
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const proximas = filas.filter((f: any) => f.fecha >= hoy);
  const c: any = proximas.length ? proximas[0] : filas[filas.length - 1];
  const hora = String(c.hora).slice(0, 5);

  const datos = {
    cedula,
    fecha: c.fecha,
    fechaTexto: fechaLarga(c.fecha),
    hora,
    horaTexto: horaHablada(hora),
    tipo: nombreCorto(c.tipo_cirugia),
    cirujano: nombreCorto(c.cirujano),
    sede: c.sede,
    otras: filas.length - 1,
  };

  const mensaje =
    `Confirmamos el documento número ${cedula}. Su cirugía es el ${datos.fechaTexto}, ` +
    `a las ${datos.horaTexto}. Es ${datos.tipo}; su cirujano es ${datos.cirujano}, en ${datos.sede}.`;

  return json({ encontrada: true, mensaje, datos });
});
