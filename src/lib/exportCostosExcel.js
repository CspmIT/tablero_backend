// Exportador del Excel anualizado de Costos de Operación — formato Nadia.
// ESTRATEGIA: la plantilla es EL ARCHIVO REAL de administración (con sus 690
// celdas combinadas, estilos y la hoja "asientos" cuyos asientos contables
// referencian coordenadas fijas de "Asignacion"). Por eso este exportador
// escribe SIEMPRE en el lugar: jamás inserta ni borra filas. Los bloques
// mensuales se detectan dinámicamente (varían de tamaño entre meses) y solo
// se tocan las celdas de entrada + tres fórmulas que se estandarizan:
//   1. HORAS OPERACION: /7 hardcodeado → COUNTIF de colaboradores con peso
//   2. Columna W (Cooptech ponderado) escrita en todos los meses
//   3. % I+D a activar = criterio de la app (excluye funcion != desarrollo)
// Meses sin datos en la app quedan en blanco (xxx / ceros / sin costo).
import XlsxPopulate from 'xlsx-populate';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const aqui = dirname(fileURLToPath(import.meta.url));
const PLANTILLAS = { 2026: join(aqui, '..', 'assets', 'Costos_plantilla_2026.xlsx') };

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
// Unidad de negocio (app) → columna de "Hs. Asignadas" en el Excel.
const COL_UNIDAD = { adm: 'G', energia: 'I', agua: 'K', tele: 'M', canal50: 'O', cac: 'Q', alm_taller: 'S', serv_sociales: 'U' };
// Columnas del resumen semanal (WIP de la grilla) al costado de cada bloque.
// La plantilla trae Y..AB; AC se usa solo cuando el mes tiene 5 semanas.
const COLS_SEMANA = ['Y', 'Z', 'AA', 'AB', 'AC'];

// Semanas del mes: arrancan en el primer lunes >= día 1 — réplica EXACTA de
// weeksOfMonth del frontend (costosUtils), que es como Costos bucketiza las
// unidades. Cada semana se identifica con la clave del WIP de la grilla:
// año calendario del lunes + número de semana ISO (ídem getWeekKey).
function semanasDelMes(anio, mesIdx) {
  const lunes = new Date(anio, mesIdx, 1);
  const dow = lunes.getDay() || 7;
  if (dow !== 1) lunes.setDate(lunes.getDate() + (8 - dow));
  const semanas = [];
  while (lunes.getMonth() === mesIdx && lunes.getFullYear() === anio) {
    semanas.push(new Date(lunes));
    lunes.setDate(lunes.getDate() + 7);
  }
  return semanas;
}

const dd = (n) => String(n).padStart(2, '0');

// Etiqueta estilo Leonardo: "Semana 1 - 05 al 11", con el fin recortado al
// último día del mes (enero: "26 al 31").
function etiquetaSemana(n, lunes, anio, mesIdx) {
  const finMes = new Date(anio, mesIdx + 1, 0).getDate();
  return `Semana ${n} - ${dd(lunes.getDate())} al ${dd(Math.min(lunes.getDate() + 6, finMes))}`;
}

// Suma de % por unidad a lo largo de las semanas del mes (réplica exacta de
// monthlyUnidadesSum del frontend: los % semanales YA vienen prorrateados).
function unidadesDelMes(weeks) {
  const out = {};
  for (const k of Object.keys(COL_UNIDAD)) out[k] = 0;
  for (const w of (weeks || [])) {
    for (const k of Object.keys(COL_UNIDAD)) out[k] += parseFloat(w?.unidades?.[k]) || 0;
  }
  return out;
}

// Detecta los bloques mensuales en la hoja: fila de título, filas de personas,
// fila de totales, fila del costo laboral, cotización y las líneas de resumen.
function detectarBloques(hoja) {
  const bloques = {};
  const maxRow = hoja.usedRange().endCell().rowNumber();
  const titulos = [];
  for (let r = 1; r <= maxRow; r++) {
    const v = hoja.cell(`B${r}`).value();
    if (typeof v === 'string') {
      const m = MESES.find((mm) => v.trim().startsWith(mm + ' '));
      if (m) titulos.push({ mesNombre: m, fila: r });
    }
  }
  for (const t of titulos) {
    const b = { titulo: t.fila, mes: t.mesNombre };
    for (let r = t.fila + 1; r <= Math.min(t.fila + 40, maxRow); r++) {
      const v = hoja.cell(`B${r}`).value();
      if (typeof v !== 'string') continue;
      const s = v.trim();
      if (s.startsWith('Costo laboral') && !b.costoLaboral) b.costoLaboral = r;
      else if (s.includes('HORAS OPERACION')) b.horasOp = r;
      else if (s.includes('$$$ OPERACION')) b.dineroOp = r;
      else if (s.includes('HORAS COOPTECH')) b.horasCpt = r;
      else if (s.includes('$$$ COOPTECH')) b.dineroCpt = r;
      else if (s.includes('I+D A ACTIVAR')) b.activar = r;
      else if (s.includes('A GASTO')) { b.gasto = r; break; }
    }
    if (!b.costoLaboral) continue;
    b.totales = b.costoLaboral - 1;
    b.primeraPersona = t.fila;
    b.ultimaPersona = b.totales - 1;
    b.cotizacion = b.costoLaboral + 1; // etiqueta K, valor N, fecha O
    bloques[t.mesNombre] = b;
  }
  return bloques;
}

function limpiarBloque(hoja, b, anio, mesIdx) {
  for (let r = b.primeraPersona; r <= b.ultimaPersona; r++) {
    hoja.cell(`C${r}`).value('xxx');
    hoja.cell(`D${r}`).value(0);
    for (const col of Object.values(COL_UNIDAD)) hoja.cell(`${col}${r}`).value(0);
    hoja.cell(`W${r}`).formula(`D${r}*(1-E${r})`);
    // Resúmenes semanales: se limpian SIEMPRE (la plantilla trae los textos
    // históricos pegados; sin esto, los meses sin datos salían con resúmenes
    // viejos de otro colaborador en esa fila).
    for (const col of COLS_SEMANA) hoja.cell(`${col}${r}`).value(undefined);
  }
  // Encabezados de semana recalculados para el año pedido (la plantilla los
  // trae fijos): "Semana N - DD al DD". AC solo si el mes tiene 5 semanas.
  const filaHeader = b.primeraPersona - 1;
  const semanas = semanasDelMes(anio, mesIdx);
  COLS_SEMANA.forEach((col, i) => {
    hoja.cell(`${col}${filaHeader}`).value(i < semanas.length ? etiquetaSemana(i + 1, semanas[i], anio, mesIdx) : undefined);
  });
  hoja.cell(`E${b.costoLaboral}`).value(undefined);
  hoja.cell(`N${b.cotizacion}`).value(undefined);
  hoja.cell(`O${b.cotizacion}`).value(undefined);
  const f = b.primeraPersona, l = b.ultimaPersona;
  hoja.cell(`W${b.totales}`).formula(`SUM(W${f}:W${l})`);
  hoja.cell(`W${b.costoLaboral}`).formula(`SUM(W${f}:W${l})`);
  if (b.horasOp) hoja.cell(`F${b.horasOp}`).formula(`IF(COUNTIF(D${f}:D${l},">0")=0,0,SUM(E${f}:E${l})/COUNTIF(D${f}:D${l},">0"))`);
  if (b.activar) hoja.cell(`F${b.activar}`).formula(`IF(W${b.totales}=0,0,W${b.costoLaboral}/W${b.totales})`);
  // USD con guarda: un mes sin cotización muestra 0, no #DIV/0! (mejora sobre
  // el original, que explotaba en los meses futuros).
  if (b.dineroOp) hoja.cell(`M${b.dineroOp}`).formula(`IF(N(N${b.cotizacion})=0,0,I${b.dineroOp}/N${b.cotizacion})`);
  if (b.dineroCpt) hoja.cell(`M${b.dineroCpt}`).formula(`IF(N(N${b.cotizacion})=0,0,I${b.dineroCpt}/N${b.cotizacion})`);
}

// data: { costoLaboral, cotizacionDolar, filas: [{nombre, peso, unidades, esDesarrollo, colaboradorId, resumenes}] }
function volcarMes(hoja, b, data, anio, mesIdx) {
  if (data.filas.length > (b.ultimaPersona - b.primeraPersona + 1)) {
    throw new Error(`El bloque de ${b.mes} tiene ${b.ultimaPersona - b.primeraPersona + 1} renglones y hay ${data.filas.length} colaboradores: hay que ampliar la plantilla (no se insertan filas automáticamente para no romper los asientos).`);
  }
  const semanas = semanasDelMes(anio, mesIdx);
  const filasNoDesarrollo = [];
  data.filas.forEach((fila, i) => {
    const r = b.primeraPersona + i;
    hoja.cell(`C${r}`).value(fila.nombre);
    hoja.cell(`D${r}`).value(fila.peso);
    for (const [uid, col] of Object.entries(COL_UNIDAD)) {
      hoja.cell(`${col}${r}`).value(fila.unidades[uid] || 0);
    }
    // Resumen semanal (propio de costos) al costado: una celda por semana.
    semanas.forEach((_, w) => {
      const texto = fila.resumenes?.[w];
      if (texto) hoja.cell(`${COLS_SEMANA[w]}${r}`).value(texto);
    });
    if (!fila.esDesarrollo && fila.peso > 0) filasNoDesarrollo.push(r);
  });
  if (data.costoLaboral != null) hoja.cell(`E${b.costoLaboral}`).value(Number(data.costoLaboral));
  if (data.cotizacionDolar != null) hoja.cell(`N${b.cotizacion}`).value(Number(data.cotizacionDolar));
  hoja.cell(`O${b.cotizacion}`).value(new Date(anio, mesIdx + 1, 0)); // último día del mes
  // Criterio de la app: activable = Cooptech ponderado de los de desarrollo.
  const f = b.primeraPersona, l = b.ultimaPersona;
  const resta = filasNoDesarrollo.length ? `-(${filasNoDesarrollo.map((r) => `W${r}`).join('+')})` : '';
  hoja.cell(`W${b.costoLaboral}`).formula(`SUM(W${f}:W${l})${resta}`);
}

export async function generarExcelCostos({ anio, meses, colaboradores }) {
  const ruta = PLANTILLAS[anio];
  if (!ruta) throw new Error(`No hay plantilla para el año ${anio} (hay: ${Object.keys(PLANTILLAS).join(', ')})`);
  const wb = await XlsxPopulate.fromDataAsync(readFileSync(ruta));
  const hoja = wb.sheet('Asignacion');
  const bloques = detectarBloques(hoja);

  const porId = Object.fromEntries(colaboradores.map((c) => [String(c.id), c]));

  for (let mesIdx = 0; mesIdx < 12; mesIdx++) {
    const nombreMes = MESES[mesIdx];
    const b = bloques[nombreMes];
    if (!b) continue;
    limpiarBloque(hoja, b, anio, mesIdx);
    const clave = `${anio}-${String(mesIdx + 1).padStart(2, '0')}`;
    const cm = meses[clave];
    if (!cm || !cm.asignaciones) continue; // mes futuro/sin datos: queda en blanco

    const filas = Object.entries(cm.asignaciones)
      .map(([cid, a]) => {
        const colab = porId[cid];
        const peso = Number(a?.peso_pct) || 0;
        const unidades = unidadesDelMes(a?.weeks);
        const tieneAlgo = peso > 0 || Object.values(unidades).some((x) => x > 0);
        if (!colab || !tieneAlgo) return null;
        // Resumen semanal: el "resumen propio de costos" (weeks[i].summary),
        // NO el WIP de la grilla — son dos textos distintos (fix 07/08: el
        // export salía con el WIP genérico en vez de los resúmenes de acá).
        // Índice posicional: weeks[] se guarda con la misma convención
        // weeksOfMonth que usan las columnas del Excel.
        const resumenes = (a?.weeks || []).map((w) => String(w?.summary || '').trim());
        return { nombre: colab.nombre, peso, unidades, esDesarrollo: (colab.funcionCosto || 'desarrollo') === 'desarrollo', colaboradorId: Number(cid), resumenes };
      })
      .filter(Boolean)
      .sort((a, z) => a.nombre.localeCompare(z.nombre));

    volcarMes(hoja, b, {
      costoLaboral: cm.costoLaboral != null ? Number(cm.costoLaboral) : null,
      cotizacionDolar: cm.cotizacionDolar != null ? Number(cm.cotizacionDolar) : null,
      filas,
    }, anio, mesIdx);
  }

  return wb.outputAsync(); // Buffer del .xlsx
}
