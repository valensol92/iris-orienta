// public/js/voz.js
// Envuelve las dos mitades de la Web Speech API que ya trae el navegador:
// - SpeechSynthesis: para que el kiosco hable (funciona en Android, iOS y escritorio).
// - SpeechRecognition: para que el kiosco escuche (Chrome/Android la soportan bien;
//   Safari/iOS todavía no la implementa de forma confiable, por eso el teclado
//   numérico en pantalla y el campo escribible SIEMPRE quedan como alternativa).

export const Voz = (function () {
  "use strict";

  var vozEs = null;
  var reconocedor = null;
  var escuchando = false;

  function elegirVoz() {
    if (!("speechSynthesis" in window)) return;
    var voces = window.speechSynthesis.getVoices() || [];
    vozEs = voces.filter(function (v) { return /^es/i.test(v.lang); })[0] || null;
  }
  if ("speechSynthesis" in window) {
    elegirVoz();
    window.speechSynthesis.onvoiceschanged = elegirVoz;
  }

  function hablar(texto, alTerminar) {
    if (!("speechSynthesis" in window)) { if (alTerminar) alTerminar(); return; }
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(texto);
      u.lang = "es-CO";
      if (vozEs) u.voice = vozEs;
      u.rate = 0.88;
      u.pitch = 1;
      if (alTerminar) { u.onend = alTerminar; u.onerror = alTerminar; }
      window.speechSynthesis.speak(u);
    } catch (e) { if (alTerminar) alTerminar(); }
  }
  function callar() {
    if ("speechSynthesis" in window) { try { window.speechSynthesis.cancel(); } catch (e) {} }
  }

  // -------- reconocimiento --------
  var ReconocedorNativo = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var disponible = !!ReconocedorNativo;

  function crearReconocedor() {
    var r = new ReconocedorNativo();
    r.lang = "es-CO";
    r.continuous = false;
    r.interimResults = false;
    r.maxAlternatives = 3;
    return r;
  }

  // Convierte lo que la persona dijo en dígitos. La gente suele decir el número
  // cédula por cédula ("uno seis dos cinco...") o en bloques ("dieciséis millones...").
  // Nos quedamos con la lectura dígito a dígito, que es la más confiable, y también
  // tomamos cualquier secuencia de números que el reconocedor ya haya transcrito
  // como cifras (algunos motores devuelven "16254789" directamente).
  var PALABRAS_DIGITO = {
    "cero": "0", "uno": "1", "un": "1", "dos": "2", "tres": "3", "cuatro": "4",
    "cinco": "5", "seis": "6", "siete": "7", "ocho": "8", "nueve": "9"
  };
  function extraerDigitos(texto) {
    var directo = (texto.match(/\d/g) || []).join("");
    if (directo.length >= 4) return directo;
    var palabras = texto.toLowerCase().replace(/[.,]/g, " ").split(/\s+/);
    var digitos = "";
    for (var i = 0; i < palabras.length; i++) {
      if (PALABRAS_DIGITO.hasOwnProperty(palabras[i])) digitos += PALABRAS_DIGITO[palabras[i]];
    }
    return digitos || directo;
  }

  // escuchar(callbacks) — callbacks: {onResultado(digitos, textoOriginal), onError(motivo), onFin, onInicio}
  function escuchar(callbacks) {
    callbacks = callbacks || {};
    if (!disponible) { callbacks.onError && callbacks.onError("no-disponible"); return; }
    if (escuchando) return;
    try {
      reconocedor = crearReconocedor();
    } catch (e) { callbacks.onError && callbacks.onError("no-disponible"); return; }

    escuchando = true;
    reconocedor.onstart = function () { callbacks.onInicio && callbacks.onInicio(); };
    reconocedor.onresult = function (ev) {
      var texto = "";
      for (var i = 0; i < ev.results[0].length; i++) {
        var alt = ev.results[0][i].transcript;
        var d = extraerDigitos(alt);
        if (d.length >= 4) { texto = alt; callbacks.onResultado && callbacks.onResultado(d, alt); return; }
        if (!texto) texto = alt;
      }
      callbacks.onError && callbacks.onError("sin-numero", texto);
    };
    reconocedor.onerror = function (ev) {
      escuchando = false;
      callbacks.onError && callbacks.onError(ev.error || "desconocido");
    };
    reconocedor.onend = function () {
      escuchando = false;
      callbacks.onFin && callbacks.onFin();
    };
    try { reconocedor.start(); } catch (e) { escuchando = false; callbacks.onError && callbacks.onError("no-disponible"); }
  }

  function detener() {
    if (reconocedor && escuchando) { try { reconocedor.stop(); } catch (e) {} }
  }

  return {
    hablar: hablar,
    callar: callar,
    escuchar: escuchar,
    detener: detener,
    reconocimientoDisponible: disponible,
    extraerDigitos: extraerDigitos
  };
})();
