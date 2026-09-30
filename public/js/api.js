// public/js/api.js
// El navegador NUNCA habla directo con la base de datos ni con la API de Claude:
// esas llaves solo existen dentro de la Edge Function, en el servidor de Supabase.
// Aquí el kiosco solo llama a esa función con el número de cédula.

export const Api = (function () {
  "use strict";

  // Reemplace estos dos valores por los de su proyecto de Supabase
  // (Project Settings → API). La "anon key" es pública por diseño: solo
  // sirve para invocar la función, no para leer la tabla de citas directamente.
  var SUPABASE_URL = "https://iergxsachwnhufnzwmbg.supabase.co";
  var SUPABASE_ANON_KEY = "REEMPLACE_CON_SU_ANON_KEY";
  var ENDPOINT = SUPABASE_URL + "/functions/v1/consulta-cita";

  // consultarCita(cedula) -> Promise<{encontrada, mensaje, datos}>
  function consultarCita(cedula) {
    return fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ cedula: cedula })
    }).then(function (res) {
      if (!res.ok) throw new Error("http-" + res.status);
      return res.json();
    });
  }

  return { consultarCita: consultarCita };
})();
