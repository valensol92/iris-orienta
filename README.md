# Iris Orienta

Kiosco de orientación para pacientes de la Clínica de la Visión del Valle.
El paciente dice o escribe su número de cédula y el kiosco le responde —en
pantalla y en voz— la hora de su cita, el tipo de procedimiento, el
profesional que lo atiende y a dónde debe ir. Diseñado para adultos mayores
con baja visión: letra grande ajustable, alto contraste, lectura en voz alta
y varias formas de escribir el número (voz, teclado del teléfono, botones
grandes en pantalla).

## Arquitectura

```
Navegador (GitHub Pages, estático)          Servidor (Supabase)
┌─────────────────────────────┐            ┌──────────────────────────────┐
│ index.html + css/ + js/      │  fetch()   │ Edge Function: consulta-cita │
│  - voz.js   (habla/escucha)  │ ─────────► │  - lee la tabla `citas`      │
│  - api.js   (llama al        │            │    (con la service role key, │
│              backend)        │            │    nunca expuesta al público)│
│  - app.js   (pantallas,      │ ◄───────── │  - llama a Claude solo para  │
│              estado)         │  respuesta │    REDACTAR la respuesta,    │
└─────────────────────────────┘  { mensaje, │    nunca para inventar datos │
                                    datos }  └──────────────────────────────┘
```

**Por qué está dividido así:** GitHub Pages solo sirve archivos estáticos —
no puede guardar en secreto una llave de API. Por eso la llave de Claude y la
llave de servicio de Supabase viven *solo* dentro de la Edge Function, en el
servidor. El navegador únicamente conoce la URL pública de la función y la
`anon key`, que no da acceso de lectura directa a la tabla de citas (ver
`supabase/migrations/0001_citas.sql`).

**Por qué Claude no busca la cita, solo la redacta:** en un entorno clínico
no puede haber riesgo de que un modelo de lenguaje invente una hora, un
consultorio o un profesional. La búsqueda en la base de datos y el cálculo de
si el paciente llega a tiempo se hacen con código determinístico en la Edge
Function; a Claude solo se le pasan esos datos ya calculados, con la
instrucción explícita de no modificarlos, y su única tarea es redactar un
párrafo cálido para leer en voz alta.

**Por qué la voz es la del navegador y no un servicio en la nube:** es
gratis, no requiere llave de API ni facturación, y funciona bien en
Chrome/Android, que es lo más común en dispositivos públicos de este tipo.
Limitación conocida: el reconocimiento de voz (no la síntesis) todavía no
funciona en Safari/iOS — por eso el teclado en pantalla y el campo de texto
siempre quedan disponibles como alternativa, nunca dependa solo de la voz.

## Estructura del repositorio

```
public/                        → todo lo que sirve GitHub Pages
  index.html
  css/estilo.css
  js/app.js                    → orquesta pantallas, teclado y voz
  js/voz.js                    → reconocimiento y síntesis de voz
  js/api.js                    → llama a la Edge Function
supabase/
  functions/consulta-cita/     → la Edge Function (Deno)
  migrations/0001_citas.sql    → esquema de la base de datos
.github/workflows/deploy-pages.yml → publica public/ en GitHub Pages
```

## Cómo desplegarlo

### 1. Subir el repositorio a GitHub

```bash
cd iris-orienta
git remote add origin https://github.com/SU-USUARIO/iris-orienta.git
git branch -M main
git push -u origin main
```

### 2. Activar GitHub Pages

En el repositorio en GitHub: **Settings → Pages → Build and deployment →
Source: "GitHub Actions"**. El workflow ya incluido (`deploy-pages.yml`) se
encarga de publicar `public/` automáticamente en cada `push` a `main`.

### 3. Aplicar la migración en Supabase

En el panel de Supabase (SQL Editor) o con la CLI:

```bash
supabase link --project-ref iergxsachwnhufnzwmbg
supabase db push
```

Esto crea las tablas `citas` (con datos de ejemplo) y `consultas_kiosco`.

### 4. Configurar la llave de Claude como secreto

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

### 5. Desplegar la Edge Function

```bash
supabase functions deploy consulta-cita
```

### 6. Conectar el front-end con su proyecto

Edite `public/js/api.js` y reemplace `SUPABASE_ANON_KEY` por la `anon key`
real de su proyecto (Project Settings → API — es pública por diseño, no hace
falta ocultarla). Vuelva a hacer `git push` para que Pages se actualice.

## Probarlo ya

Con los datos de ejemplo de la migración, estas cédulas tienen cita hoy:
`16254789`, `31478652`, `6312905`, `29845113`, `1144203876`.

## Qué falta para producción (próximos pasos)

- **Cargar la agenda real**: hoy la tabla se llena a mano o con la migración
  de ejemplo. Falta un proceso (script o integración) que sincronice la
  agenda real del sistema de citas de la clínica hacia la tabla `citas`.
- **Panel de administración**: la versión anterior del kiosco tenía un panel
  para que el personal pegara la agenda del día manualmente; se retiró al
  pasar a una base de datos real. Si todavía se necesita mientras se conecta
  la agenda real, hay que construir una pantalla de administración aparte
  (fuera de este repositorio público, con su propio inicio de sesión).
- **Servicio de voz en la nube**: si más adelante el reconocimiento del
  navegador no es suficientemente confiable (por ejemplo, en tabletas con
  Safari), se puede reemplazar `public/js/voz.js` por una integración con un
  servicio de voz de pago, sin tocar el resto de la arquitectura.
- **Métricas**: la tabla `consultas_kiosco` ya registra cada consulta y si
  encontró cita o no — con eso se puede armar el indicador de "consultas
  informativas que salieron de la fila de admisión" que se propuso en la
  presentación del proyecto.


## Carga diaria de la agenda de cirugías

1. Abra `https://valensol92.github.io/iris-orienta/admin.html`.
2. Inicie sesión con un correo autorizado (tabla `personal_autorizado`).
3. Elija el Excel del día y revise la vista previa (conteo y primeras 5 filas).
4. Toque **Subir agenda**.

El archivo se lee en el navegador; solo se envían 5 columnas: `documento_paciente`,
`fecha_programada` (fecha y hora), `descripcion_lq` (tipo de cirugía), `cargo_liq` (código)
y `cirujano_prog`. Nombre, fecha de nacimiento, plan y demás no se guardan.
Si el Excel trae una columna `sede`, se usa; si no, aplica la sede por defecto de la tabla
(`cirugias.sede`). Cada carga actualiza sin borrar (llave: cédula + fecha + hora + código) y
elimina lo que lleve más de 7 días cargado (también hay un borrado diario con pg_cron).

Migración: `supabase/migrations/0002_cirugias.sql`. Funciones: `consulta-cita` (kiosco) y
`cargar-agenda` (carga; exige sesión y correo autorizado).
