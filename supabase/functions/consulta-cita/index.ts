// supabase/functions/consulta-cita/index.ts
//
// Flujo:
//   1. Recibe { cedula } desde el kiosco (navegador).
//   2. Busca la cita en la tabla `citas` con la SERVICE ROLE KEY (nunca expuesta
//      al navegador). Esta consulta es la ÚNICA fuente de verdad: hora, médico,
//      sede, piso y consultorio salen de aquí, no del modelo de lenguaje.
//   3. Si hay cita, le pasa esos datos ya calculados (estado, hora de llegada,
//      recomendaciones) a Claude, con instrucciones explícitas de no inventar
//      ni modificar ningún dato — su único trabajo es la redacción cálida.
//   4. Si no hay cita, responde con un mensaje fijo (no gasta llamado al LLM
//      y evita que el modelo intente adivinar).
//
// Variables de entorno que necesita este función (Project Settings → Edge
// Functions → Secrets, o `supabase secrets set NOMBRE=valor`):
//   ANTHROPIC_API_KEY        -> su llave de la API de Claude
//   SUPABASE_URL             -> la inyecta Supabase automáticamente
//   SUPABASE_SERVICE_ROLE_KEY-> la inyecta Supabase automáticamente

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Debe reflejar el protocolo real de la clínica. Si se agrega un tipo de cita
// nuevo, agréguelo aquí también — el modelo NO decide estos tiempos ni textos.
const TIPOS: Record<string, { nombre: string; antesMin: number; prep: string[] }> = {
  consulta: { nombre: "Consulta con el oftalmólogo", antesMin: 20,
    prep: ["Traer el documento de identidad.", "Traer las gafas o lentes que usa hoy.", "Traer la lista de medicamentos que toma."] },
  optometria: { nombre: "Consulta de optometría", antesMin: 20,
    prep: ["Traer el documento de identidad.", "Traer sus gafas actuales y la fórmula anterior si la tiene."] },
  cirugia: { nombre: "Cirugía de catarata", antesMin: 60,
    prep: ["Venir acompañado por un adulto; no podrá irse solo.", "No comer ni beber nada desde 8 horas antes.", "No usar cremas ni maquillaje en la cara.", "Traer las gotas formuladas."] },
  postoperatorio: { nombre: "Control después de la cirugía", antesMin: 20,
    prep: ["Traer las gotas que está usando.", "Traer el carné de la cirugía."] },
  oct: { nombre: "Examen de imágenes del ojo (OCT)", antesMin: 20,
    prep: ["Le dilatarán las pupilas: verá borroso unas horas.", "Venir acompañado, no podrá conducir después.", "Traer gafas oscuras para la salida."] },
  inyeccion: { nombre: "Inyección en el ojo", antesMin: 30,
    prep: ["Venir acompañado por un adulto.", "No usar cremas ni maquillaje en la cara.", "Descansar el resto del día después del procedimiento."] },
  laser: { nombre: "Tratamiento con láser", antesMin: 30,
    prep: ["Le dilatarán las pupilas: verá borroso unas horas.", "Venir acompañado, no podrá conducir después.", "Traer gafas oscuras para la salida."] },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function restarMinutos(hhmm: string, minutos: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  let total = h * 60 + m - minutos;
  if (total < 0) total += 1440;
  return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
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
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: citas, error } = await supabase
    .from("citas")
    .select("*")
    .eq("doc", cedula);

  if (error) return json({ error: "error de base de datos" }, 500);

  // Registro de auditoría; si la tabla no existe todavía, no debe tumbar la respuesta.
  supabase.from("consultas_kiosco").insert({
    doc: cedula, encontrada: !!(citas && citas.length), hora_consulta: new Date().toISOString(),
  }).then(() => {}, () => {});

  if (!citas || citas.length === 0) {
    return json({
      encontrada: false,
      mensaje: "No encontramos una cita con ese número de documento. Revise el número, o acérquese al mostrador de admisiones para que lo ayuden.",
      datos: null,
    });
  }

  // Si la persona tiene varias citas registradas, se prioriza la de hoy más
  // próxima en el tiempo; si todas ya pasaron, se muestra la más reciente.
  // La columna `hora` es de tipo time y llega como "HH:MM:SS"; se normaliza a "HH:MM".
  citas.forEach((c: any) => { c.hora = String(c.hora).slice(0, 5); });

  // La clínica está en Colombia (UTC-5, sin horario de verano); el servidor corre en UTC.
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const ahora = new Date();
  function minutosDesdeAhora(c: any): number {
    const fechaHora = new Date((c.fecha || hoy) + "T" + c.hora + ":00-05:00");
    return Math.round((fechaHora.getTime() - ahora.getTime()) / 60000);
  }
  citas.sort((a: any, b: any) => Math.abs(minutosDesdeAhora(a)) - Math.abs(minutosDesdeAhora(b)));
  const cita = citas[0];

  const t = TIPOS[cita.tipo] || TIPOS["consulta"];
  const faltan = minutosDesdeAhora(cita);
  const esHoy = (cita.fecha || hoy) === hoy;
  const horaLlegada = restarMinutos(cita.hora, t.antesMin);

  let estado: string;
  if (!esHoy) estado = faltan > 0 ? "es_otro_dia" : "ya_paso_hace_dias";
  else if (faltan > 15) estado = "con_tiempo";
  else if (faltan >= -10) estado = "es_su_turno";
  else estado = "ya_paso";

  const datos = {
    nombre: cita.nombre,
    doc: cita.doc,
    fecha: cita.fecha || hoy,
    hora: cita.hora,
    tipo: t.nombre,
    profesional: cita.profesional,
    sede: cita.sede,
    piso: cita.piso,
    consultorio: cita.consultorio,
    estado,
    minutosParaLaCita: faltan,
    horaLlegadaRecomendada: horaLlegada,
    recomendaciones: t.prep,
  };

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  let mensaje: string;

  if (!apiKey) {
    // Respaldo sin LLM, por si la llave no está configurada todavía: el kiosco
    // sigue funcionando (solo pierde la redacción cálida y personalizada).
    mensaje = `${datos.nombre}, su ${datos.tipo} es a las ${datos.hora} con ${datos.profesional}, ` +
      `en ${datos.sede}, piso ${datos.piso}, consultorio ${datos.consultorio}.`;
  } else {
    try {
      const prompt =
        "Eres la voz de un kiosco de orientación de una clínica oftalmológica para adultos mayores, " +
        "muchos con baja visión. Vas a redactar UN SOLO PÁRRAFO CORTO (máximo 5 frases), en español de " +
        "Colombia, cálido y claro, para que se lea en voz alta a la persona. " +
        "USA EXCLUSIVAMENTE estos datos, en este orden de importancia: estado de la cita, hora, tipo de " +
        "procedimiento, profesional que la atiende, y a dónde debe ir (sede, piso, consultorio). " +
        "Si hay recomendaciones, menciona las 1 o 2 más importantes al final. " +
        "NUNCA inventes, cambies ni redondees ninguna hora, nombre, piso o consultorio: usa exactamente " +
        "los que te doy. No agregues saludos largos ni información que no esté en los datos.\n\n" +
        "Datos de la cita (formato JSON):\n" + JSON.stringify(datos);

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 300,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const result = await resp.json();
      mensaje = result?.content?.[0]?.text?.trim() ||
        `${datos.nombre}, su cita es a las ${datos.hora} con ${datos.profesional} en ${datos.sede}.`;
    } catch {
      mensaje = `${datos.nombre}, su ${datos.tipo} es a las ${datos.hora} con ${datos.profesional}, ` +
        `en ${datos.sede}, piso ${datos.piso}, consultorio ${datos.consultorio}.`;
    }
  }

  return json({ encontrada: true, mensaje, datos });
});
