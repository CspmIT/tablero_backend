---
name: verificar-persistencia
description: Regla obligatoria antes de dar por terminada cualquier tarea que toque una función de guardar, editar, eliminar o cambiar de estado (layouts, configuraciones, formularios, toggles, borrados, marcar/desmarcar). Usar siempre que la implementación o el cambio involucre persistencia o mutación de datos, aunque el pedido original haya sido visual.
---

# Verificar persistencia antes de terminar

Orden del usuario (03-sep-2026): **"Toda función de guardar, editar, eliminar, cambiar
de estado se debe chequear antes de terminar una tarea."** No alcanza con que el
código compile ni con que la UI reaccione: hay que comprobar que el dato quedó
persistido y que vuelve igual al recargar.

## Cuándo aplica

Siempre que la tarea toque, directa o indirectamente, algo que:
- guarda (crear, PUT/POST/PATCH, "Guardar", tilde de confirmar, autoguardado),
- edita (renombrar, reordenar, redimensionar, cambiar un campo),
- elimina (borrar, quitar, desasignar),
- cambia de estado (activar/inactivar, marcar principal, favorito, leído, pausar).

Incluye los casos en que el cambio fue "solo visual" pero el componente tocado
participa de uno de esos flujos (p. ej. un grid con drag/resize, un composer, una card
con botón de eliminar).

## Cómo se chequea (mínimo)

1. **Ida completa en la UI real** (dev server + navegador, no solo leer el código):
   hacer la acción como la haría el usuario, con la pantalla a un tamaño realista
   (≥ 1200 px si hay grillas responsive; también en el ancho del usuario si se sabe).
2. **Request y respuesta**: confirmar con `read_network_requests` que salió el request
   esperado (método, ruta, payload con el cambio) y que respondió 2xx con el dato ya
   modificado.
3. **Vuelta**: recargar la página (o salir y volver a entrar) y verificar que el cambio
   sigue ahí. Si hay listado + detalle, chequear los dos.
4. **Caminos alternativos de salida**: si la acción tiene dos botones parecidos
   (p. ej. "terminar edición" y "guardar"), probar el que el usuario va a usar por
   intuición y asegurarse de que no se pierda el cambio en silencio. Si se puede
   perder, o se guarda en ese paso o se avisa (confirm / beforeunload).
5. **Back**: si el back normaliza o valida (zod, `normalize*`, `pack*`), leer qué hace
   con el dato guardado para confirmar que no lo descarta ni lo pisa.
6. **Sin acceso a la UI** (no hay login, no hay datos): decirlo explícitamente en el
   reporte como "NO verificado" y dejar los pasos manuales. Nunca reportar como
   verificado algo que solo se leyó.

## Qué reportar

En el mensaje final, una línea por flujo tocado: qué acción se probó, qué request
se vio y que el dato volvió tras recargar. Si algo no se pudo probar, decirlo.
