// public/js/app.js
import { Voz } from "./voz.js";
import { Api } from "./api.js";

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var prefs = { escala: 1, contraste: "normal", voz: true };
  var numero = "";
  var temporizador = null, avisoTimer = null;
  var ultimaRespuesta = null;

  // ---------------- preferencias (letra, contraste, voz) ----------------
  function leer(clave) { try { return localStorage.getItem(clave); } catch (e) { return null; } }
  function guardar(clave, valor) { try { localStorage.setItem(clave, valor); } catch (e) {} }

  function cargarPrefs() {
    try {
      var p = JSON.parse(leer("iris_prefs") || "null");
      if (p && typeof p === "object") {
        if (p.escala) prefs.escala = p.escala;
        if (p.contraste) prefs.contraste = p.contraste;
        if (typeof p.voz === "boolean") prefs.voz = p.voz;
      }
    } catch (e) {}
    aplicarPrefs();
  }
  function aplicarPrefs() {
    document.documentElement.style.setProperty("--escala", prefs.escala);
    document.documentElement.setAttribute("data-contraste", prefs.contraste);
    $("btnContraste").setAttribute("aria-pressed", prefs.contraste === "alto" ? "true" : "false");
    $("btnVoz").setAttribute("aria-pressed", prefs.voz ? "true" : "false");
    $("btnTexto").firstElementChild.textContent = prefs.escala >= 1.5 ? "A" : "A⁺";
    $("btnTexto").lastChild.textContent = prefs.escala >= 1.5 ? " Letra normal" : " Letra más grande";
    guardar("iris_prefs", JSON.stringify(prefs));
  }

  function hablar(texto, cb) { if (prefs.voz) Voz.hablar(texto, cb); else if (cb) cb(); }

  // ---------------- pantallas ----------------
  var PANTALLAS = ["pantallaInicio", "pantallaCargando", "pantallaCita", "pantallaNoEncontrado", "pantallaError"];
  function mostrar(id) {
    PANTALLAS.forEach(function (p) { $(p).classList.toggle("activa", p === id); });
    window.scrollTo(0, 0);
  }

  function reiniciar() {
    clearTimeout(temporizador); clearInterval(avisoTimer);
    Voz.callar();
    numero = "";
    $("visor").value = "";
    pintarVisor();
    $("avisoCierre").textContent = "";
    $("avisoCierre2").textContent = "";
    $("avisoVoz").textContent = "";
    mostrar("pantallaInicio");
  }

  function programarCierre(el) {
    clearTimeout(temporizador); clearInterval(avisoTimer);
    var restante = 75;
    el.textContent = "";
    avisoTimer = setInterval(function () {
      restante--;
      if (restante <= 20 && restante > 0) el.textContent = "Esta pantalla se cierra en " + restante + " segundos.";
      if (restante <= 0) { clearInterval(avisoTimer); reiniciar(); }
    }, 1000);
  }
  function reprogramar() {
    if ($("pantallaCita").classList.contains("activa")) programarCierre($("avisoCierre"));
    else if ($("pantallaNoEncontrado").classList.contains("activa")) programarCierre($("avisoCierre2"));
  }

  // ---------------- número (teclado, input, voz — todo pasa por aquí) ----------------
  function pintarVisor() { $("btnConsultar").disabled = numero.length < 4; }
  function fijarNumero(v) {
    numero = String(v).replace(/\D/g, "").slice(0, 12);
    $("visor").value = numero;
    pintarVisor();
  }
  function agregarDigito(d) { if (numero.length < 12) fijarNumero(numero + d); }

  // ---------------- voz de entrada ----------------
  if (!Voz.reconocimientoDisponible) {
    $("btnHablar").style.display = "none";
    $("avisoVoz").textContent = "Este navegador no reconoce voz todavía: use el teclado de abajo.";
  }
  $("btnHablar").addEventListener("click", function () {
    var boton = $("btnHablar");
    boton.setAttribute("data-escuchando", "true");
    $("textoHablar").textContent = "Escuchando… diga su número de cédula";
    $("avisoVoz").removeAttribute("data-tipo");
    $("avisoVoz").textContent = "";
    Voz.escuchar({
      onResultado: function (digitos) {
        fijarNumero(digitos);
        $("avisoVoz").textContent = "Entendí: " + digitos.split("").join(" ");
        if (numero.length >= 4) consultar();
      },
      onError: function (motivo) {
        var mensajes = {
          "no-disponible": "No pudimos usar el micrófono en este navegador.",
          "not-allowed": "No tiene permiso para usar el micrófono. Actívelo en el navegador.",
          "no-speech": "No escuchamos nada. Intente de nuevo o use el teclado.",
          "sin-numero": "No entendimos un número. Intente de nuevo, más despacio.",
        };
        $("avisoVoz").setAttribute("data-tipo", "error");
        $("avisoVoz").textContent = mensajes[motivo] || "No pudimos escuchar bien. Intente de nuevo o use el teclado.";
      },
      onFin: function () {
        boton.removeAttribute("data-escuchando");
        $("textoHablar").textContent = "🎙️ Toque aquí y diga su número de cédula";
      },
    });
  });

  // ---------------- consulta a la API ----------------
  function consultar() {
    Voz.detener();
    mostrar("pantallaCargando");
    Api.consultarCita(numero).then(function (resp) {
      ultimaRespuesta = resp;
      if (resp.encontrada) pintarCita(resp);
      else pintarNoEncontrado(resp);
    }).catch(function () {
      mostrar("pantallaError");
    });
  }

  function formato12(hhmm) {
    var p = hhmm.split(":"); var h = parseInt(p[0], 10), min = parseInt(p[1], 10);
    var suf = h < 12 ? "a. m." : "p. m."; var h12 = h % 12; if (h12 === 0) h12 = 12;
    return { texto: h12 + ":" + String(min).padStart(2, "0"), sufijo: suf };
  }

  function pintarCita(resp) {
    var d = resp.datos;
    var h = formato12(d.hora);
    $("saludo").innerHTML = "Buen día, " + d.nombre + "<span>Cédula " + d.doc + "</span>";

    var estadoTextos = {
      con_tiempo: "Llegó con tiempo.",
      es_su_turno: "Es su turno. Pase a la sala de espera.",
      ya_paso: "Su hora ya pasó. Acérquese al mostrador.",
      es_otro_dia: "Su cita es otro día, no hoy.",
      ya_paso_hace_dias: "Esta cita ya pasó. Consulte en el mostrador si necesita una nueva.",
    };
    var estadoEl = $("estado");
    estadoEl.className = "estado" + (d.estado === "con_tiempo" || d.estado === "es_otro_dia" ? " espera" : d.estado === "ya_paso" || d.estado === "ya_paso_hace_dias" ? " tarde" : "");
    estadoEl.textContent = estadoTextos[d.estado] || "";

    $("hora").innerHTML = h.texto + " <small>" + h.sufijo + "</small>";
    $("horaLlegada").textContent = d.fecha ? ("Fecha: " + d.fecha + ". Le pedimos llegar desde las " + formato12(d.horaLlegadaRecomendada).texto + ".") : "";

    $("datos").innerHTML =
      fila("Su cita es para", d.tipo) +
      fila("Lo atiende", d.profesional) +
      fila("Vaya a", "Piso " + d.piso + ", consultorio " + d.consultorio, d.sede);

    $("listaRecomendaciones").innerHTML = (d.recomendaciones || []).map(function (p) { return "<li>" + p + "</li>"; }).join("");

    mostrar("pantallaCita");
    hablar(resp.mensaje);
    programarCierre($("avisoCierre"));
  }
  function fila(etiqueta, valor, extra) {
    return '<div class="dato"><div><p class="etiqueta">' + etiqueta + '</p><p class="valor">' + valor + "</p>" +
      (extra ? '<p class="extra">' + extra + "</p>" : "") + "</div></div>";
  }

  function pintarNoEncontrado(resp) {
    $("docNoEncontrado").textContent = "Número consultado: " + numero;
    mostrar("pantallaNoEncontrado");
    hablar(resp.mensaje);
    programarCierre($("avisoCierre2"));
  }

  // ---------------- eventos ----------------
  $("teclado").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-d]");
    if (b) agregarDigito(b.getAttribute("data-d"));
  });
  $("btnBorrar").addEventListener("click", function () { fijarNumero(numero.slice(0, -1)); });
  $("btnBorrarTodo").addEventListener("click", function () { fijarNumero(""); });
  $("visor").addEventListener("input", function () { fijarNumero($("visor").value); });
  $("btnConsultar").addEventListener("click", consultar);
  $("btnTerminar").addEventListener("click", reiniciar);
  $("btnReintentar").addEventListener("click", reiniciar);
  $("btnReintentarError").addEventListener("click", reiniciar);
  $("btnRepetir").addEventListener("click", function () { if (ultimaRespuesta) hablar(ultimaRespuesta.mensaje); reprogramar(); });
  $("btnEscucharError").addEventListener("click", function () { if (ultimaRespuesta) hablar(ultimaRespuesta.mensaje); reprogramar(); });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && $("pantallaInicio").classList.contains("activa") && numero.length >= 4) consultar();
    else if (e.key === "Escape") reiniciar();
  });
  ["click", "touchstart", "keydown"].forEach(function (ev) {
    document.addEventListener(ev, reprogramar, { passive: true });
  });

  $("btnTexto").addEventListener("click", function () {
    prefs.escala = prefs.escala >= 1.5 ? 1 : prefs.escala >= 1.25 ? 1.5 : 1.25;
    aplicarPrefs();
    hablar(prefs.escala > 1 ? "Letra más grande" : "Letra normal");
  });
  $("btnContraste").addEventListener("click", function () {
    prefs.contraste = prefs.contraste === "alto" ? "normal" : "alto";
    aplicarPrefs();
    hablar(prefs.contraste === "alto" ? "Fondo negro con letras amarillas" : "Fondo blanco con letras negras");
  });
  $("btnVoz").addEventListener("click", function () {
    prefs.voz = !prefs.voz;
    aplicarPrefs();
    if (prefs.voz) hablar("Voz activada"); else Voz.callar();
  });

  cargarPrefs();
  pintarVisor();
  $("fechaHoy").textContent = new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
})();
